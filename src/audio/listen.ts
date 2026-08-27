/**
 * Reading sounds out of a recording.
 *
 * Two jobs, kept apart. Finding where the sounds are is signal processing and
 * has a right answer; deciding what each one is comes later, in
 * `rebuild.ts`, and does not. Nothing here touches the app: it takes samples
 * and gives back numbers.
 *
 * Nothing is uploaded. The file is decoded by the browser, measured here, and
 * never leaves the machine — same as the video, and for the same reason.
 */

/** How wide a look at the sound each measurement takes, and how far it steps. */
const WINDOW = 1024;
const HOP = 256;

/** Two hits closer together than this are one hit with a bump in it. */
const REFRACTORY = 0.09;

/**
 * How long a sound casts a shadow over what follows it.
 *
 * A hit is rarely one rise. A body arrives, then a brighter part of it comes
 * through a moment later, and the second one is a real rise in real energy —
 * it is just not a second sound. Inside this window a rise has to be a decent
 * fraction of the one before it to count as its own event, which is what
 * separates a hit with structure from two hits.
 */
const SHADOW = 0.3;
const SHADOW_SHARE = 0.6;

/**
 * How long a stretch has to be quiet before a swell in it counts as an onset.
 *
 * A whoosh, a riser and a swell have no attack: they fade up, so nothing ever
 * rises sharply enough to be found the usual way. Measured, the whoosh in the
 * test recording was missed entirely and its loudest moment turned up as a
 * spurious event half a second late. A second, slower pass over the same
 * measurement catches them — a third of a second late, which is as sharp an
 * answer as "when did it start" has for a sound that fades up.
 */
const SLOW_SMOOTH = 0.15;
const SLOW_APART = 0.3;
/** How far back the start of a sound is looked for. */
const SLOW_REACH = 0.5;

/**
 * The two points the decay is read from, as shares of a sound's own peak.
 *
 * Six and twenty decibels down. Neither is where the sound stops, and that is
 * the point: the app's own length control means the moment an envelope has
 * fallen to about sixty two decibels down, which is below the noise floor of
 * most recordings and cannot be measured directly. Two points that can be
 * measured give a rate, and the rate gives the rest.
 *
 * Reading the length at a single threshold was tried first. At twenty two
 * decibels down it returned a third of the true length for every decaying
 * voice, so every rebuild was a third as long as the sound it came from —
 * which then made the rebuild pick the wrong voice, since the shape it was
 * matching against was wrong.
 *
 * Read early, at six and twenty decibels down rather than at twenty and
 * forty, because a sound in a room stops being the sound and starts being the
 * room somewhere in between. Reading late measured the room's decay and
 * returned three times the length for anything with reverb on it; reading
 * early measures the sound, which is what the app's length control is for,
 * and leaves the room to the space control.
 */
const AT_6DB = 0.5;
const AT_20DB = 0.1;

/** Where the app's own length control puts the end of an envelope. */
const ENVELOPE_END_DB = 62;

/** The fingerprint's shape: how it changes over time, and what it is made of. */
export const WINDOWS = 8;
export const BANDS = 20;

/**
 * The range a fingerprint covers.
 *
 * Stopping at ten kilohertz rather than at the top of hearing. Everything that
 * says what a sound effect is happens below this, and a recording arrives at
 * whatever rate its file was written at, so a ceiling well under the lowest of
 * those is what lets two sounds be compared at all.
 */
const LOW_HZ = 40;
const TOP_HZ = 10000;

/** One sound found in a recording. */
export interface Heard {
  /** Seconds from the start of the file. */
  at: number;
  /** How long it runs for, in seconds. */
  length: number;
  /** Loudest sample in it, 0 to 1. */
  peak: number;
  /** Seconds from its start to that sample. */
  attack: number;
  /** Where its weight sits, in hertz. */
  centroid: number;
  /** What it is like: see {@link print}. */
  print: Float64Array;
}

/**
 * An iterative radix-2 FFT, in place, on real input.
 *
 * The same one `tools/voice-print.html` uses, moved here so that the app and
 * the pages that measure it cannot come to disagree about what a sound looks
 * like.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
      const nr = cr * wr - ci * wi;
      ci = cr * wi + ci * wr;
      cr = nr;
    }
  }
}

/**
 * What a sound is like, as a list of numbers that can be compared.
 *
 * Eight slices through it, each described by how its energy sits across
 * twenty bands, followed by how loud each slice was. Both halves matter and
 * neither is enough: the bands alone cannot tell a click from a drone made of
 * the same frequencies, and the envelope alone cannot tell a click from a
 * tick.
 *
 * Normalised once at the end rather than slice by slice. Normalising each
 * slice on its own was tried first and it gives a silent slice the same say
 * as a loud one — a short sound in a long window is mostly nothing, and the
 * shape of nothing is whatever noise happens to be in it. Normalising the
 * whole thing once means a slice speaks in proportion to how much sound is
 * in it.
 */
export function print(data: Float32Array, rate: number, from = 0, to = data.length): Float64Array {
  const span = Math.max(WINDOW, to - from);
  const size = WINDOW;
  const step = Math.max(1, Math.floor(span / WINDOWS));

  const edges: number[] = [];
  for (let b = 0; b <= BANDS; b++) edges.push(LOW_HZ * Math.pow(TOP_HZ / LOW_HZ, b / BANDS));

  const out = new Float64Array(WINDOWS * BANDS + WINDOWS);
  const envelope = new Float64Array(WINDOWS);

  for (let w = 0; w < WINDOWS; w++) {
    const start = from + w * step;
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const v = start + i < to ? (data[start + i] ?? 0) : 0;
      sum += v * v;
      re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
    }
    envelope[w] = Math.sqrt(sum / size);

    fft(re, im);
    const bands = new Float64Array(BANDS);
    for (let k = 1; k < size / 2; k++) {
      const hz = (k * rate) / size;
      const mag = Math.hypot(re[k], im[k]);
      for (let b = 0; b < BANDS; b++) {
        if (hz >= edges[b] && hz < edges[b + 1]) {
          bands[b] += mag;
          break;
        }
      }
    }
    for (let b = 0; b < BANDS; b++) out[w * BANDS + b] = bands[b];
  }

  // Doubled, so how a sound moves counts for as much as what it is made of.
  // Without it a rebuild could match the timbre of a hit and be a drone.
  const loud = Math.hypot(...envelope) || 1;
  for (let w = 0; w < WINDOWS; w++) out[WINDOWS * BANDS + w] = (envelope[w] / loud) * 2;

  const total = Math.hypot(...out) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * How alike two prints are, from nothing at zero to the same thing at one.
 *
 * In logs, and with each print's own average taken out of it first. Both
 * matter, and the first attempt did neither: a plain dot product of two lists
 * of non-negative numbers is high for almost any pair, because everything
 * points into the same corner. Measured, it gave ninety seven per cent for
 * the same sound twice, fifty nine for a deliberately wrong voice, and ninety
 * five for a sound the app has no way of making — a scale with no room on it
 * to be wrong, and a search that could not tell a resonant pair of sines from
 * a ratchet.
 *
 * Taking the average out is what leaves only the shape, so two sounds are
 * compared on where they differ from the ordinary rather than on both being
 * sounds. The logs are what stop the loudest band deciding everything: a
 * quiet band that is present in one and absent in the other says as much
 * about what a sound is as a loud one does.
 */
export function alike(a: Float64Array, b: Float64Array, ordinary?: Float64Array): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;

  const x = shape(a, n);
  const y = shape(b, n);
  if (ordinary) {
    for (let i = 0; i < n; i++) {
      x[i] -= ordinary[i];
      y[i] -= ordinary[i];
    }
  }

  let dot = 0;
  let nx = 0;
  let ny = 0;
  for (let i = 0; i < n; i++) {
    dot += x[i] * y[i];
    nx += x[i] * x[i];
    ny += y[i] * y[i];
  }
  const size = Math.sqrt(nx * ny);
  if (!size) return 0;

  // From minus one for opposite to one for identical, folded onto nought to
  // one, since nothing below no-relationship-at-all is a useful distinction.
  return Math.max(0, dot / size);
}

/**
 * What a set of sounds have in common, to be taken out before comparing them.
 *
 * Without this, every voice in the palette scores about ninety per cent
 * against every other one, because they are all sounds: they all start,
 * decay, and hold most of their weight in the middle of the spectrum, and
 * that shared shape is most of what a print is. Measured, the same voice
 * twice scored 0.95 and two different voices 0.89, which leaves no room to
 * choose between forty of them.
 *
 * Taking the average of the whole palette out first leaves only what makes
 * each one itself. It is worked out from the forty renders the search already
 * does, so it costs nothing and it is at the length being searched for rather
 * than at some length decided in advance.
 */
export function ordinary(prints: readonly Float64Array[]): Float64Array {
  const n = prints[0]?.length ?? 0;
  const out = new Float64Array(n);
  if (!n) return out;
  for (const one of prints) {
    const logged = shape(one, n);
    for (let i = 0; i < n; i++) out[i] += logged[i];
  }
  for (let i = 0; i < n; i++) out[i] /= prints.length;
  return out;
}

/** A print in logs, with its own average taken out. */
function shape(print: Float64Array, n: number): Float64Array {
  let most = 0;
  for (let i = 0; i < n; i++) most = Math.max(most, print[i]);
  // Four decades below the loudest thing in it, which is far enough down to
  // count as absent and near enough not to be the noise floor of a float.
  const floor = Math.max(most * 1e-4, 1e-12);

  const out = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    out[i] = Math.log(Math.max(print[i], floor));
    mean += out[i];
  }
  mean /= n;
  for (let i = 0; i < n; i++) out[i] -= mean;
  return out;
}

/** Everything as one channel, since none of this is about where a sound sits. */
export function mono(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += channel[i];
  }
  if (buffer.numberOfChannels > 1) {
    for (let i = 0; i < out.length; i++) out[i] /= buffer.numberOfChannels;
  }
  return out;
}

/**
 * How much the sound changed, frame by frame.
 *
 * Rising energy only, and across the whole spectrum rather than in total: a
 * cymbal over a held bass note is a new sound even though nothing got louder
 * overall, and a bass note swelling is not. Adding up only the bands that
 * grew is what tells those apart, and it is the one measurement that makes
 * onset finding work on real recordings rather than on test tones.
 */
export function flux(data: Float32Array, rate: number): { at: number; value: number }[] {
  const frames: { at: number; value: number }[] = [];
  let previous: Float64Array | null = null;

  for (let start = 0; start + WINDOW <= data.length; start += HOP) {
    const re = new Float64Array(WINDOW);
    const im = new Float64Array(WINDOW);
    for (let i = 0; i < WINDOW; i++) {
      re[i] = data[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW));
    }
    fft(re, im);

    const now = new Float64Array(WINDOW / 2);
    for (let k = 0; k < WINDOW / 2; k++) now[k] = Math.hypot(re[k], im[k]);

    if (previous) {
      let rise = 0;
      for (let k = 1; k < now.length; k++) rise += Math.max(0, now[k] - previous[k]);
      frames.push({ at: start / rate, value: rise });
    }
    previous = now;
  }
  return frames;
}

/** How keen the finder is: nought lets almost everything through, one very little. */
export interface ListenOptions {
  sensitivity?: number;
  /** How many to keep, loudest first, when a file is full of them. */
  most?: number;
}

/**
 * Find the sounds in a recording.
 *
 * The threshold moves with the recording rather than being a number picked in
 * advance, because a quiet passage and a loud one are both full of sounds and
 * a fixed line either misses one or drowns in the other. What counts is a
 * frame that rose more than the frames around it did.
 */
export function listen(buffer: AudioBuffer, options: ListenOptions = {}): Heard[] {
  const rate = buffer.sampleRate;
  const data = mono(buffer);
  const frames = flux(data, rate);
  if (!frames.length) return [];

  const keen = Math.max(0, Math.min(1, options.sensitivity ?? 0.5));

  /*
   * Two passes over the same measurement, at two speeds.
   *
   * The first finds attacks, which is what an onset usually is. The second
   * runs over a smoothed copy and finds things that arrive without one — a
   * whoosh, a riser, a swell — and only where the first pass found nothing
   * nearby, so a hit is not reported twice for having a body.
   */
  const fast = pick(frames, rate, keen);
  const slow = pick(smoothed(frames, rate), rate, keen).filter(
    (at) => !fast.some((sharp) => Math.abs(sharp - at) < SLOW_APART),
  );
  const rough = [...fast, ...slow].sort((a, b) => a - b);
  // Settling walks an onset backwards, which can push it into the one before
  // it — so they are thinned again afterwards rather than only before.
  const times: number[] = [];
  for (let i = 0; i < rough.length; i++) {
    const at = settle(data, rate, rough[i], i ? rough[i - 1] : 0);
    if (!times.length || at - times[times.length - 1] >= REFRACTORY) times.push(at);
  }

  const heard = times.map((at, i) => describe(data, rate, at, times[i + 1] ?? Infinity));

  const most = options.most ?? 60;
  if (heard.length <= most) return heard;
  // The loudest, since a file with hundreds in it is a file where the quiet
  // ones are the room rather than the work.
  return [...heard]
    .sort((a, b) => b.peak - a.peak)
    .slice(0, most)
    .sort((a, b) => a.at - b.at);
}

/**
 * The moments where a run of measurements rose above what was around it.
 *
 * The line moves with the recording rather than being a number picked in
 * advance, because a quiet passage and a loud one are both full of sounds and
 * a fixed line either misses one or drowns in the other.
 */
function pick(
  frames: readonly { at: number; value: number }[],
  rate: number,
  keen: number,
): number[] {
  // A window either side, long enough to hold a phrase and short enough that
  // a change in how busy the recording is still moves the line.
  const near = Math.max(4, Math.round(0.4 / (HOP / rate)));
  const biggest = frames.reduce((most, frame) => Math.max(most, frame.value), 0) || 1;

  const out: number[] = [];
  let last = -Infinity;
  let lastValue = 0;

  for (let i = 1; i < frames.length - 1; i++) {
    const frame = frames[i];
    if (frame.value < frames[i - 1].value || frame.value < frames[i + 1].value) continue;

    const from = Math.max(0, i - near);
    const to = Math.min(frames.length, i + near);
    let sum = 0;
    for (let j = from; j < to; j++) sum += frames[j].value;
    const around = sum / (to - from);

    // Above what is going on around it, and above a share of the loudest
    // thing in the file, so a quiet room does not read as full of events.
    const bar = around * (1.3 + keen * 2.2) + biggest * (0.02 + keen * 0.12);
    if (frame.value < bar) continue;

    const since = frame.at - last;
    if (since < REFRACTORY) continue;
    // Still in the shadow of a bigger one: part of that sound, not its own.
    if (since < SHADOW && frame.value < lastValue * SHADOW_SHARE) continue;

    out.push(frame.at);
    last = frame.at;
    lastValue = frame.value;
  }
  return out;
}

/** The same measurements, blurred, so a slow arrival shows as a rise. */
function smoothed(
  frames: readonly { at: number; value: number }[],
  rate: number,
): { at: number; value: number }[] {
  const span = Math.max(1, Math.round(SLOW_SMOOTH / (HOP / rate)));
  return frames.map((frame, i) => {
    let sum = 0;
    const from = Math.max(0, i - span);
    for (let j = from; j <= i; j++) sum += frames[j].value;
    return { at: frame.at, value: sum / (i - from + 1) };
  });
}

/**
 * Back from the frame that noticed a sound to the sample where it began.
 *
 * A transform a thousand samples wide notices a hit somewhere in the middle
 * of hearing it, so the frame that crosses the line is always late — measured
 * against sounds placed at known moments, by up to forty four milliseconds,
 * which is more than a frame of video. Walking back to where the level
 * actually started to move puts it inside two.
 */
function settle(data: Float32Array, rate: number, at: number, notBefore: number): number {
  const found = Math.round(at * rate);
  // As far back as the level stays up, capped, and never past the sound
  // before this one. A hit stops walking within a few milliseconds because
  // what came before it was quiet; a swell keeps going back to where it
  // began, which is the whole reason the cap is half a second rather than
  // one window.
  const back = Math.max(Math.round(notBefore * rate), found - Math.round(SLOW_REACH * rate));
  const ahead = Math.min(data.length, found + Math.round(0.04 * rate));
  const step = Math.max(1, Math.round(0.002 * rate));

  const level = (from: number): number => {
    let sum = 0;
    const to = Math.min(data.length, from + step);
    for (let i = from; i < to; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / Math.max(1, to - from));
  };

  let loudest = 0;
  for (let i = found; i < ahead; i += step) loudest = Math.max(loudest, level(i));
  if (loudest <= 0) return at;

  // The first moment on the way in that is a fifth of what it becomes.
  for (let i = back; i < found; i += step) {
    if (level(i) > loudest * 0.2) return i / rate;
  }
  return at;
}

/**
 * What one stretch of sound is: how loud, how quickly, how long, how bright.
 *
 * Used on both sides of the comparison — on a recording to find out what was
 * heard, and on a candidate to find out what was built — because a
 * fingerprint divides whatever span it is given into eight slices, so the two
 * spans have to be decided the same way or the slices describe different
 * parts of the two sounds.
 *
 * Deciding the candidate's span from its length parameter instead was tried,
 * and it is what made a recording of this app's own metal come back as a
 * bell: the length read off a recording is a few tens of per cent out, so the
 * two prints covered different fractions of their sounds and the right answer
 * scored below the wrong one. Measuring both the same way makes that error
 * cancel rather than compound.
 */
export function measure(
  data: Float32Array,
  rate: number,
  from: number,
  limit: number,
): { peak: number; peakAt: number; ends: number; centroid: number } {
  let peak = 0;
  let peakAt = from;
  for (let i = from; i < limit; i++) {
    const v = Math.abs(data[i]);
    if (v > peak) {
      peak = v;
      peakAt = i;
    }
  }

  /*
   * How long it runs, from how fast it is fading.
   *
   * Measured on a smoothed level rather than on single samples, since any
   * waveform passes through zero constantly and would otherwise read as
   * having stopped on its first cycle. The last moment above each of two
   * thresholds gives a rate in decibels per second, and the rate says where
   * an envelope falling at that rate would reach the point the app's own
   * length control means by the end.
   */
  const smooth = Math.max(1, Math.round(0.01 * rate));
  let past6 = peakAt;
  let past20 = peakAt;
  let run = 0;
  for (let i = peakAt; i < limit; i++) {
    run += data[i] * data[i];
    if (i - peakAt >= smooth) {
      run -= data[i - smooth] * data[i - smooth];
      const level = Math.sqrt(run / smooth);
      if (level > peak * AT_6DB) past6 = i;
      if (level > peak * AT_20DB) past20 = i;
    }
  }

  const t6 = (past6 - from) / rate;
  const t20 = (past20 - from) / rate;
  // A sound that falls off a cliff has no rate worth extrapolating from.
  const fading = t20 > t6 + 0.005 ? 14 / (t20 - t6) : 0;
  const ends =
    fading > 0
      ? from + Math.round((t20 + (ENVELOPE_END_DB - 20) / fading) * rate)
      : past20;

  let weighted = 0;
  let total = 0;
  const size = WINDOW;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const v = from + i < limit ? data[from + i] : 0;
    re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  }
  fft(re, im);
  for (let k = 1; k < size / 2; k++) {
    const mag = Math.hypot(re[k], im[k]);
    weighted += ((k * rate) / size) * mag;
    total += mag;
  }

  return { peak, peakAt, ends, centroid: total > 0 ? weighted / total : 0 };
}

/** One sound out of a recording, from where it starts to wherever it stops. */
function describe(data: Float32Array, rate: number, at: number, nextAt: number): Heard {
  const from = Math.max(0, Math.round(at * rate));
  // Never past the next sound, and never longer than the app can hold.
  const limit = Math.min(
    data.length,
    from + Math.round(4 * rate),
    Number.isFinite(nextAt) ? Math.round(nextAt * rate) : data.length,
  );
  const { peak, peakAt, ends, centroid } = measure(data, rate, from, limit);

  return {
    at,
    length: Math.max(0.02, Math.min(4, (ends - from) / rate)),
    peak,
    attack: (peakAt - from) / rate,
    centroid,
    // Never into the next sound, however far this one's envelope was
    // reckoned to run: two sounds in one print is a print of neither.
    print: print(data, rate, from, Math.min(limit, Math.max(from + WINDOW, ends))),
  };
}
