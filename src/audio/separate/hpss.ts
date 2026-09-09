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
const OVER_TIME = 17;
const OVER_BANDS = 17;

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
  const scratch = new Float32Array(span);
  const spans = bandSpans(bins, span);

  for (let f = 0; f < frames; f++) {
    const row = f * bins;
    for (let k = 0; k < bins; k++) {
      const wide = spans[k];
      const half = wide >> 1;
      for (let i = 0; i < wide; i++) {
        scratch[i] = mag[row + Math.min(bins - 1, Math.max(0, k - half + i))];
      }
      out[row + k] = median(scratch.subarray(0, wide));
    }
  }
  return out;
}

/**
 * How many bins the frequency median looks across, at each bin.
 *
 * Odd, always, so there is a middle value to take. Capped at {@link OVER_BANDS},
 * which is where the constant-width version used to sit: past a couple of
 * kilohertz a third of an octave is wider than the band anything useful occupies,
 * and widening it further only costs time.
 */
export function bandSpans(bins: number, most: number): Int32Array {
  const out = new Int32Array(bins);
  for (let k = 0; k < bins; k++) {
    const wide = Math.round(k * SPREAD_OVER * 2);
    out[k] = Math.max(LEAST_BANDS, Math.min(most, wide | 1));
  }
  return out;
}

/**
 * How wide the frequency median looks, as a share of the frequency it is at.
 *
 * A third of an octave either side, which is a constant *musical* width rather
 * than a constant number of hertz, and it is the difference between a drum part
 * with a kick in it and one without.
 *
 * A fixed seventeen bins was the first version and is what every description of
 * this method says. Seventeen bins at this window is four hundred hertz, which is
 * a sliver at five kilohertz and two whole octaves at fifty — so a kick, which
 * lives between forty and a hundred and ten hertz, was being asked whether it
 * filled a band reaching up to two hundred and fifty. It does not, so it read as
 * narrowband, so it read as a note, so it went to the bass. Measured on a kick,
 * a hat and a sustained sub together, the drums held 18 per cent of the kicks and
 * the bass held 77 — which is a drum part with no kick in it, and the single worst
 * result this whole folder produced.
 *
 * In octaves the same question becomes the right one: does this fill the third of
 * an octave around it? A kick does. A bass note, which is one narrow line, does
 * not. With that change the drums hold 74 per cent of the kicks and the bass holds
 * 26.
 */
const SPREAD_OVER = Math.pow(2, 1 / 3) - 1;

/**
 * And never fewer than this many bins.
 *
 * A third of an octave at fifty hertz is two bins, and a median of two of anything
 * says very little. The floor is where the trade lives and it was measured rather
 * than argued: at three bins the drums hold 85 per cent of the kicks and a
 * sustained bass loses 42 per cent of itself into them; at five, 74 and 18; at
 * seven, 51 and 6; at nine, 42 and 3. Five is the last one where the kick is
 * mostly in the drums, and eighteen per cent of a bass line that runs under every
 * kick in the piece is bleed at the moments the kick is masking it anyway.
 *
 * Anybody who disagrees has the Hits and Notes control, which moves the same
 * split without touching this.
 *
 * ---
 *
 * The textbook improvement on this was tried and is not here, which is worth
 * writing down so nobody spends the afternoon on it twice.
 *
 * A kick drum's body is a low note whose pitch falls from about 110 hertz to
 * about 45 in a twentieth of a second. Inside a forty three millisecond window
 * that fall barely happens, so the kick is one narrow line and a narrow line is a
 * note. Over a window four times longer the same fall is smeared across many bins
 * inside a single window, so it reads as broadband and broadband is a hit. That
 * is the published two-window approach, and the reasoning is sound.
 *
 * It was built properly: a second transform per block, both medians rescaled so
 * the two windows ask over the same span of time and the same width of
 * frequency, the larger answer winning, and a version restricted to below 250
 * hertz where a kick's fall actually happens. Measured against the one-window
 * version on a kick, a hat, a snare, a sustained sub and a held pad:
 *
 *   kick into the drums   75 per cent  ->  86
 *   bass into the bass    78 per cent  ->  59
 *   held pad into drums   32 per cent  ->  38
 *   time                  0.19x        ->  0.42x
 *
 * Eleven points of kick for nineteen points of bass, at twice the time. So it
 * was taken out. The same eleven points are available from the Hits and Notes
 * control, which costs nothing and which somebody can move while listening.
 */
const LEAST_BANDS = 5;

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
