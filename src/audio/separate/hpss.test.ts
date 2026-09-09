import { describe, expect, it } from 'vitest';
import { clicks, energy, heldShare, mix, RATE, tone } from '../../../test/mixes.ts';
import { bandSpans, estimates, median, percussiveMask } from './hpss.ts';
import { analyse, magnitudes, masked, synthesise } from './stft.ts';

/**
 * Telling a hit from a note.
 *
 * This is the measurement the rest of the folder leans on hardest: the drum
 * stem is this and nothing else, and the three other stems are all cut out of
 * what this leaves. So it is checked on the plainest case there is — a click
 * train and a sine, added together — where the right answer is not a matter of
 * opinion.
 *
 * Every test here was checked by putting the fault it describes back into the
 * code. Swapping the two medians for each other, which is the mistake this
 * file invites, fails the first two and nothing else: the split still happens
 * and the two parts still add up, they are simply the wrong way round.
 */

const SECONDS = 3;

/** The two parts, and the mix of them, as the tests all want them. */
function material(): {
  hits: Float32Array;
  note: Float32Array;
  both: Float32Array;
} {
  const hits = clicks(0.25, SECONDS);
  const note = tone(440, SECONDS);
  return { hits, note, both: mix(hits, note) };
}

/** Run the split and give back the two signals. */
function split(data: Float32Array, lean?: number): { hits: Float32Array; notes: Float32Array } {
  const spec = analyse(data);
  const mag = magnitudes(spec);
  const p = percussiveMask(mag, spec.frames, spec.bins, lean === undefined ? {} : { lean });
  const h = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) h[i] = 1 - p[i];
  return { hits: synthesise(masked(spec, p)), notes: synthesise(masked(spec, h)) };
}

describe('the middle value of a short run', () => {
  it('is the middle one when there is one', () => {
    expect(median(Float32Array.from([5, 1, 9, 3, 7]))).toBe(5);
  });

  it('is the average of the middle two when there is not', () => {
    expect(median(Float32Array.from([4, 1, 3, 2]))).toBeCloseTo(2.5, 6);
  });

  /*
   * The property the whole file is chosen for.
   *
   * One value out of seventeen, however extreme, cannot move it. An average
   * over the same run would be moved by a fifth of the outlier, which is a
   * smeared ghost of every drum left in the note part.
   */
  it('is not moved by one value out of seventeen', () => {
    const calm = Float32Array.from(Array.from({ length: 17 }, () => 1));
    const spiked = Float32Array.from(calm);
    spiked[8] = 1000;
    expect(median(spiked)).toBe(median(calm));
  });
});

describe('splitting hits from notes', () => {
  it('puts the clicks in the hits', () => {
    const { hits, both } = material();
    const out = split(both);
    expect(heldShare(out.hits, hits)).toBeGreaterThan(0.8);
    expect(heldShare(out.notes, hits)).toBeLessThan(0.2);
  });

  it('puts the tone in the notes', () => {
    const { note, both } = material();
    const out = split(both);
    expect(heldShare(out.notes, note)).toBeGreaterThan(0.8);
    expect(heldShare(out.hits, note)).toBeLessThan(0.2);
  });

  /*
   * The two parts add back up to what went in.
   *
   * Not nearly, and not to within a fade at each end. This is the claim the
   * app makes on screen about every set of stems it writes, and it holds
   * because the two masks add to one at every cell and the round trip in
   * `stft.ts` is exact — so it is worth checking once here on real masks
   * rather than trusting the two halves separately.
   */
  it('adds back up to the recording', () => {
    const { both } = material();
    const out = split(both);
    let worst = 0;
    for (let i = 0; i < both.length; i++) {
      worst = Math.max(worst, Math.abs(both[i] - (out.hits[i] + out.notes[i])));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  /*
   * Leaning one way moves the split and does not break it.
   *
   * The control exists because the right answer is not the same for every
   * recording, so what has to be true is that a half is neutral and the two
   * ends go opposite ways — not that any particular setting is correct.
   */
  it('leans towards hits or towards notes as asked', () => {
    const { both } = material();
    const towardsHits = energy(split(both, 0.8).hits);
    const neutral = energy(split(both, 0.5).hits);
    const towardsNotes = energy(split(both, 0.2).hits);
    expect(towardsHits).toBeGreaterThan(neutral);
    expect(neutral).toBeGreaterThan(towardsNotes);
  });

  it('leaves silence to neither', () => {
    const spec = analyse(new Float32Array(RATE));
    const p = percussiveMask(magnitudes(spec), spec.frames, spec.bins);
    for (const value of p) expect(value).toBe(0);
  });
});

describe('how wide the frequency median looks', () => {
  const RATE_HERE = 48_000;
  const SIZE_HERE = 2048;
  const bins = SIZE_HERE / 2 + 1;
  const hz = (bin: number): number => (bin * RATE_HERE) / SIZE_HERE;

  /*
   * A constant width in octaves, not in hertz.
   *
   * This is the single measurement that decides whether a drum part has a kick
   * in it. A fixed four hundred hertz is a sliver at five kilohertz and two whole
   * octaves at fifty, so a kick was asked whether it filled a band reaching up to
   * two hundred and fifty hertz. It does not, so it read as a note and went to
   * the bass: 18 per cent of the kick in the drums against 77 in the bass. In
   * octaves the same question becomes the right one, and it comes back as 74 and
   * 26.
   */
  it('looks across about a third of an octave in the middle of the range', () => {
    const spans = bandSpans(bins, 17);
    const third = Math.pow(2, 1 / 3) - 1;
    // Between the floor at the bottom and the cap at the top, which is where the
    // rule is the thing deciding rather than one of the two limits.
    for (const at of [300, 450, 600]) {
      const bin = Math.round((at * SIZE_HERE) / RATE_HERE);
      const share = (hz(bin + spans[bin] / 2) - hz(bin)) / hz(bin);
      expect(share, `at ${at}Hz it looked across ${(share * 100).toFixed(0)}%`)
        .toBeGreaterThan(third * 0.6);
      expect(share).toBeLessThan(third * 1.4);
    }
  });

  /*
   * A floor at the bottom and a cap at the top, and both do real work.
   *
   * A third of an octave at fifty hertz is two bins, and a median of two of
   * anything says very little. Past about seven hundred and seventy hertz it is
   * wider than the band anything useful occupies, so widening it further only
   * costs time. Between them the rule decides; outside them a limit does, and
   * saying which is which is the point of this.
   */
  it('is held to a floor low down and to a cap high up', () => {
    const spans = bandSpans(bins, 17);
    const at = (frequency: number): number =>
      spans[Math.round((frequency * SIZE_HERE) / RATE_HERE)];
    expect(at(50)).toBe(5);
    expect(at(2000)).toBe(17);
    expect(at(10_000)).toBe(17);
  });

  it('always has a middle value to take', () => {
    for (const wide of bandSpans(bins, 17)) expect(wide % 2).toBe(1);
  });
});

describe('the two estimates the split is made from', () => {
  /*
   * Which median does which job, stated as a test rather than as a comment.
   *
   * The median along time is the note estimate and the median along the bands
   * is the hit estimate. Written the other way round the code still runs,
   * still splits, and still adds up — it simply hands the drums to the notes.
   */
  it('reads a held note along time and a hit across the bands', () => {
    const { both } = material();
    const spec = analyse(both);
    const mag = magnitudes(spec);
    const { harmonic, percussive } = estimates(mag, spec.frames, spec.bins);

    // The bin the tone sits in, on a frame between two clicks.
    const bin = Math.round((440 * spec.size) / RATE);
    const quiet = Math.round((0.125 * RATE) / spec.hop);
    const at = quiet * spec.bins + bin;
    expect(harmonic[at]).toBeGreaterThan(percussive[at] * 4);

    // A frame on a click, in a band the tone is nowhere near.
    const loud = Math.round((0.25 * RATE) / spec.hop);
    const high = quiet * 0 + loud * spec.bins + Math.round((5000 * spec.size) / RATE);
    expect(percussive[high]).toBeGreaterThan(harmonic[high] * 4);
  });
});
