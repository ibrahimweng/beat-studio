/**
 * The short-time Fourier transform, and putting a sound back together again.
 *
 * Everything in this folder works the same way: measure a sound in time and
 * frequency at once, decide what share of each cell belongs to which part,
 * and turn each share back into audio. This file is the two ends of that —
 * taking a signal apart into overlapping windows and adding them back up.
 *
 * The one property worth stating, because the rest of the folder rests on it:
 * a signal taken apart and put straight back together is the signal, to
 * within float error. Not approximately, not with a fade at each end. That is
 * what makes it honest to say a set of separated parts adds back up to the
 * recording, and it is the first thing `stft.test.ts` checks.
 *
 * Getting there needs the windows to be undone as well as applied. A Hann
 * window at a quarter of its own length happens to sum to a constant in the
 * middle and does not at the two ends, and a great many implementations of
 * this quietly fade the first and last few milliseconds of everything they
 * touch as a result. So the sum of the squared windows is accumulated
 * alongside the audio and divided out at the end, which is exact everywhere
 * including the ends, and stays exact if the window or the hop is changed.
 *
 * Nothing here touches the page.
 */

import { fft } from '../listen.ts';

/**
 * How wide a window is, and how far it steps.
 *
 * 2048 at 48k is 43 milliseconds, which is the usual compromise for music:
 * long enough to tell two notes a semitone apart from each other, short
 * enough that a snare is still an event rather than a smear. A quarter-length
 * hop is what the median filtering downstream expects — eight windows across
 * a tenth of a second is what makes a percussive ridge a ridge.
 */
export const SIZE = 2048;
export const HOP = SIZE / 4;

/**
 * A sound in time and frequency, as flat arrays.
 *
 * Frame-major, so one frame's bins are next to each other in memory: every
 * pass in this folder walks a frame at a time, and the frequency-axis median
 * in `hpss.ts` walks within one. Float32 rather than Float64 because this is
 * the one thing here big enough to matter — a minute of stereo at these
 * settings is a hundred megabytes at single precision and two hundred at
 * double, which is the difference between working and a tab that stops.
 */
export interface Spectra {
  frames: number;
  /** Bins from nought to the Nyquist frequency, inclusive. */
  bins: number;
  re: Float32Array;
  im: Float32Array;
  size: number;
  hop: number;
  /** How long the signal was, so it can be put back at exactly that length. */
  length: number;
}

/** A Hann window, cached because every call wants the same one. */
const windows = new Map<number, Float64Array>();

export function hann(size: number): Float64Array {
  const held = windows.get(size);
  if (held) return held;
  const out = new Float64Array(size);
  // Periodic rather than symmetric, which is the one that overlap-adds
  // smoothly. The symmetric version repeats a sample every hop and puts a
  // faint tone at the frame rate into everything.
  for (let i = 0; i < size; i++) out[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  windows.set(size, out);
  return out;
}

/**
 * Take a signal apart.
 *
 * Frames are laid out so that the first one is centred on the first sample
 * rather than starting there — the window reaches back past the beginning
 * into zeros. Without that, the first half-window of every separated part
 * would be reconstructed from one frame instead of four and would come back
 * quieter than it went in.
 */
export function analyse(data: Float32Array, size = SIZE, hop = HOP): Spectra {
  const window = hann(size);
  const half = size >> 1;
  const bins = half + 1;
  const frames = Math.max(1, Math.ceil(data.length / hop) + 1);

  const re = new Float32Array(frames * bins);
  const im = new Float32Array(frames * bins);
  const workRe = new Float64Array(size);
  const workIm = new Float64Array(size);

  for (let f = 0; f < frames; f++) {
    const start = f * hop - half;
    for (let i = 0; i < size; i++) {
      const at = start + i;
      workRe[i] = at >= 0 && at < data.length ? data[at] * window[i] : 0;
      workIm[i] = 0;
    }
    fft(workRe, workIm);
    const row = f * bins;
    for (let k = 0; k < bins; k++) {
      re[row + k] = workRe[k];
      im[row + k] = workIm[k];
    }
  }

  return { frames, bins, re, im, size, hop, length: data.length };
}

/**
 * Put it back together.
 *
 * The inverse transform is the forward one with the imaginary part flipped:
 * a signal that was real to begin with comes back as the real part over the
 * window length. The bins above the Nyquist frequency are the mirror of the
 * ones below it and are rebuilt here rather than stored, which halves what
 * every mask in this folder has to be written across.
 */
export function synthesise(spec: Spectra): Float32Array {
  const { frames, bins, re, im, size, hop, length } = spec;
  const window = hann(size);
  const half = size >> 1;

  const out = new Float32Array(length);
  /*
   * The sum of the squared windows landing on each sample, divided out below.
   *
   * This is the part that is usually left out. With a Hann window at a
   * quarter of its length the sum is 1.5 across the middle and ramps up to it
   * across the first half-window, so leaving it out is a fade in and a fade
   * out on every part — inaudible on one, and a hole in the sum of four.
   */
  const weight = new Float32Array(length);

  const workRe = new Float64Array(size);
  const workIm = new Float64Array(size);

  for (let f = 0; f < frames; f++) {
    const row = f * bins;
    for (let k = 0; k < bins; k++) {
      workRe[k] = re[row + k];
      // Flipped, which is what turns the forward transform into the inverse.
      workIm[k] = -im[row + k];
    }
    // The mirror. Bin nought and the Nyquist bin are their own reflections.
    for (let k = 1; k < half; k++) {
      workRe[size - k] = workRe[k];
      workIm[size - k] = -workIm[k];
    }
    fft(workRe, workIm);

    const start = f * hop - half;
    for (let i = 0; i < size; i++) {
      const at = start + i;
      if (at < 0 || at >= length) continue;
      const w = window[i];
      out[at] += (workRe[i] / size) * w;
      weight[at] += w * w;
    }
  }

  for (let i = 0; i < length; i++) {
    // A sample no window reached stays at nothing rather than dividing by it.
    if (weight[i] > 1e-8) out[i] /= weight[i];
  }
  return out;
}

/** How loud each cell is, which is what every mask is decided from. */
export function magnitudes(spec: Spectra): Float32Array {
  const out = new Float32Array(spec.frames * spec.bins);
  for (let i = 0; i < out.length; i++) out[i] = Math.hypot(spec.re[i], spec.im[i]);
  return out;
}

/**
 * A share of a sound, as a copy scaled cell by cell.
 *
 * The mask is real and is applied to both channels the same way, which is
 * what keeps a stereo image intact: scaling the two sides by different
 * numbers moves a source rather than quietening it.
 */
export function masked(spec: Spectra, mask: Float32Array): Spectra {
  const re = new Float32Array(spec.re.length);
  const im = new Float32Array(spec.im.length);
  for (let i = 0; i < re.length; i++) {
    const m = mask[i];
    re[i] = spec.re[i] * m;
    im[i] = spec.im[i] * m;
  }
  return { ...spec, re, im };
}

/** Frequency of a bin, in hertz. */
export function binHz(bin: number, size: number, rate: number): number {
  return (bin * rate) / size;
}
