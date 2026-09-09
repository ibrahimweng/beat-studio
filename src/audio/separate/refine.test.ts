import { describe, expect, it } from 'vitest';
import { energy, heldShare, laneOf, mix, RATE, stereo, tone } from '../../../test/mixes.ts';
import { renderVoice, seedFrom } from '../voice-spec.ts';
import { kitSpec } from '../voices.ts';
import { noteFor, refineDrums, refineTonal } from './refine.ts';
import type { StemPart } from './types.ts';
import { fromBuffer } from './written.ts';

/**
 * Taking a part further: dividing it between the things found in it.
 *
 * Whether the right things are found is `hits.test.ts` next door. What is here is
 * what happens once they have been: how much of each drum ends up in its own file,
 * how much is left over, and whether the files still add up to the part they came
 * out of.
 *
 * The material is this app's own kit and its own tones, which is the closest thing
 * to ground truth available without a labelled recording. How this does on real
 * music is what `tools/separate-check.html` is for, and no test can answer it.
 */

const SECONDS = 4;

/**
 * How loud the fixture is played, and why it is not simply full.
 *
 * Three drums at their own level sum past full scale — measured, this pattern
 * peaks at 1.39 — and a part is written as a 24-bit file, which cannot hold
 * more than full scale any more than a recording can. So the parts of a mix
 * that is itself over the top cannot add back up to it, and a test saying they
 * do would be asking for something no file could contain. Real recordings fit.
 * This one is made to fit, by the same amount everywhere, so that every share
 * measured below is exactly what it was.
 */
const HEADROOM = 0.7;

/** One kit voice at a list of times, as a signal. */
async function played(pad: string, at: readonly number[]): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(RATE * SECONDS), RATE);
  for (const time of at) {
    // A seed per voice rather than per hit, so every kick is the same kick —
    // which is what a programmed pattern is, and what the loop finder assumes.
    renderVoice(ctx, ctx.destination, kitSpec(pad as never, 1), time, seedFrom(pad));
  }
  /*
   * Copied out of the buffer, which is not tidiness.
   *
   * `getChannelData` here is a view onto memory the Rust binding owns, and it
   * stays valid only while its AudioBuffer is alive. Written as one expression
   * the buffer is unreachable the moment the view exists, so a later render is
   * free to take its allocation — and the view then reads whatever is in that
   * memory now. Measured: the reference signals came back holding 3.3e+63,
   * which is uninitialised bytes read as floats, but only when this file ran
   * alongside another that also renders. `render.test.ts` has the long version
   * of this note and the same trap.
   */
  const lane = Float32Array.from((await ctx.startRendering()).getChannelData(0));
  for (let i = 0; i < lane.length; i++) lane[i] *= HEADROOM;
  return lane;
}

/** Somebody's idea of a beat: kick on the beat, snare between, hats throughout. */
async function beat(): Promise<{
  part: StemPart;
  audio: AudioBuffer;
  kicks: Float32Array;
  snares: Float32Array;
  hats: Float32Array;
}> {
  const kicks = await played('kick', [0.25, 1.25, 2.25, 3.25]);
  const snares = await played('snare', [0.75, 1.75, 2.75]);
  const hats = await played('hhc', [0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  const both = mix(kicks, snares, hats);

  /*
   * The samples are handed back beside the part, not read off it.
   *
   * A part carries its audio as a file rather than as samples, which is what
   * lets four of them exist at once for a long recording. Going deeper into one
   * takes the samples as an argument, and the app decodes them from the file it
   * registered — here they are simply the ones the fixture already had.
   */
  const audio = stereo(both, both);
  return {
    kicks,
    snares,
    hats,
    audio,
    part: {
      id: 'drums',
      name: 'Drums',
      about: '',
      under: null,
      audio: fromBuffer(audio),
      share: 1,
    },
  };
}

/** Every part by name. */
function byName(parts: readonly StemPart[]): Record<string, StemPart> {
  const out: Record<string, StemPart> = {};
  for (const part of parts) out[part.id] = part;
  return out;
}

describe('splitting a drum part', () => {
  it('finds the kick, the snare and the hats and nothing else', async () => {
    const { part, audio } = await beat();
    const parts = await refineDrums(part, audio);
    const ids = parts.map((one) => one.id).sort();
    expect(ids).toEqual(['drums.hat', 'drums.kick', 'drums.rest', 'drums.snare']);
    for (const one of parts) expect(one.under).toBe('drums');
  }, 60_000);

  /*
   * The parts add back up to the drums they came out of.
   *
   * Which is not free here, and is the reason Rest exists as a part rather than
   * being thrown away. Unlike the four in `dsp.ts`, these shares are not a
   * measurement of every cell — they are what a list of predicted hits accounts
   * for, and a list of hits does not account for everything. Rest is defined as
   * the difference rather than as a part in its own right, so there is nowhere
   * for a residue to go missing.
   */
  it('adds back up to the part it came out of', async () => {
    const { part, audio } = await beat();
    const parts = await refineDrums(part, audio);
    const was = audio.getChannelData(0);
    // Read back and copied out once. `getChannelData` crosses into the audio
    // implementation on every call, and asking inside the loop costs minutes.
    const lanes = parts.map((one) => laneOf(one.audio));
    let worst = 0;
    for (let i = 0; i < was.length; i++) {
      let sum = 0;
      for (const lane of lanes) sum += lane[i];
      worst = Math.max(worst, Math.abs(was[i] - sum));
    }
    expect(worst).toBeLessThan(1e-4);
  }, 60_000);

  it('puts each drum in its own part', async () => {
    const { part, audio, kicks, snares, hats } = await beat();
    const parts = byName(await refineDrums(part, audio));
    const held = (id: string, of: Float32Array): number => heldShare(laneOf(parts[id].audio), of);

    // Measured: 0.97, 0.93 and 0.92 of each drum in its own file.
    expect(held('drums.kick', kicks)).toBeGreaterThan(0.9);
    expect(held('drums.hat', hats)).toBeGreaterThan(0.85);
    expect(held('drums.snare', snares)).toBeGreaterThan(0.85);

    // And more of each drum in its own part than in either of the others, which
    // is the claim that actually matters when they overlap.
    expect(held('drums.kick', kicks)).toBeGreaterThan(held('drums.snare', kicks));
    expect(held('drums.hat', hats)).toBeGreaterThan(held('drums.snare', hats));
    expect(held('drums.snare', snares)).toBeGreaterThan(held('drums.kick', snares));
  }, 60_000);

  it('says how many hits went into each part', async () => {
    const { part, audio } = await beat();
    const parts = byName(await refineDrums(part, audio));
    expect(parts['drums.kick'].about).toMatch(/4 hits/);
    expect(parts['drums.hat'].about).toMatch(/7 hits/);
  }, 60_000);

  it('gives back nothing for a part with no hits in it', async () => {
    const quiet = new Float32Array(RATE * 2);
    const audio = stereo(quiet, quiet);
    const part: StemPart = {
      id: 'drums',
      name: 'Drums',
      about: '',
      under: null,
      audio: fromBuffer(audio),
      share: 0,
    };
    expect(await refineDrums(part, audio)).toEqual([]);
  });
});

describe('following the lines in what is left', () => {
  /** Two held notes, an octave and a half apart, both running the whole time. */
  async function held(): Promise<{
    part: StemPart;
    audio: AudioBuffer;
    low: Float32Array;
    high: Float32Array;
  }> {
    // Two harmonics each, so there is a comb to find rather than a single bin.
    const low = mix(tone(150, SECONDS, 0.3), tone(300, SECONDS, 0.15));
    const high = mix(tone(900, SECONDS, 0.3), tone(1800, SECONDS, 0.15));
    const both = mix(low, high);
    const audio = stereo(both, both);
    return {
      low,
      high,
      audio,
      part: {
        id: 'tonal',
        name: 'Tonal',
        about: '',
        under: null,
        audio: fromBuffer(audio),
        share: 1,
      },
    };
  }

  it('puts two notes in two registers', async () => {
    const { part, audio, low, high } = await held();
    const parts = byName(await refineTonal(part, audio));
    expect(parts['tonal.low']).toBeDefined();
    expect(parts['tonal.high']).toBeDefined();

    const lowLine = laneOf(parts['tonal.low'].audio);
    const highLine = laneOf(parts['tonal.high'].audio);
    expect(heldShare(lowLine, low)).toBeGreaterThan(heldShare(lowLine, high));
    expect(heldShare(highLine, high)).toBeGreaterThan(heldShare(highLine, low));
  }, 60_000);

  it('says where each line actually sat, rather than where the register ends', async () => {
    const { part, audio } = await held();
    const parts = byName(await refineTonal(part, audio));
    // D3 is 146.8 hertz and the note is at 150, so the nearest name to it.
    expect(parts['tonal.low'].about).toMatch(/D3/);
    expect(parts['tonal.low'].about).toMatch(/sounding for/);
  }, 60_000);

  it('adds back up to the part it came out of', async () => {
    const { part, audio } = await held();
    const parts = await refineTonal(part, audio);
    const was = audio.getChannelData(0);
    // Read back and copied out once. `getChannelData` crosses into the audio
    // implementation on every call, and asking inside the loop costs minutes.
    const lanes = parts.map((one) => laneOf(one.audio));
    let worst = 0;
    for (let i = 0; i < was.length; i++) {
      let sum = 0;
      for (const lane of lanes) sum += lane[i];
      worst = Math.max(worst, Math.abs(was[i] - sum));
    }
    expect(worst).toBeLessThan(1e-4);
  }, 60_000);

  /*
   * Noise has no lines in it, and none are invented.
   *
   * Every frame of every recording has a strongest pitch in it, so a tracker
   * that keeps them all draws a line through the gaps between notes and claims
   * its harmonics out of whatever else was there. Only runs that hold for a
   * tenth of a second survive, which is what this checks.
   */
  it('finds no lines in noise', async () => {
    const hiss = new Float32Array(RATE * 2);
    let state = 9;
    for (let i = 0; i < hiss.length; i++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      hiss[i] = (state / 0x3fffffff - 1) * 0.3;
    }
    const audio = stereo(hiss, hiss);
    const part: StemPart = {
      id: 'tonal',
      name: 'Tonal',
      about: '',
      under: null,
      audio: fromBuffer(audio),
      share: 1,
    };
    const parts = byName(await refineTonal(part, audio));
    const rest = energy(laneOf(parts['tonal.rest'].audio));
    const lines = Object.keys(parts).filter((id) => id !== 'tonal.rest');
    for (const id of lines) {
      // Whatever registers do come back must be a sliver next to the rest.
      expect(energy(laneOf(parts[id].audio)), `${id} took too much of the noise`).toBeLessThan(
        rest * 0.25,
      );
    }
  }, 60_000);
});

describe('naming a pitch', () => {
  it('names the notes everybody knows', () => {
    expect(noteFor(440)).toBe('A4');
    expect(noteFor(261.6)).toBe('C4');
    expect(noteFor(82.4)).toBe('E2');
  });

  it('says nothing for nothing', () => {
    expect(noteFor(0)).toBe('—');
  });
});
