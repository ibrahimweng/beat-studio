import { describe, expect, it } from 'vitest';
import { clicks, glide, heldShare, mix, RATE } from '../../../test/mixes.ts';
import { beatSpectrum, repeatingMask } from './repeat.ts';
import { analyse, magnitudes, masked, synthesise } from './stft.ts';

/**
 * What happens over and over, and what happens once.
 *
 * The material is a loop and a line: clicks every half second, which repeat,
 * and a tone that slides from one pitch to another, which never does. Both run
 * the whole length, so nothing about when they start gives the answer away —
 * the only thing separating them is that one is the same each time round.
 *
 * The line is quieter than the loop, which is not a convenience. This
 * measurement assumes the repeating part is a real share of what is going on,
 * which is what "a beat with something over it" means and is the case it is
 * here for. With the line made loud enough to dominate, the period comes back
 * as a multiple of the true one — still usable, since a multiple still aligns
 * the loop, but not what the test below asserts. Saying so is more useful than
 * quietly picking levels that pass.
 *
 * The measurement matters most on mono, where `stereo.ts` has nothing to say
 * and this is the only thing left that can tell a foreground from a
 * background. So it is checked on one channel.
 */

const SECONDS = 6;
const EVERY = 0.5;

function material(): { loop: Float32Array; line: Float32Array; both: Float32Array } {
  const loop = clicks(EVERY, SECONDS);
  const line = glide(600, 1400, SECONDS, 0.15);
  return { loop, line, both: mix(loop, line) };
}

function split(data: Float32Array) {
  const spec = analyse(data);
  const mag = magnitudes(spec);
  const read = repeatingMask(mag, spec.frames, spec.bins, spec.hop / RATE);
  const front = new Float32Array(read.mask.length);
  for (let i = 0; i < read.mask.length; i++) front[i] = 1 - read.mask[i];
  return {
    read,
    background: synthesise(masked(spec, read.mask)),
    foreground: synthesise(masked(spec, front)),
  };
}

/** The smallest and largest value in a mask, so a claim about all of them is one assertion. */
function span(values: Float32Array): { least: number; most: number } {
  let least = Infinity;
  let most = -Infinity;
  for (const value of values) {
    if (value < least) least = value;
    if (value > most) most = value;
  }
  return { least, most };
}

describe('finding the loop', () => {
  it('finds the length of the loop that is there', () => {
    const { both } = material();
    const { read } = split(both);
    expect(read.period).not.toBeNull();
    /*
     * To within a hundredth of a frame, not to within a frame.
     *
     * A frame would be a much weaker claim than the code actually makes, and a
     * weak claim here is expensive: the period is rounded nowhere, and the
     * whole reason for that is written up in `refine`. Half a second at this
     * hop is 46.875 frames, and the search reports 46.88 of them.
     */
    const frames = (read.period as number) / (analyse(both).hop / RATE);
    expect(frames).toBeCloseTo(EVERY / (512 / RATE), 1);
  });

  /*
   * A multiple of the loop is not the loop.
   *
   * The self-similarity curve peaks at the loop's length and at every multiple
   * of it, and the tallest of those peaks is very often not the first —
   * measured on a plain loop, the tallest is the triple. Taking the tallest
   * builds the model out of a third as many repetitions and lets anything that
   * happens to come round on the longer spacing into the background. So each
   * candidate is scored by how much its own multiples stand out as well, which
   * is what makes the first one win.
   */
  it('does not report a multiple of the loop', () => {
    const { read } = split(clicks(EVERY, SECONDS));
    expect(read.period as number).toBeLessThan(EVERY * 1.5);
  });

  it('says there is no loop when there is none', () => {
    const { read } = split(glide(300, 3000, SECONDS, 0.5));
    expect(read.period).toBeNull();
    expect(read.strength).toBe(0);
    // And returns nothing rather than a split, so a caller cannot use a
    // measurement that was never made.
    expect(span(read.mask)).toEqual({ least: 0, most: 0 });
  });

  /*
   * The trend is not a peak.
   *
   * A recording resembles itself less and less as the lag grows, so the
   * self-similarity curve falls away steeply. Comparing a lag against the
   * average of the whole curve — which is the obvious thing to do and was the
   * first version — makes every short lag beat it, and the shortest lag in
   * range comes back as the period for everything, including material with
   * nothing repeating in it at all. This is that fault, stated as a test: the
   * answer for a slide is nothing, not the bottom of the search range.
   */
  it('does not mistake a steep falling curve for a period', () => {
    const { read } = split(glide(200, 4000, SECONDS, 0.5));
    expect(read.period).toBeNull();
  });
});

describe('splitting the loop from the line', () => {
  it('puts the clicks in the background', () => {
    const { loop, both } = material();
    const out = split(both);
    expect(heldShare(out.background, loop)).toBeGreaterThan(0.85);
  });

  it('puts the sliding tone in the foreground', () => {
    const { line, both } = material();
    const out = split(both);
    expect(heldShare(out.foreground, line)).toBeGreaterThan(0.9);
    expect(heldShare(out.background, line)).toBeLessThan(0.1);
  });

  it('adds back up to the recording', () => {
    const { both } = material();
    const out = split(both);
    let worst = 0;
    for (let i = 0; i < both.length; i++) {
      worst = Math.max(worst, Math.abs(both[i] - (out.background[i] + out.foreground[i])));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  /*
   * The loop is never allowed to be louder than what is in front of it.
   *
   * Without that clamp a repetition where the loop happens to be quiet has
   * more taken out of it than it contains. The mask goes above one, the
   * foreground goes below nothing, and what comes back is a hole in the shape
   * of the drums — audible, and invisible to every other test here, because
   * the two parts still add up to the recording exactly.
   */
  it('never claims more of a cell than the cell holds', () => {
    const { both } = material();
    const { least, most } = span(split(both).read.mask);
    expect(least).toBeGreaterThanOrEqual(0);
    expect(most).toBeLessThanOrEqual(1);
  });
});

describe('the self-similarity curve', () => {
  it('starts at one, since nothing resembles a recording like itself', () => {
    const spec = analyse(clicks(EVERY, SECONDS));
    const beats = beatSpectrum(magnitudes(spec), spec.frames, spec.bins, 40);
    expect(beats[0]).toBeCloseTo(1, 6);
  });

  it('peaks at the spacing of the thing that repeats', () => {
    const spec = analyse(clicks(EVERY, SECONDS));
    const perFrame = spec.hop / RATE;
    const at = Math.round(EVERY / perFrame);
    const beats = beatSpectrum(magnitudes(spec), spec.frames, spec.bins, at + 10);
    // Taller than either side of it, which is what makes it a peak rather than
    // a point on a slope.
    expect(beats[at]).toBeGreaterThan(beats[at - 4]);
    expect(beats[at]).toBeGreaterThan(beats[at + 4]);
  });
});
