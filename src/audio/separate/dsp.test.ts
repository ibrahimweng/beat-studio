import { describe, expect, it } from 'vitest';
import { clicks, energy, glide, heldShare, mix, RATE, stereo, tone } from '../../../test/mixes.ts';
import { lowWeights, measured } from './dsp.ts';
import { PARTS } from './types.ts';

/**
 * The four parts, end to end.
 *
 * The material is a mix with a known right answer in each of the four places: a
 * loop that repeats, a low tone, a centred line that never repeats, and a chord
 * pushed off to one side. Nothing about it is music, and that is deliberate —
 * every part of it is unambiguous, so a failure here is a fault rather than a
 * disappointment. How this does on real music is what `tools/separate-check.html`
 * is for, and no test can answer it.
 *
 * The first test is the one that has to hold whatever else changes. Everything
 * this app says on screen about a set of stems — that they sit on separate tracks
 * and stay in sync, that they add back up to what went in — is that test.
 */

const SECONDS = 6;

/** A mix with something known in each of the four places. */
function material(): {
  input: AudioBuffer;
  loop: Float32Array;
  bass: Float32Array;
  lead: Float32Array;
  aside: Float32Array;
} {
  const loop = clicks(0.5, SECONDS, 0.55);
  const bass = tone(80, SECONDS, 0.35);
  // Centred and never the same twice, which is what a lead is.
  const lead = glide(500, 900, SECONDS, 0.25);
  // Held, in the same register, and hard over to one side.
  const aside = mix(tone(660, SECONDS, 0.2), tone(880, SECONDS, 0.2));

  const left = mix(loop, bass, lead, aside);
  const right = mix(loop, bass, lead);
  return { input: stereo(left, right), loop, bass, lead, aside };
}

/** Every part by name, for reading a claim without counting positions. */
async function apart(input: AudioBuffer): Promise<Record<string, AudioBuffer>> {
  const done = await measured.separate(input);
  const out: Record<string, AudioBuffer> = {};
  for (const part of done.parts) out[part.id] = part.audio;
  return out;
}

describe('taking a mix into four', () => {
  /*
   * The four add back up to the recording, sample for sample.
   *
   * Not nearly, and not once a fade at each end is allowed for. Three separate
   * things have to be true at once for this to hold: every cell is divided by
   * shares that add to one, the transform in `stft.ts` gives back what it was
   * given, and the blocks are joined by two ramps that add to one. Break any of
   * them and this is the test that says so — and none of the others would,
   * because each part on its own would still look reasonable.
   */
  it('adds back up to the recording', async () => {
    const { input } = material();
    const done = await measured.separate(input);
    expect(done.parts).toHaveLength(PARTS.length);

    for (let c = 0; c < input.numberOfChannels; c++) {
      const was = input.getChannelData(c);
      /*
       * The channels are taken hold of once rather than per sample.
       *
       * `getChannelData` crosses into the Web Audio implementation on every
       * call, and asking for it inside the loop is two and a quarter million
       * crossings — a hundred and thirty nine seconds, against a fraction of one.
       * The test was right and unusable.
       */
      const lanes = done.parts.map((part) => part.audio.getChannelData(c));
      let worst = 0;
      for (let i = 0; i < was.length; i++) {
        let sum = 0;
        for (const lane of lanes) sum += lane[i];
        worst = Math.max(worst, Math.abs(was[i] - sum));
      }
      expect(worst, `channel ${c} is out by ${worst}`).toBeLessThan(1e-4);
    }
  });

  it('gives every part the length and the rate it was given', async () => {
    const { input } = material();
    const done = await measured.separate(input);
    for (const part of done.parts) {
      expect(part.audio.length).toBe(input.length);
      expect(part.audio.sampleRate).toBe(input.sampleRate);
      expect(part.audio.numberOfChannels).toBe(2);
    }
  });

  it('puts the loop in the drums', async () => {
    const { input, loop } = material();
    const parts = await apart(input);
    expect(heldShare(parts.drums.getChannelData(0), loop)).toBeGreaterThan(0.7);
  });

  it('puts the low tone in the bass', async () => {
    const { input, bass } = material();
    const parts = await apart(input);
    expect(heldShare(parts.bass.getChannelData(0), bass)).toBeGreaterThan(0.7);
    // And nowhere else, since the low crossover is the only thing dividing them.
    expect(heldShare(parts.tonal.getChannelData(0), bass)).toBeLessThan(0.2);
  });

  /*
   * Centred and changing goes to the lead; held and off to one side does not.
   *
   * Stated as a comparison rather than as a threshold on its own, because that
   * is what the measurement actually claims. Two sounds in the same register are
   * told apart here by where they sit and whether they repeat, and what has to
   * be true is that each ends up more in its own part than in the other's.
   */
  it('tells a centred line from one pushed aside', async () => {
    const { input, lead, aside } = material();
    const parts = await apart(input);
    const leadInLead = heldShare(parts.lead.getChannelData(0), lead);
    const leadInTonal = heldShare(parts.tonal.getChannelData(0), lead);
    const asideInTonal = heldShare(parts.tonal.getChannelData(0), aside);
    const asideInLead = heldShare(parts.lead.getChannelData(0), aside);

    expect(leadInLead).toBeGreaterThan(leadInTonal);
    expect(asideInTonal).toBeGreaterThan(asideInLead);
  });

  it('says what it found, so the screen does not have to guess', async () => {
    const { input } = material();
    const done = await measured.separate(input);
    expect(done.by).toBe('measured');
    expect(done.notes.stereo).toBe(true);
    expect(done.notes.width).toBeGreaterThan(0);
    /*
     * A loop was found, and its length is a whole number of the true spacing.
     *
     * Not the spacing itself. The clicks here are half a second apart and what
     * comes back is a second and a half, because the two held tones over them
     * are most of the energy and the self-similarity curve is mostly about
     * those. Three turns of the loop is still the loop as far as the model is
     * concerned — the repetitions still line up, which is why the drums come out
     * either way — so this asserts what is actually needed rather than the
     * number that happens to come back today.
     */
    expect(done.notes.loop).not.toBeNull();
    const turns = (done.notes.loop as number) / 0.5;
    expect(Math.abs(turns - Math.round(turns))).toBeLessThan(0.1);
    expect(Math.round(turns)).toBeGreaterThanOrEqual(1);
    expect(done.notes.took).toBeGreaterThan(0);
  });

  /*
   * A mono recording with nothing repeating has no lead, and does not pretend to.
   *
   * Both of the measurements that could tell a foreground from a background are
   * unavailable: there is only one channel to read a position from, and nothing
   * comes round again. Anything in the lead file would be there because the code
   * divided the notes on something invented. So the lead comes out empty, the
   * notes go to the tonal part whole, and the notes say why.
   */
  it('leaves the lead empty when there is nothing to read it from', async () => {
    const line = glide(300, 3000, SECONDS, 0.5);
    const one = stereo(line, line);
    const done = await measured.separate(one);
    const lead = done.parts.find((part) => part.id === 'lead');
    expect(done.notes.stereo).toBe(false);
    expect(done.notes.loop).toBeNull();
    expect(energy(lead?.audio.getChannelData(0) as Float32Array)).toBe(0);
  });

  it('reports how far along it is', async () => {
    const { input } = material();
    const seen: number[] = [];
    await measured.separate(input, {}, (done, of) => {
      expect(of).toBeGreaterThan(0);
      seen.push(done);
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(seen.length - 1);
  });

  it('refuses a recording longer than it can hold, and says why', async () => {
    // Nine minutes, made without allocating nine minutes of samples.
    const huge = {
      duration: 9 * 60,
      length: 9 * 60 * RATE,
      sampleRate: RATE,
      numberOfChannels: 2,
      getChannelData: () => new Float32Array(0),
    } as unknown as AudioBuffer;
    await expect(measured.separate(huge)).rejects.toThrow(/9 minutes long/);
  });
});

describe('where the bass gives way', () => {
  it('takes all of the bottom and none of the top', () => {
    const size = 2048;
    const weights = lowWeights(size / 2 + 1, size, RATE, 220);
    const at = (hz: number): number => weights[Math.round((hz * size) / RATE)];
    expect(at(60)).toBeCloseTo(1, 5);
    expect(at(2000)).toBeCloseTo(0, 5);
  });

  /*
   * A handover rather than a line.
   *
   * A hard cut leaves an audible seam in both parts at exactly the frequency it
   * was drawn: the bass ends abruptly and whatever is above it starts abruptly,
   * on the same sound. So it has to fall through the middle rather than step.
   */
  it('hands over gradually rather than stepping', () => {
    const size = 2048;
    const weights = lowWeights(size / 2 + 1, size, RATE, 220);
    const at = (hz: number): number => weights[Math.round((hz * size) / RATE)];
    expect(at(220)).toBeCloseTo(0.5, 1);
    expect(at(150)).toBeGreaterThan(at(220));
    expect(at(220)).toBeGreaterThan(at(330));
    for (let k = 1; k < weights.length; k++) expect(weights[k]).toBeLessThanOrEqual(weights[k - 1]);
  });
});
