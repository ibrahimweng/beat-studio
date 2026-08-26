/**
 * A voice, written down rather than coded.
 *
 * Every sound in Beat Studio used to be a function that reached into the
 * audio graph and built itself. That works, but it means a sound can only
 * ever be what the code says it is: it cannot be handed to anyone, saved,
 * edited, or read by anything other than this app.
 *
 * So a voice is now a description. {@link renderVoice} is the one piece of
 * code that turns a description into sound, and it is used by playback, by
 * auditioning and by the offline renderer alike. The descriptions themselves
 * are plain values, which is what makes the rest possible: they can be
 * written to a patch file, read back from one, and changed by hand.
 *
 * The model is deliberately a little wider than the `@web-kits/audio` format
 * it exchanges with. Several of these voices do things that format has no way
 * to say, such as a buffer read backwards or a level that holds and then cuts
 * rather than fading. Being able to describe them exactly is what lets the
 * rework leave every voice sounding as it did. Going out to a patch is a
 * conversion, and the few places it loses something are recorded there.
 */

/**
 * A point on a curve.
 *
 * `at` is seconds from the start of the layer, `to` is the value to reach,
 * and `curve` is how it gets there. The first point in a list is where the
 * curve begins, and is always set outright.
 *
 * Exponential curves cannot pass through zero, which is why the voices below
 * end on small numbers such as 0.0008 rather than on nothing. That is a rule
 * of the audio graph, not a choice.
 */
export interface Point {
  at: number;
  to: number;
  curve?: 'set' | 'linear' | 'exp';
}

/** A value over time. One point holds it steady. */
export type Curve = readonly Point[];

/** Steady at one value. */
export const flat = (value: number): Curve => [{ at: 0, to: value }];

export interface OscSource {
  kind: 'osc';
  type: OscillatorType;
  /** Frequency in Hz over time. */
  freq: Curve;
  /** Detune in cents. */
  detune?: number;
}

export interface NoiseSource {
  kind: 'noise';
  /**
   * Fade the buffer out across its own length before anything else touches
   * it. The drum kit is built this way and it is part of why those voices
   * sound the way they do, so it is described rather than smoothed over.
   */
  fade?: boolean;
}

/**
 * A sound written into a buffer and read back the other way round.
 *
 * Nothing else here can make this shape. It grows out of nothing and stops
 * dead, because that is what a decay looks like backwards.
 */
export interface ReverseSource {
  kind: 'reverse';
  /** Hz of the tone mixed in with the noise. */
  freq: number;
  /** How sharply it decays before being turned round. */
  shape: number;
  /** How much of it is noise, 0 to 1. The rest is the tone. */
  air: number;
}

export type SourceSpec = OscSource | NoiseSource | ReverseSource;

export interface FilterSpec {
  type: BiquadFilterType;
  /** Cutoff or centre in Hz over time. */
  freq: Curve;
  q?: number;
}

/** A steady oscillator added to a parameter, for tremolo and filter movement. */
export interface LfoSpec {
  rate: number;
  depth: number;
  target: 'gain' | 'filterFreq';
}

export interface LayerSpec {
  source: SourceSpec;
  filter?: FilterSpec;
  /** Level over time. This is the shape of the sound. */
  gain: Curve;
  /** How long this layer runs for, in seconds. */
  length: number;
  /** Seconds after the voice starts. */
  delay?: number;
  lfo?: readonly LfoSpec[];
  /**
   * How long the source runs past its own length before being stopped.
   *
   * Housekeeping rather than anything you can hear on its own. It matters
   * only because an exponential curve cannot reach zero, so every voice is
   * still sounding very faintly when its length is up, and where the source
   * stops decides how much of that faint tail survives. The drum kit has
   * always stopped sooner than the design voices, and saying so here is what
   * lets both keep sounding exactly as they did.
   */
  overrun?: number;
}

export interface VoiceSpec {
  /** How long the whole voice occupies. */
  duration: number;
  layers: readonly LayerSpec[];
}

/** What a voice is being asked for: how long, how high and how loud. */
export interface VoiceOptions {
  length: number;
  tune: number;
  gain: number;
}

/** Semitones to a frequency multiplier. */
export const ratio = (semitones: number): number => Math.pow(2, semitones / 12);

/** The smallest value an exponential curve can reach. */
const FLOOR = 1e-5;
/** Default for {@link LayerSpec.overrun}. */
const OVERRUN = 0.05;

/** Write a curve onto a parameter, starting at `t`. */
function applyCurve(param: AudioParam, curve: Curve, t: number): void {
  if (!curve.length) return;
  const [first, ...rest] = curve;
  param.setValueAtTime(first.to, t + first.at);
  for (const point of rest) {
    const at = t + point.at;
    if (point.curve === 'set') param.setValueAtTime(point.to, at);
    else if (point.curve === 'exp') {
      param.exponentialRampToValueAtTime(Math.max(FLOOR, point.to), at);
    } else param.linearRampToValueAtTime(point.to, at);
  }
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, fade: boolean): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = (Math.random() * 2 - 1) * (fade ? 1 - i / length : 1);
  }
  return buffer;
}

function reverseBuffer(
  ctx: BaseAudioContext,
  seconds: number,
  source: ReverseSource,
): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const step = (2 * Math.PI * source.freq) / ctx.sampleRate;
  const tone = 1 - source.air;
  for (let i = 0; i < length; i++) {
    const decay = Math.pow(1 - i / length, source.shape);
    data[i] = ((Math.random() * 2 - 1) * source.air + Math.sin(i * step) * tone) * decay;
  }
  data.reverse();
  return buffer;
}

/** Build a layer's source and start it. Returns the node to carry on from. */
function buildSource(
  ctx: BaseAudioContext,
  layer: LayerSpec,
  t: number,
): { node: AudioNode; freq: AudioParam | null } {
  const { source, length } = layer;
  const until = t + length + (layer.overrun ?? OVERRUN);

  if (source.kind === 'osc') {
    const osc = ctx.createOscillator();
    osc.type = source.type;
    if (source.detune) osc.detune.value = source.detune;
    applyCurve(osc.frequency, source.freq, t);
    osc.start(t);
    osc.stop(until);
    return { node: osc, freq: osc.frequency };
  }

  const node = ctx.createBufferSource();
  node.buffer =
    source.kind === 'reverse'
      ? reverseBuffer(ctx, length, source)
      : noiseBuffer(ctx, length, source.fade === true);
  node.start(t);
  node.stop(until);
  return { node, freq: null };
}

function buildLfo(
  ctx: BaseAudioContext,
  target: AudioParam,
  spec: LfoSpec,
  t: number,
  length: number,
): void {
  const osc = ctx.createOscillator();
  const depth = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = spec.rate;
  depth.gain.value = spec.depth;
  osc.connect(depth);
  depth.connect(target);
  osc.start(t);
  osc.stop(t + length + OVERRUN);
}

/**
 * Turn a description into sound at an absolute time.
 *
 * Takes a BaseAudioContext, so the same description renders live and offline.
 * That is what keeps what you hear and what lands in the file the same thing.
 */
export function renderVoice(
  ctx: BaseAudioContext,
  dest: AudioNode,
  spec: VoiceSpec,
  t: number,
): void {
  for (const layer of spec.layers) {
    const start = t + (layer.delay ?? 0);
    const { node } = buildSource(ctx, layer, start);

    let tail: AudioNode = node;
    let filterFreq: AudioParam | null = null;

    if (layer.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = layer.filter.type;
      if (layer.filter.q !== undefined) filter.Q.value = layer.filter.q;
      applyCurve(filter.frequency, layer.filter.freq, start);
      filterFreq = filter.frequency;
      tail.connect(filter);
      tail = filter;
    }

    const gain = ctx.createGain();
    applyCurve(gain.gain, layer.gain, start);
    tail.connect(gain);
    gain.connect(dest);

    for (const lfo of layer.lfo ?? []) {
      const target = lfo.target === 'gain' ? gain.gain : filterFreq;
      if (target) buildLfo(ctx, target, lfo, start, layer.length);
    }
  }
}
