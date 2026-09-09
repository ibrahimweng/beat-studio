import { describe, expect, it } from 'vitest';
import { heldShare, mix, tone } from '../../../test/mixes.ts';
import { centreMask } from './stereo.ts';
import { analyse, masked, synthesise } from './stft.ts';

/**
 * Where a sound sits between the speakers.
 *
 * The case this is for is a mix with a vocal in the middle and everything else
 * moved off it, so the material is two tones in two places: one shared equally
 * by both channels, one only on the left. Nothing about that is subtle, which
 * is the point — a measurement that cannot separate dead centre from hard left
 * has nothing to offer a real mix.
 *
 * The last two tests are the ones worth having. A phase-inverted centre reads
 * as perfectly centred under the obvious implementation, and a mono file reads
 * as perfectly centred everywhere under any implementation. Both were wrong in
 * the first version, and both are silent: the split still happens and the
 * parts still add up.
 */

const SECONDS = 2;

function readMask(left: Float32Array, right: Float32Array) {
  const l = analyse(left);
  const r = analyse(right);
  return { l, r, read: centreMask(l, r, l.frames * l.bins) };
}

describe('reading how centred a cell is', () => {
  it('keeps what both channels share and drops what only one has', () => {
    const middle = tone(440, SECONDS);
    const side = tone(1500, SECONDS);
    const { l, read } = readMask(mix(middle, side), middle);

    expect(read.centred).toBe(true);
    const centre = synthesise(masked(l, read.mask));
    // The left channel is the one carrying both, so what the mask keeps of it
    // should be the shared tone and not the one that is only there.
    expect(heldShare(centre, middle)).toBeGreaterThan(0.8);
    expect(heldShare(centre, side)).toBeLessThan(0.2);
  });

  it('calls two identical channels centred everywhere', () => {
    const both = tone(440, SECONDS);
    const { read } = readMask(both, both);
    // Every cell, which is the correct answer to the question and the reason
    // the answer has to come with `centred` beside it.
    let least = Infinity;
    for (const value of read.mask) least = Math.min(least, value);
    expect(least).toBeCloseTo(1, 5);
  });

  /*
   * Two channels the same are not stereo, and the caller has to be told.
   *
   * A mono file, and a stereo file that is one recording twice, both give a
   * mask of all ones. Used as a measurement that says the whole mix is the
   * lead vocal — which is why this reports rather than returns.
   */
  it('says when there was nothing to compare', () => {
    const both = tone(440, SECONDS);
    expect(readMask(both, both).read.centred).toBe(false);
    expect(readMask(both, both).read.width).toBe(0);
  });

  /*
   * A centre with its phase flipped is not a centre.
   *
   * Reading the size of one channel against the other's conjugate rather than
   * its real part calls this perfectly centred, because the two channels are
   * carrying exactly the same thing — one of them upside down. It is the one
   * thing in a mix that has no place at all, and it is what a badly wired
   * cable produces, so it must not come back as the lead.
   */
  it('does not call a phase-inverted pair centred', () => {
    const one = tone(440, SECONDS);
    const flipped = new Float32Array(one.length);
    for (let i = 0; i < one.length; i++) flipped[i] = -one[i];

    const { read } = readMask(one, flipped);
    expect(read.centred).toBe(true);
    let most = 0;
    for (const value of read.mask) most = Math.max(most, value);
    expect(most).toBeLessThan(0.1);
  });

  it('reads a wide mix as wider than a narrow one', () => {
    const middle = tone(440, SECONDS);
    const side = tone(1500, SECONDS);
    const wide = readMask(mix(middle, side), middle).read.width;
    const narrow = readMask(mix(middle, side), mix(middle, side)).read.width;
    expect(wide).toBeGreaterThan(narrow);
  });
});
