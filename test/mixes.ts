/**
 * Signals built so that separating them has a right answer.
 *
 * The separation in `src/audio/separate/` is measured two ways. The pages in
 * `tools/` run it on real music, where nobody knows what the right answer is
 * and the only honest report is how it sounds and how much of the mix each
 * part took. These are the other way: mixes assembled here out of parts that
 * are known, where "the drums came out in the drums" is a claim with a number
 * attached.
 *
 * They are deliberately crude. A click every half second is not a drum kit,
 * and a sine is not a violin. What they are is unambiguous — a click is
 * percussive by any definition and a sine is harmonic by any definition — so a
 * measurement that cannot tell those two apart is broken rather than merely
 * imperfect, and one that can has cleared the lowest bar rather than the
 * highest.
 */

export const RATE = 48_000;

/** A steady tone. Harmonic by any definition: one bin, every frame. */
export function tone(hz: number, seconds: number, gain = 0.5, rate = RATE): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / rate) * gain;
  return out;
}

/** A tone that slides, so it cannot be mistaken for a repeating one. */
export function glide(
  from: number,
  to: number,
  seconds: number,
  gain = 0.5,
  rate = RATE,
): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const hz = from + ((to - from) * i) / out.length;
    phase += (2 * Math.PI * hz) / rate;
    out[i] = Math.sin(phase) * gain;
  }
  return out;
}

/**
 * Clicks at a steady spacing. Percussive by any definition: every bin, one
 * frame.
 *
 * A short burst of noise under a fast decay rather than a single sample,
 * because one sample is a spike with no length at all and the measurement
 * being checked works on windows.
 *
 * The same burst every time rather than fresh noise on each one, which matters
 * for `repeat.ts` and for nothing else. A loop is one recording played again,
 * so its repetitions are identical; a click made of new noise each time is a
 * different sound at the same moment, and the median across repetitions that
 * repeating-pattern extraction is built on then reads the variation as
 * foreground. Measured on this material, fresh noise per click held 64 per
 * cent of them in the background and the same burst repeated held 91. The
 * second is what a loop is.
 */
export function clicks(
  everySeconds: number,
  seconds: number,
  gain = 0.7,
  rate = RATE,
  seed = 5,
): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  const gap = Math.round(everySeconds * rate);
  const decay = Math.round(0.02 * rate);

  const burst = new Float32Array(decay);
  let state = seed;
  for (let i = 0; i < decay; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    burst[i] = (state / 0x3fffffff - 1) * gain * Math.exp((-5 * i) / decay);
  }

  for (let at = 0; at < out.length; at += gap) {
    for (let i = 0; i < decay && at + i < out.length; i++) out[at + i] += burst[i];
  }
  return out;
}

/** Two signals added, at the length of the longer. */
export function mix(...parts: readonly Float32Array[]): Float32Array {
  const length = Math.max(...parts.map((part) => part.length));
  const out = new Float32Array(length);
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) out[i] += part[i];
  }
  return out;
}

/**
 * Two channels as an AudioBuffer, which is what a separator takes.
 *
 * `new AudioBuffer` rather than a stub, because `test/web-audio.ts` puts a real
 * implementation on the global and the code under test writes into these as well
 * as reading them.
 */
export function stereo(left: Float32Array, right: Float32Array, rate = RATE): AudioBuffer {
  const length = Math.max(left.length, right.length);
  const buffer = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: rate });
  buffer.getChannelData(0).set(left.subarray(0, length));
  buffer.getChannelData(1).set(right.subarray(0, length));
  return buffer;
}

/** One channel as an AudioBuffer, for the measurements that are about mono. */
export function monoBuffer(data: Float32Array, rate = RATE): AudioBuffer {
  const buffer = new AudioBuffer({ numberOfChannels: 1, length: data.length, sampleRate: rate });
  buffer.getChannelData(0).set(data);
  return buffer;
}

/** How much energy is in a signal, which is what every share below compares. */
export function energy(data: Float32Array): number {
  let sum = 0;
  for (const value of data) sum += value * value;
  return sum;
}

/**
 * What share of a part's energy landed in this stem.
 *
 * Measured by projecting rather than by comparing energies, so a stem that
 * happens to contain something of the same size but a different shape does not
 * score. Written out: how much of `part` is in `stem`, as a fraction, which is
 * one when the stem holds the part exactly and nought when it holds none of it.
 */
export function heldShare(stem: Float32Array, part: Float32Array): number {
  let dot = 0;
  let own = 0;
  const n = Math.min(stem.length, part.length);
  for (let i = 0; i < n; i++) {
    dot += stem[i] * part[i];
    own += part[i] * part[i];
  }
  return own > 1e-20 ? dot / own : 0;
}
