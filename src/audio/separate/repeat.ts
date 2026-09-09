/**
 * What happens over and over, and what happens once.
 *
 * A beat is a loop. Whatever else is going on, some of a track is the same
 * two or four bars coming round again, and some of it is a line that is
 * different every time. That is a second way of cutting a mix in half, and it
 * is a completely different cut from hit-or-note: a hi-hat pattern and a
 * bassline are both part of the loop, and a vocal and a solo are both not.
 *
 * It is found without being told the tempo. Take the spectrogram and ask, for
 * every possible lag, how much the recording resembles itself that far along.
 * A loop shows up as a peak at its own length, and at every multiple of it.
 * Then the loop itself is built by laying every repetition on top of the
 * others and taking the median of each cell, which keeps what is in most
 * repetitions and drops what is in one — the median again, and for the same
 * reason it is used in `hpss.ts`.
 *
 * The last step is the one that makes this work rather than nearly work: a
 * cell of the loop is never allowed to be louder than the cell in front of it.
 * Without that, a repetition where the loop is quiet has more subtracted from
 * it than it contains, and the difference comes back as a hole in the shape of
 * the drums.
 *
 * This is Rafii and Pardo's method. What it is good for and what it is not:
 * it is very good on anything built over a loop, which is most of what anybody
 * calls a beat, and it has nothing to say about music that never repeats. When
 * it finds no period it says so and returns nothing rather than inventing a
 * split, which is the difference between a measurement and a guess.
 */

import { median } from './hpss.ts';

/** The shortest and longest loop worth looking for, in seconds. */
const SHORTEST = 0.4;
const LONGEST = 6;

/** How many times a loop has to come round before it counts as a loop. */
const TIMES = 3;

/**
 * How far above its own surroundings a peak has to stand to be a period.
 *
 * Not against the average of the whole curve, which was tried and does not
 * work: how much a recording resembles itself falls away steeply with the lag,
 * so the average is mostly a statement about the trend and every short lag
 * beats it. The comparison is against the median of the tenth of a second
 * either side, which removes the trend and leaves only what stands out
 * locally.
 *
 * Measured on the material in `repeat.test.ts`: a loop with nothing over it
 * stands about five times above its surroundings, a loop with a line over it
 * about a third above, and material with nothing repeating in it at all half a
 * per cent above. Fifteen per cent sits between the last two with room either
 * side.
 */
const STANDS_OUT = 0.15;

/** How far either side the local baseline is taken from, in seconds. */
const BASELINE = 0.1;

export interface RepeatResult {
  /** How much of each cell is part of the loop, nought to one. */
  mask: Float32Array;
  /** The loop's length in seconds, or null when there is no loop. */
  period: number | null;
  /** How far the peak stood above the ordinary, for reporting. */
  strength: number;
}

/**
 * How much of every cell is part of the repeating background.
 *
 * `perFrame` is how many seconds one frame covers, which is the hop rather
 * than the window: it is what turns a lag in frames into a period in seconds
 * and it is the one thing here that has to come from outside.
 */
export function repeatingMask(
  mag: Float32Array,
  frames: number,
  bins: number,
  perFrame: number,
  options: { shortest?: number; longest?: number } = {},
): RepeatResult {
  const shortest = Math.max(1, Math.round((options.shortest ?? SHORTEST) / perFrame));
  const longest = Math.min(
    Math.floor(frames / TIMES),
    Math.round((options.longest ?? LONGEST) / perFrame),
  );

  const mask = new Float32Array(frames * bins);
  if (longest <= shortest) return { mask, period: null, strength: 0 };

  /*
   * The loop is looked for on a coarse copy and applied to the fine one.
   *
   * The self-similarity curve is a sum over frequency, so grouping a thousand
   * bins into thirty two bands barely moves it — and it turns the one expensive
   * step here into a cheap one. Measured over twenty seconds of music the curve
   * at full resolution is three hundred and sixty million multiplications, or
   * about two seconds, which is as much as everything else in this folder put
   * together; over thirty two bands it is eleven million. The model that
   * actually does the separating is still built at full resolution, where it
   * matters.
   */
  const small = inBands(mag, frames, bins, SEARCH_BANDS);
  const beats = beatSpectrum(small, frames, SEARCH_BANDS, longest);
  const found = strongestLag(beats, shortest, longest, Math.max(5, Math.round(BASELINE / perFrame)));
  if (!found) return { mask, period: null, strength: 0 };

  const period = refine(small, frames, SEARCH_BANDS, found.lag);
  const slots = Math.max(1, Math.round(period));
  const model = loopModel(mag, frames, bins, period, slots);

  for (let f = 0; f < frames; f++) {
    const row = f * bins;
    const at = slotOf(f, period, slots) * bins;
    for (let k = 0; k < bins; k++) {
      const here = mag[row + k];
      // Never more of the loop than there is sound. This is the whole
      // difference between a clean split and a hole in the drums.
      const loop = Math.min(model[at + k], here);
      mask[row + k] = here > 1e-20 ? loop / here : 0;
    }
  }

  return { mask, period: period * perFrame, strength: found.strength };
}

/**
 * How much the recording resembles itself at every lag.
 *
 * Divided by how many pairs of frames each lag actually had, so a long lag is
 * not penalised for having less of the recording to compare, and then scaled
 * against the lag of nothing, which is the recording against itself. That
 * leaves a curve starting at one and falling, with a bump at the loop.
 */
export function beatSpectrum(
  mag: Float32Array,
  frames: number,
  bins: number,
  most: number,
): Float64Array {
  const out = new Float64Array(most + 1);
  for (let lag = 0; lag <= most; lag++) {
    let sum = 0;
    const pairs = frames - lag;
    if (pairs <= 0) break;
    for (let f = 0; f < pairs; f++) {
      const a = f * bins;
      const b = (f + lag) * bins;
      for (let k = 0; k < bins; k++) sum += mag[a + k] * mag[b + k];
    }
    out[lag] = sum / pairs;
  }
  const first = out[0] || 1;
  for (let lag = 0; lag <= most; lag++) out[lag] /= first;
  return out;
}

/**
 * The lag a loop is at, or nothing when nothing repeats.
 *
 * Two steps, and the second is the one that matters. First, every local
 * maximum that stands out from its own surroundings is a candidate. Then each
 * candidate is scored by adding up how much its own multiples stand out too,
 * because a loop of half a second also repeats at one second and at one and a
 * half, while one second only repeats at two.
 *
 * That second step is what finds the loop rather than a multiple of it, and
 * the difference is not cosmetic. Taking the tallest peak instead gives twice
 * or four times the true length, which builds the model out of a quarter as
 * many repetitions — and lets anything that happens to come round on the
 * longer spacing, a two-bar vocal phrase for instance, into the background.
 * Measured on a plain loop, the tallest peak is the triple of the true period
 * and the best-scoring one is the period itself.
 */
function strongestLag(
  beats: Float64Array,
  shortest: number,
  longest: number,
  baseline: number,
): { lag: number; strength: number } | null {
  const lift = liftAbove(beats, longest, baseline);

  let best: { lag: number; strength: number; score: number } | null = null;
  for (let lag = shortest; lag <= longest; lag++) {
    if (lift[lag] < STANDS_OUT) continue;
    // A local maximum, so a point partway up a slope is not a candidate.
    if (beats[lag] < beats[lag - 1]) continue;
    if (lag + 1 <= longest && beats[lag] < beats[lag + 1]) continue;

    let score = 0;
    for (let m = 1; m * lag <= longest; m++) {
      /*
       * A frame either side of each multiple, because a period is rarely a
       * whole number of frames. Half a second at this hop is forty six and
       * seven eighths of them, so the eighth of a frame it is out by has grown
       * to a whole frame by the eighth repetition and the multiples stop
       * landing where the arithmetic says they should.
       */
      let here = 0;
      for (let j = -1; j <= 1; j++) {
        const at = m * lag + j;
        if (at >= 1 && at <= longest) here = Math.max(here, lift[at]);
      }
      score += Math.max(0, here);
    }
    if (!best || score > best.score) best = { lag, strength: lift[lag], score };
  }

  return best ? { lag: best.lag, strength: best.strength } : null;
}

/**
 * How far each lag stands above the tenth of a second around it, as a share.
 *
 * A median rather than an average of the neighbourhood, so the peak being
 * measured does not raise the thing it is being measured against.
 */
function liftAbove(beats: Float64Array, longest: number, span: number): Float64Array {
  const out = new Float64Array(longest + 1);
  const half = span >> 1;
  const near = new Float32Array(half * 2 + 1);

  for (let lag = 1; lag <= longest; lag++) {
    for (let j = -half; j <= half; j++) {
      near[j + half] = beats[Math.min(longest, Math.max(1, lag + j))];
    }
    const around = median(near);
    out[lag] = around > 1e-12 ? beats[lag] / around - 1 : 0;
  }
  return out;
}

/** How many bands the period search reduces the spectrogram to. */
const SEARCH_BANDS = 32;

/** How far either side of the whole frame the period is searched, and how finely. */
const SEARCH_REACH = 1;
const SEARCH_STEP = 0.02;

/**
 * The period to within a fraction of a frame.
 *
 * This is not a refinement for the sake of a decimal place. A period is almost
 * never a whole number of frames — half a second at this hop is forty six and
 * seven eighths — and rounding it once means the model drifts a little further
 * out of step on every repetition. After twelve of them the eighth of a frame
 * has grown to a frame and a half, which is most of the width of a drum hit,
 * so the median across repetitions is taken over cells that are no longer the
 * same part of the loop and the model comes out weak.
 *
 * Measured on clicks half a second apart with a slide over them, the
 * background held 84 per cent of the clicks with the period rounded to a whole
 * frame and 91 per cent with it searched for. The rounded version was not
 * obviously broken, which is the reason to write this down: it split the
 * material, the parts added up, and it quietly left a sixth of the drums in
 * the wrong place.
 *
 * Searched rather than interpolated. A parabola through the peak and its two
 * neighbours is the usual way of reading a maximum that falls between two
 * samples, and it was the first version. It moved the period the wrong way —
 * to 46.74 against a true 46.875, and 76 per cent, worse than not refining at
 * all — because the peak is smeared by the very drift this is trying to remove
 * and a smeared peak is not a parabola. So the thing that is actually wanted
 * is measured instead: how much of the recording a model at that period
 * accounts for, over a coarse version of the spectrogram where it costs almost
 * nothing to try a hundred of them.
 */
function refine(small: Float32Array, frames: number, bands: number, lag: number): number {
  let best = lag;
  let most = -Infinity;
  for (let period = lag - SEARCH_REACH; period <= lag + SEARCH_REACH; period += SEARCH_STEP) {
    if (period < 2) continue;
    const score = explained(small, frames, bands, period);
    if (score > most) {
      most = score;
      best = period;
    }
  }
  return best;
}

/** The spectrogram summed into a few bands, which is enough to align it by. */
function inBands(mag: Float32Array, frames: number, bins: number, bands: number): Float32Array {
  const out = new Float32Array(frames * bands);
  for (let f = 0; f < frames; f++) {
    const row = f * bins;
    const into = f * bands;
    for (let k = 0; k < bins; k++) {
      // Log spaced, so the low end where a loop's weight sits is not one band.
      const band = Math.min(
        bands - 1,
        Math.floor((Math.log2(1 + k) / Math.log2(1 + bins)) * bands),
      );
      out[into + band] += mag[row + k];
    }
  }
  return out;
}

/**
 * How much of a coarse spectrogram a loop at this period accounts for.
 *
 * The same arithmetic the mask does — the median across repetitions, held down
 * to what is actually there — added up. Maximising it is the same thing as
 * asking which period lines the repetitions up best.
 */
function explained(small: Float32Array, frames: number, bands: number, period: number): number {
  const slots = Math.max(1, Math.round(period));
  const model = loopModel(small, frames, bands, period, slots);
  let total = 0;
  for (let f = 0; f < frames; f++) {
    const row = f * bands;
    const at = slotOf(f, period, slots) * bands;
    for (let b = 0; b < bands; b++) total += Math.min(model[at + b], small[row + b]);
  }
  return total;
}

/**
 * Where in the loop a frame falls, with no drift however far along it is.
 *
 * Counted from the start every time rather than by stepping, so the fractional
 * part of the period never accumulates: frame 469 against a period of 46.875 is
 * a quarter of a frame into the tenth repetition, not a frame and a half into
 * whichever one the rounding landed on.
 */
function slotOf(frame: number, period: number, slots: number): number {
  const into = frame - Math.floor(frame / period) * period;
  return Math.min(slots - 1, Math.round(into) % slots);
}

/**
 * The loop itself, one period long, as the median of every repetition.
 *
 * The median rather than the average, so a cell that is loud in one repetition
 * and quiet in the rest does not raise the model: it is the thing being
 * separated out, not part of the loop.
 */
function loopModel(
  mag: Float32Array,
  frames: number,
  bins: number,
  period: number,
  slots: number,
): Float32Array {
  const out = new Float32Array(slots * bins);

  // Which frames belong to each slot, gathered once rather than searched for
  // per bin: the mapping is the same for all thousand of them.
  const inSlot: number[][] = Array.from({ length: slots }, () => []);
  for (let f = 0; f < frames; f++) inSlot[slotOf(f, period, slots)].push(f);

  /*
   * The largest slot decides the working size, and it is not the average.
   *
   * Sizing it from the average — the number of repetitions the recording holds
   * — was the first version and it threw partway through the period search. A
   * period a shade above a whole number of frames sends both ends of it to the
   * same slot, so one slot takes twice its share while the rest take slightly
   * less. Measured is measured.
   */
  let times = 0;
  for (const which of inSlot) times = Math.max(times, which.length);
  if (!times) return out;

  const scratch = new Float32Array(times);
  for (let p = 0; p < slots; p++) {
    const which = inSlot[p];
    if (!which.length) continue;
    for (let k = 0; k < bins; k++) {
      for (let j = 0; j < which.length; j++) scratch[j] = mag[which[j] * bins + k];
      out[p * bins + k] = median(scratch.subarray(0, which.length));
    }
  }
  return out;
}
