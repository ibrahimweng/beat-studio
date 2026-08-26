/**
 * What happens to a file after it is rendered and before it is written.
 *
 * Three jobs, none of which the app used to do.
 *
 * Nothing stopped a file clipping. A hundred sounds on the same frame add up,
 * and where the sum went past what a file can hold it was simply cut off,
 * which is heard as a crack on exactly the loudest moment in the piece.
 *
 * Nothing measured how loud a file was. Two exports of two pieces could come
 * back at quite different levels, and someone had to ride a fader to make them
 * sit the same way against picture.
 *
 * And stems have to keep their balance. If each one were treated on its own
 * they would no longer add up to the mix, which is the one thing stems are
 * for. So the work is measured once on the mix and the same numbers are
 * applied to every layer, and they still sum exactly.
 *
 * All of it runs on the rendered samples rather than in the audio graph, so it
 * is the same arithmetic every time rather than whatever a browser's
 * compressor happens to do.
 */

/** Loudest a sample is allowed to be, a little under full scale. */
export const CEILING = 0.891; // -1 dBFS

/** How far ahead the limiter looks, in seconds. */
const LOOKAHEAD = 0.005;
/** How quickly it lets go once the loud moment has passed, in seconds. */
const RELEASE = 0.12;

/** Quieter than this and a moment is not counted towards loudness at all. */
const ABSOLUTE_GATE = -70;
/** Quiet parts below this much under the average are not counted either. */
const RELATIVE_GATE = 10;

/**
 * How loud a file is, in LUFS, by the ITU-R BS.1770 method.
 *
 * Loudness is not the same as level. A peak meter reads the single loudest
 * sample, which says nothing about how loud a piece actually seems: a short
 * tick can peak higher than a sustained rumble while being far quieter to
 * listen to. This measures what is heard, by filtering the sound the way an
 * ear responds to it, then averaging over the parts that are actually
 * sounding rather than over the silence between them.
 *
 * The filter coefficients are the ones the standard specifies at 48 kHz,
 * which is what everything here is rendered at.
 */
export function measureLoudness(buffer: AudioBuffer): number {
  const rate = buffer.sampleRate;
  const channels = Math.min(2, buffer.numberOfChannels);
  const weighted: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    weighted.push(kWeight(buffer.getChannelData(c), rate));
  }

  // 400ms blocks, each starting 100ms after the last, as the standard says.
  const block = Math.round(rate * 0.4);
  const hop = Math.round(rate * 0.1);
  if (weighted[0].length < block) return -Infinity;

  const power: number[] = [];
  for (let start = 0; start + block <= weighted[0].length; start += hop) {
    let sum = 0;
    for (const channel of weighted) {
      let square = 0;
      for (let i = start; i < start + block; i++) square += channel[i] * channel[i];
      sum += square / block;
    }
    power.push(sum);
  }
  if (!power.length) return -Infinity;

  // The offset is not arbitrary. The weighting lifts 1kHz by that much, and
  // taking it back off is what makes a 1kHz tone read its own level, which is
  // how the whole scale is anchored.
  const loudness = (mean: number): number => -0.691 + 10 * Math.log10(mean || 1e-30);

  // Silence is left out, or a piece with long gaps would measure as quiet
  // when the parts you actually hear are not.
  const loud = power.filter((p) => loudness(p) > ABSOLUTE_GATE);
  if (!loud.length) return -Infinity;

  const rough = loud.reduce((a, b) => a + b, 0) / loud.length;
  const threshold = loudness(rough) - RELATIVE_GATE;
  const kept = loud.filter((p) => loudness(p) > threshold);
  if (!kept.length) return -Infinity;

  return loudness(kept.reduce((a, b) => a + b, 0) / kept.length);
}

/** Two biquads in series: the shelf and the high pass the standard defines. */
function kWeight(input: Float32Array, rate: number): Float32Array {
  // Specified at 48 kHz. Everything here renders at that rate; at any other
  // the reading drifts slightly rather than becoming wrong.
  void rate;
  const shelf = biquad(input, 1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585);
  return biquad(shelf, 1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621);
}

function biquad(
  input: Float32Array,
  b0: number,
  b1: number,
  b2: number,
  a1: number,
  a2: number,
): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
  }
  return out;
}

/**
 * How much the level has to be held back, sample by sample, to stay under the
 * ceiling.
 *
 * Worked out ahead of the sound rather than in response to it. Reading the
 * loudest sample in the next few milliseconds and coming down to meet it means
 * the reduction is already in place when the peak arrives, so a hit is held
 * rather than clipped and there is no audible grab. Letting go again is slow,
 * because a level that jumps back up between every hit is heard as pumping.
 *
 * Returned as an envelope rather than applied, so that every layer of a set of
 * stems can be given exactly the same treatment and still add up to the mix.
 */
export function limiterEnvelope(buffer: AudioBuffer, ceiling = CEILING): Float32Array {
  const length = buffer.length;
  const channels = Math.min(2, buffer.numberOfChannels);
  const needed = new Float32Array(length);

  for (let i = 0; i < length; i++) needed[i] = 1;
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      const peak = Math.abs(data[i]);
      if (peak > ceiling) {
        const allowed = ceiling / peak;
        if (allowed < needed[i]) needed[i] = allowed;
      }
    }
  }

  const ahead = Math.max(1, Math.round(buffer.sampleRate * LOOKAHEAD));

  // Look forward: take the lowest gain coming up in the next few
  // milliseconds, so the reduction begins before the peak does.
  const seen = new Float32Array(length);
  let lowest = 1;
  for (let i = length - 1; i >= 0; i--) {
    // A plain running minimum would need a queue; recomputing the window only
    // where it matters is simpler and the windows are short.
    if (needed[i] < lowest) lowest = needed[i];
    seen[i] = lowest;
    if (i + ahead < length && needed[i + ahead] === lowest) {
      lowest = 1;
      const end = Math.min(length, i + ahead);
      for (let j = i; j < end; j++) if (needed[j] < lowest) lowest = needed[j];
    }
  }

  // Come down at once, and go back up slowly.
  const rise = Math.exp(-1 / (buffer.sampleRate * RELEASE));
  const envelope = new Float32Array(length);
  let gain = 1;
  for (let i = 0; i < length; i++) {
    const target = seen[i];
    gain = target < gain ? target : target + (gain - target) * rise;
    // Never above what this sample actually needs, whatever the smoothing did.
    envelope[i] = Math.min(gain, needed[i]);
  }
  return envelope;
}

export interface MasterOptions {
  /** Hold the loudest moments under the ceiling instead of letting them clip. */
  limit: boolean;
  /** Bring the file to this loudness in LUFS. Null leaves the level alone. */
  target: number | null;
}

/** What the master did, so the interface can say so rather than guess. */
export interface MasterReport {
  /** Loudness of the render before anything was done to it. */
  before: number;
  /** Loudness of what was written. */
  after: number;
  /** Level change applied to reach the target, in dB. */
  gainDb: number;
  /** The most the limiter had to hold back, in dB. 0 means it never worked. */
  reductionDb: number;
  /** Whether anything would have clipped had it been left alone. */
  wouldHaveClipped: boolean;
}

/** The same treatment applied to the mix and to every stem. */
export interface Master {
  report: MasterReport;
  gain: number;
  envelope: Float32Array | null;
}

/**
 * Work out what to do to a mix, without doing it.
 *
 * Kept apart from applying it so that a set of stems can be given the same
 * numbers as the mix they came from. Gain and limiting are both plain
 * multiplication, so stems treated this way still add up to exactly the mixed
 * file.
 */
export function planMaster(mix: AudioBuffer, options: MasterOptions): Master {
  const before = measureLoudness(mix);

  let gain = 1;
  let gainDb = 0;
  if (options.target !== null && Number.isFinite(before)) {
    gainDb = options.target - before;
    gain = Math.pow(10, gainDb / 20);
  }

  let peak = 0;
  const channels = Math.min(2, mix.numberOfChannels);
  for (let c = 0; c < channels; c++) {
    const data = mix.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
    }
  }
  const wouldHaveClipped = peak * gain > 1;

  let envelope: Float32Array | null = null;
  let reductionDb = 0;
  if (options.limit) {
    const lifted = gain === 1 ? mix : scaled(mix, gain);
    envelope = limiterEnvelope(lifted);
    let lowest = 1;
    for (let i = 0; i < envelope.length; i++) if (envelope[i] < lowest) lowest = envelope[i];
    reductionDb = lowest < 1 ? -20 * Math.log10(lowest) : 0;
  }

  const after = applyMaster(mix, { gain, envelope });
  return {
    gain,
    envelope,
    report: {
      before,
      after: measureLoudness(after),
      gainDb,
      reductionDb,
      wouldHaveClipped,
    },
  };
}

/** Apply a plan to a buffer. Used for the mix and for each stem alike. */
export function applyMaster(
  buffer: AudioBuffer,
  master: { gain: number; envelope: Float32Array | null },
): AudioBuffer {
  const { gain, envelope } = master;
  if (gain === 1 && !envelope) return buffer;

  const out = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: buffer.length,
    sampleRate: buffer.sampleRate,
  });

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const from = buffer.getChannelData(c);
    const to = out.getChannelData(c);
    for (let i = 0; i < from.length; i++) {
      const value = from[i] * gain * (envelope ? envelope[i] : 1);
      // Nothing should reach this after the limiter, but a file that cannot
      // hold a number is worse than one held to what it can.
      to[i] = value > 1 ? 1 : value < -1 ? -1 : value;
    }
  }
  return out;
}

function scaled(buffer: AudioBuffer, gain: number): AudioBuffer {
  return applyMaster(buffer, { gain, envelope: null });
}
