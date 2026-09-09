import { describe, expect, it } from 'vitest';
import { analyse, hann, magnitudes, masked, synthesise, HOP, SIZE } from './stft.ts';

/**
 * The two ends of every separation in this folder.
 *
 * Everything else here decides what share of a cell belongs to which part.
 * This decides whether a share means anything at all: if taking a sound apart
 * and putting it straight back together is not the sound, then no statement
 * about the parts adding up is worth making, and every one of them is made
 * further down.
 */

const RATE = 48_000;

function noise(count: number, seed = 1): Float32Array {
  const out = new Float32Array(count);
  let state = seed;
  for (let i = 0; i < count; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (state / 0x3fffffff - 1) * 0.5;
  }
  return out;
}

function tone(hz: number, count: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / RATE);
  return out;
}

/** The largest gap between two signals, which is the only number that matters. */
function worst(a: Float32Array, b: Float32Array): number {
  let most = 0;
  for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i] - b[i]));
  return most;
}

describe('the window', () => {
  it('starts and ends at nothing and peaks in the middle', () => {
    const w = hann(64);
    expect(w[0]).toBeCloseTo(0, 12);
    expect(w[32]).toBeCloseTo(1, 12);
    // Periodic, not symmetric: the last sample is not a second zero, which is
    // what makes consecutive windows overlap-add without a ripple.
    expect(w[63]).toBeGreaterThan(0);
    expect(w[63]).toBeLessThan(0.01);
  });
});

describe('taking a signal apart and putting it back', () => {
  /*
   * The claim the rest of the folder rests on.
   *
   * Every separated part is this round trip with a mask in the middle, so
   * whatever this loses is lost by all of them, and whatever it invents at the
   * edges appears in all of them at once.
   */
  it('gives back what it was given', () => {
    const data = noise(20_000, 7);
    const back = synthesise(analyse(data));
    expect(back.length).toBe(data.length);
    expect(worst(data, back)).toBeLessThan(1e-4);
  });

  /*
   * Including at the two ends, which is where this is usually wrong.
   *
   * The sum of the squared Hann windows is 1.5 across the middle of a signal
   * and ramps up to it across the first half-window. An implementation that
   * divides by the constant instead of by the sum fades the first and last
   * twenty milliseconds of everything it touches. Inaudible on one part, and
   * a hole in the sum of four.
   */
  it('does not fade the first and last window', () => {
    const data = new Float32Array(8000).fill(0.5);
    const back = synthesise(analyse(data));
    for (const at of [0, 1, 5, SIZE >> 1, 4000, data.length - 1]) {
      expect(back[at], `sample ${at} came back as ${back[at]}`).toBeCloseTo(0.5, 3);
    }
  });

  it('gives back a signal shorter than one window', () => {
    const data = tone(440, 300);
    const back = synthesise(analyse(data));
    expect(back.length).toBe(300);
    expect(worst(data, back)).toBeLessThan(1e-4);
  });

  it('gives back what it was given at other window sizes and hops', () => {
    const data = noise(9000, 3);
    for (const [size, hop] of [
      [512, 128],
      [1024, 512],
      [4096, 1024],
    ] as const) {
      const back = synthesise(analyse(data, size, hop));
      expect(worst(data, back), `size ${size} hop ${hop}`).toBeLessThan(1e-4);
    }
  });
});

describe('what a cell holds', () => {
  it('puts a tone in the bin it belongs to', () => {
    const bin = 40;
    const spec = analyse(tone((bin * RATE) / SIZE, SIZE * 4));
    const mag = magnitudes(spec);
    // The frame in the middle, which is the one with a full window of tone in
    // it rather than a window half full of the run-in.
    const frame = spec.frames >> 1;
    let loudest = 0;
    let where = -1;
    for (let k = 0; k < spec.bins; k++) {
      const value = mag[frame * spec.bins + k];
      if (value > loudest) {
        loudest = value;
        where = k;
      }
    }
    expect(where).toBe(bin);
  });
});

describe('a share of a sound', () => {
  /*
   * Two masks that add to one give back two parts that add to the signal.
   *
   * This is the whole design of the separation: a cell is not assigned to a
   * part, it is divided between them, and the divisions add to one. So there
   * is no residue and nothing is counted twice, and it holds for any masks
   * whatever — which is why the tests further down check that the masks add to
   * one rather than checking the audio again each time.
   */
  it('adds back up when the masks add to one', () => {
    const data = noise(12_000, 11);
    const spec = analyse(data);
    const cells = spec.frames * spec.bins;

    const one = new Float32Array(cells);
    const other = new Float32Array(cells);
    for (let i = 0; i < cells; i++) {
      // An arbitrary split that varies cell to cell, since a mask that is the
      // same everywhere would pass this by accident.
      one[i] = (i % 17) / 17;
      other[i] = 1 - one[i];
    }

    const a = synthesise(masked(spec, one));
    const b = synthesise(masked(spec, other));
    const sum = new Float32Array(data.length);
    for (let i = 0; i < sum.length; i++) sum[i] = a[i] + b[i];
    expect(worst(data, sum)).toBeLessThan(1e-4);
  });

  it('keeps nothing when the mask is nothing', () => {
    const spec = analyse(noise(6000, 5));
    const nothing = new Float32Array(spec.frames * spec.bins);
    const back = synthesise(masked(spec, nothing));
    for (const value of back) expect(value).toBe(0);
  });
});

describe('the settings', () => {
  it('steps a quarter of a window at a time', () => {
    expect(HOP * 4).toBe(SIZE);
  });
});
