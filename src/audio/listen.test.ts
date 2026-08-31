import { describe, expect, it } from 'vitest';
import { BANDS, WINDOWS, alike, fft, mono, ordinary, print } from './listen.ts';

/**
 * Reading sounds out of a recording.
 *
 * Two jobs at the bottom of this file: a Fourier transform, which is
 * arithmetic with a right answer, and a fingerprint built on top of it, which
 * decides whether two sounds are the same kind of thing. Nothing checked
 * either.
 *
 * The transform is worth testing because it is the one place here where being
 * wrong is silent and total. Everything above reads whatever it produces and
 * has no way to know it is nonsense: a fingerprint of noise still compares
 * against another fingerprint of noise and still returns a number between
 * minus one and one.
 */

const RATE = 44_100;

/** A pure tone, which has one right answer in the frequency domain. */
function tone(hz: number, samples: number, rate = RATE): Float32Array {
  const out = new Float32Array(samples);
  for (let at = 0; at < samples; at += 1) out[at] = Math.sin((2 * Math.PI * hz * at) / rate);
  return out;
}

describe('the transform', () => {
  /*
   * A tone put in one bin comes back out of that bin.
   *
   * The plainest thing that can be asked of a Fourier transform, and the one
   * that catches a bit-reversal or a butterfly written backwards: everything
   * else it does is built from this and nothing above it would notice.
   */
  it('puts a tone in the bin it belongs to', () => {
    const size = 1024;
    for (const bin of [1, 5, 32, 100, 511]) {
      const re = new Float64Array(size);
      const im = new Float64Array(size);
      for (let at = 0; at < size; at += 1) re[at] = Math.cos((2 * Math.PI * bin * at) / size);
      fft(re, im);

      let loudest = 0;
      let where = -1;
      for (let at = 0; at < size / 2; at += 1) {
        const power = re[at] * re[at] + im[at] * im[at];
        if (power > loudest) {
          loudest = power;
          where = at;
        }
      }
      expect(where, `a tone at bin ${bin} came out of bin ${where}`).toBe(bin);
    }
  });

  /*
   * Against the definition, which is the test that found the fault.
   *
   * Everything else here could be satisfied by a transform that is merely
   * consistent, and the one that shipped was exactly that: it scrambled every
   * spectrum the same way, so two takes of one sound still matched and
   * nothing above it ever complained. Only a naive DFT, written straight from
   * the definition and slow enough that nobody would ship it, can say whether
   * the fast one is computing the right thing.
   */
  it('agrees with a transform written straight from the definition', () => {
    const size = 64;
    for (const hz of [1, 5, 13, 31]) {
      const signal = Array.from({ length: size }, (_, at) =>
        Math.cos((2 * Math.PI * hz * at) / size) + 0.4 * Math.sin((2 * Math.PI * 3 * at) / size));

      const naive: number[] = [];
      for (let bin = 0; bin < size / 2; bin += 1) {
        let re = 0;
        let im = 0;
        for (let at = 0; at < size; at += 1) {
          re += signal[at] * Math.cos((-2 * Math.PI * bin * at) / size);
          im += signal[at] * Math.sin((-2 * Math.PI * bin * at) / size);
        }
        naive.push(re * re + im * im);
      }

      const re = Float64Array.from(signal);
      const im = new Float64Array(size);
      fft(re, im);

      let worst = 0;
      for (let bin = 0; bin < size / 2; bin += 1) {
        worst = Math.max(worst, Math.abs(re[bin] * re[bin] + im[bin] * im[bin] - naive[bin]));
      }
      expect(worst, `a tone at ${hz} cycles, against the definition`).toBeLessThan(1e-6);
    }
  });

  it('leaves silence silent', () => {
    const size = 256;
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    fft(re, im);
    let most = 0;
    for (let at = 0; at < size; at += 1) most = Math.max(most, Math.abs(re[at]), Math.abs(im[at]));
    expect(most, 'nothing in, nothing out').toBe(0);
  });

  it('puts a constant entirely in the bin that means "no change"', () => {
    const size = 256;
    const re = new Float64Array(size).fill(1);
    const im = new Float64Array(size);
    fft(re, im);
    expect(re[0], 'all of it is in bin zero').toBeCloseTo(size, 6);
    for (let at = 1; at < size; at += 1) {
      expect(Math.abs(re[at]) + Math.abs(im[at]), `bin ${at} is empty`).toBeLessThan(1e-9);
    }
  });
});

describe('the fingerprint', () => {
  const size = 16_384;

  it('is the size it says it is', () => {
    const taken = print(tone(440, size), RATE);
    expect(taken).toHaveLength(WINDOWS * BANDS + WINDOWS);
  });

  it('calls a sound more like itself than like another', () => {
    const low = print(tone(220, size), RATE);
    const lowAgain = print(tone(220, size), RATE);
    const high = print(tone(3520, size), RATE);

    expect(alike(low, lowAgain), 'the same tone twice').toBeGreaterThan(0.99);
    expect(alike(low, high), 'and four octaves apart is not the same sound')
      .toBeLessThan(alike(low, lowAgain));
  });

  it('scores between minus one and one, whatever it is given', () => {
    const prints = [220, 880, 3520].map((hz) => print(tone(hz, size), RATE));
    for (const a of prints) {
      for (const b of prints) {
        const score = alike(a, b);
        expect(score, 'within range').toBeGreaterThanOrEqual(-1.000001);
        expect(score, 'within range').toBeLessThanOrEqual(1.000001);
      }
    }
  });

  it('says nothing rather than guessing when there is nothing to compare', () => {
    expect(alike(new Float64Array(0), new Float64Array(0))).toBe(0);
  });

  /*
   * Said against another sound rather than against a number.
   *
   * A quieter take of one sound is not identical to it -- half of a print is
   * how loud each slice was -- so what matters is not how close to one it
   * scores but that it still scores nearer to itself than to something else.
   */
  it('knows a quieter take of a sound from a different sound', () => {
    const quiet = tone(440, size);
    const loud = new Float32Array(quiet.length);
    for (let at = 0; at < quiet.length; at += 1) loud[at] = quiet[at] * 0.05;
    const other = tone(3520, size);

    const itself = alike(print(quiet, RATE), print(loud, RATE));
    const another = alike(print(quiet, RATE), print(other, RATE));
    expect(itself, `${itself.toFixed(3)} against itself, ${another.toFixed(3)} against another`)
      .toBeGreaterThan(another);
    expect(itself, 'and still plainly the same sound').toBeGreaterThan(0.9);
  });

  /*
   * What is ordinary across a library, taken out before two sounds are
   * compared, so they are judged on where they differ rather than on both
   * being sounds.
   */
  it('averages a set of prints, and one of them is itself', () => {
    const prints = [220, 440, 880].map((hz) => print(tone(hz, size), RATE));
    expect(ordinary(prints)).toHaveLength(prints[0].length);
    expect(ordinary([])).toHaveLength(0);
    // The same print however many times is that print's own shape.
    const once = ordinary([prints[0]]);
    const thrice = ordinary([prints[0], prints[0], prints[0]]);
    for (let at = 0; at < once.length; at += 1) {
      expect(thrice[at], `band ${at}`).toBeCloseTo(once[at], 9);
    }
  });

  /*
   * What it is for: without it every voice scores about ninety per cent
   * against every other one, because they are all sounds. Taking out what
   * they have in common leaves what makes each one itself.
   */
  it('pushes two sounds of the same kind apart', () => {
    /*
     * Harmonic stacks a tone or two apart, which is the case the fault
     * described: they are all sounds, so they all score high on being sounds.
     */
    const stack = (root: number): Float32Array => {
      const out = new Float32Array(size);
      for (let at = 0; at < size; at += 1) {
        out[at] =
          (Math.sin((2 * Math.PI * root * at) / RATE) +
            0.6 * Math.sin((2 * Math.PI * root * 2 * at) / RATE) +
            0.3 * Math.sin((2 * Math.PI * root * 4 * at) / RATE)) / 3;
      }
      return out;
    };
    const prints = [220, 247, 330, 180].map((root) => print(stack(root), RATE));
    const usual = ordinary(prints);

    const before = alike(prints[0], prints[1]);
    const after = alike(prints[0], prints[1], usual);
    expect(before, 'two harmonic stacks look alike on their own').toBeGreaterThan(0.9);
    expect(after, `${after.toFixed(3)} with the ordinary out, ${before.toFixed(3)} without`)
      .toBeLessThan(before * 0.8);
  });
});

describe('folding a recording to one channel', () => {
  it('averages the sides rather than summing them', () => {
    const ctx = new OfflineAudioContext(2, 8, RATE);
    const buffer = ctx.createBuffer(2, 8, RATE);
    buffer.getChannelData(0).fill(0.4);
    buffer.getChannelData(1).fill(0.8);
    const flat = mono(buffer);
    expect(flat).toHaveLength(8);
    // Summed it would be 1.2, which is past full scale for two sides that
    // were not.
    for (const value of flat) expect(value, 'the mean of the two').toBeCloseTo(0.6, 6);
  });

  it('keeps a single channel as it is', () => {
    const ctx = new OfflineAudioContext(1, 4, RATE);
    const buffer = ctx.createBuffer(1, 4, RATE);
    buffer.getChannelData(0).set([1, -1, 0.5, -0.25]);
    expect(Array.from(mono(buffer)).map((v) => Math.round(v * 100) / 100))
      .toEqual([1, -1, 0.5, -0.25]);
  });
});
