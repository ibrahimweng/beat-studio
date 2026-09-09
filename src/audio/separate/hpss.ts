/**
 * Telling a hit from a note, which is most of what separating a beat is.
 *
 * Look at a spectrogram of any music and two shapes stand out. A held note is
 * a horizontal line: the same few frequencies, frame after frame. A drum is a
 * vertical line: every frequency at once, for a moment. Nothing else in music
 * looks like either.
 *
 * So the two are found by asking each cell which shape it belongs to, and the
 * question is asked with a median rather than an average. The median along
 * time, over a fifth of a second, keeps whatever was there for the whole
 * fifth of a second and throws away anything that was there for one frame of
 * it — which is a held note with the drums taken out. The median along
 * frequency, over a few hundred hertz, keeps whatever was spread across the
 * whole band and throws away anything sitting in one bin — which is a drum
 * with the notes taken out. Two estimates of the same sound, and the share of
 * each cell that goes to each part is how they compare.
 *
 * This is Fitzgerald's method, and it is here rather than something cleverer
 * because it needs no training, no model and no assumption about what
 * instruments are playing. It cannot tell a violin from a flute. What it can
 * do is take the kit out from under both, reliably, on material it has never
 * seen — and every honest thing further down this folder is built on having
 * the drums on their own.
 *
 * A median rather than an average matters more than it sounds. An average over
 * time is a low-pass filter: a snare hit still raises it, so the harmonic
 * estimate keeps a smeared ghost of every drum and the percussive part comes
 * out thin. A median is not moved by one frame out of seventeen at all.
 */

/** How far each median looks, in frames and in bins. */
export const OVER_TIME = 17;
export const OVER_BANDS = 17;

/**
 * How hard the two are pulled apart.
 *
 * The share of a cell going to the drums is the percussive estimate over the
 * sum of both, each raised to this power. At one it is a plain proportion,
 * which leaves every cell a blend of the two. Raising it makes a cell where
 * one estimate is clearly bigger go almost entirely that way, while leaving
 * the genuinely ambiguous cells shared — which is what a soft mask is for.
 * Two is the usual choice and is what a Wiener filter on these two estimates
 * works out to.
 */
const POWER = 2;

export interface HpssOptions {
  /**
   * Which way to lean, from nought for notes to one for hits, with a half
   * meaning neither.
   *
   * Here because the right answer is not the same for every recording. A
   * heavily compressed mix has drums smeared across time until they look
   * partly harmonic; an acoustic recording has a piano attack that looks
   * partly percussive. One control, honestly labelled, beats guessing.
   */
  lean?: number;
  overTime?: number;
  overBands?: number;
}

/**
 * The share of every cell that belongs to the hits.
 *
 * The notes get the rest. Returned as one array rather than two because the
 * two always add to exactly one and returning both invites somebody to
 * change one of them.
 */
export function percussiveMask(
  mag: Float32Array,
  frames: number,
  bins: number,
  options: HpssOptions = {},
): Float32Array {
  const overTime = options.overTime ?? OVER_TIME;
  const overBands = options.overBands ?? OVER_BANDS;
  const lean = Math.min(0.999, Math.max(0.001, options.lean ?? 0.5));
  // A multiplier on the percussive side rather than a different formula, so a
  // half is exactly neutral and the two ends are each other's mirror.
  const tilt = lean / (1 - lean);

  const harmonic = medianAlongTime(mag, frames, bins, overTime);
  const percussive = medianAlongBands(mag, frames, bins, overBands);

  const out = new Float32Array(frames * bins);
  for (let i = 0; i < out.length; i++) {
    const p = Math.pow(percussive[i] * tilt, POWER);
    const h = Math.pow(harmonic[i], POWER);
    const total = p + h;
    // A cell with nothing in it is silence and belongs to neither. Splitting
    // it evenly would be the same audio and a worse answer to look at.
    out[i] = total > 1e-20 ? p / total : 0;
  }
  return out;
}

/** The same numbers the mask was built from, for the pages that measure this. */
export function estimates(
  mag: Float32Array,
  frames: number,
  bins: number,
  options: HpssOptions = {},
): { harmonic: Float32Array; percussive: Float32Array } {
  return {
    harmonic: medianAlongTime(mag, frames, bins, options.overTime ?? OVER_TIME),
    percussive: medianAlongBands(mag, frames, bins, options.overBands ?? OVER_BANDS),
  };
}

/**
 * Median down each bin's own row through time: what was there all along.
 *
 * Edges take the nearest frame rather than a zero, because a signal that
 * starts loud would otherwise have its first tenth of a second read as half
 * silence and be handed to the drums.
 *
 * Reading one bin across time steps four kilobytes at a stride, which looks
 * like the sort of thing to gather into a run of its own first. It was tried
 * and it is worth nothing at all — 549 against 541 milliseconds over twenty
 * seconds of music — because the stride is regular enough for the processor to
 * see it coming and the sort below is what the time actually goes on. Left
 * plain, on the strength of the measurement rather than the reasoning.
 */
function medianAlongTime(
  mag: Float32Array,
  frames: number,
  bins: number,
  span: number,
): Float32Array {
  const out = new Float32Array(frames * bins);
  const half = span >> 1;
  const scratch = new Float32Array(span);

  for (let k = 0; k < bins; k++) {
    for (let f = 0; f < frames; f++) {
      for (let i = 0; i < span; i++) {
        const at = Math.min(frames - 1, Math.max(0, f - half + i));
        scratch[i] = mag[at * bins + k];
      }
      out[f * bins + k] = median(scratch);
    }
  }
  return out;
}

/** Median across each frame's own bins: what was spread across the band. */
function medianAlongBands(
  mag: Float32Array,
  frames: number,
  bins: number,
  span: number,
): Float32Array {
  const out = new Float32Array(frames * bins);
  const half = span >> 1;
  const scratch = new Float32Array(span);

  for (let f = 0; f < frames; f++) {
    const row = f * bins;
    for (let k = 0; k < bins; k++) {
      for (let i = 0; i < span; i++) {
        scratch[i] = mag[row + Math.min(bins - 1, Math.max(0, k - half + i))];
      }
      out[row + k] = median(scratch);
    }
  }
  return out;
}

/**
 * The middle value of a short run, by insertion sort.
 *
 * Insertion sort because the runs are seventeen long and this is called some
 * tens of millions of times: anything with a partition step in it spends more
 * on bookkeeping than the sort costs. The array is scratch and is overwritten
 * on every call, which is the only reason this is fast enough to use.
 */
export function median(values: Float32Array): number {
  const n = values.length;
  for (let i = 1; i < n; i++) {
    const value = values[i];
    let j = i - 1;
    while (j >= 0 && values[j] > value) {
      values[j + 1] = values[j];
      j--;
    }
    values[j + 1] = value;
  }
  const half = n >> 1;
  return n % 2 ? values[half] : (values[half - 1] + values[half]) / 2;
}
