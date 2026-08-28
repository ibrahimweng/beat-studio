import { roomOfLength } from './room.ts';
import { bufferAt } from './samples.ts';
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
  /**
   * How the value gets there.
   *
   * `target` eases towards the value rather than arriving at it, over the
   * time constant in {@link tc}. It never quite gets there, which is what an
   * instrument actually does when a note is let go, and it is how the
   * `@web-kits/audio` format shapes every sound. Having it here means a pack
   * written for that format can be described exactly rather than nearly.
   */
  curve?: 'set' | 'linear' | 'exp' | 'target';
  /** Time constant for a `target` curve: how long it takes to close two thirds. */
  tc?: number;
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
  /**
   * A second oscillator driving this one's pitch.
   *
   * `ratio` is its frequency as a multiple of this one's, and `depth` is how
   * far it pushes the pitch, in Hz. Ratios that are not whole numbers give a
   * bell or a struck object rather than a note, which is why so much of the
   * interface sound anyone has ever liked is made this way.
   */
  fm?: { ratio: number; depth: number };
}

export interface NoiseSource {
  kind: 'noise';
  /**
   * White is flat, pink falls away as the pitch rises, brown falls faster.
   * White reads as air and hiss, brown as weather and rumble.
   */
  color?: 'white' | 'pink' | 'brown';
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
  /** Hz of the lowest partial of the body being struck. */
  freq: number;
  /** How sharply it decays before being turned round. */
  shape: number;
  /** How much of it is noise, 0 to 1. The rest is the body ringing. */
  air: number;
}

/**
 * A struck body, as the set of notes it rings at.
 *
 * A bell, a glass, a wooden block and a steel bar are not one sound with the
 * numbers moved around: they differ in which partials they ring at, how loud
 * each one starts, and how fast each one dies. Wood loses its high partials
 * almost at once; glass holds them for seconds. Saying that directly, one
 * partial at a time, is what lets one mechanism cover the whole family, and
 * the ratios between the partials are what decide whether the result reads as
 * a note or as an object.
 */
export interface ModalSource {
  kind: 'modal';
  /** The lowest partial, in Hz. */
  freq: number;
  /** The partials, as multiples of the lowest, each with its own life. */
  partials: readonly {
    ratio: number;
    gain: number;
    /** Seconds to fall away, for this partial alone. */
    decay: number;
  }[];
  /**
   * How hard it is struck, 0 to 1.
   *
   * A soft strike hardly wakes the high partials; a hard one sets all of them
   * going at once. It is the difference between a fingertip and a hammer on
   * the same object.
   */
  strike?: number;
}

/**
 * A string or a tube: something excited once, then left to run round itself.
 *
 * Worked out sample by sample into a buffer rather than built as a feedback
 * loop in the audio graph, because a loop through a delay node cannot be
 * shorter than one render block, which puts a floor under the pitch at a few
 * hundred cycles. Written out by hand there is no floor, the pitch is exact,
 * and it comes out the same every time.
 */
export interface PluckSource {
  kind: 'pluck';
  freq: number;
  /** How fast the top end dies away, 0 to 1. Low is bright, high is dull. */
  damping: number;
  /** How much of the excitation is noise rather than a single pulse, 0 to 1. */
  colour?: number;
  /** Below 1 the whole thing shortens; near 1 it rings on. */
  sustain?: number;
}

/**
 * A cloud of short bursts.
 *
 * One grain is a click. Thousands of them, scattered in time and pitch, are
 * rain, fire, gravel, a crowd, or a machine, and which one depends almost
 * entirely on how often they arrive and how far apart they are in pitch.
 */
export interface GrainSource {
  kind: 'grains';
  /** Grains per second. */
  density: number;
  /** How long one grain lasts, in seconds. */
  grain: number;
  /** Centre pitch of a grain in Hz, or 0 for grains of noise. */
  freq: number;
  /** How far the pitch scatters either side, in octaves. */
  spread: number;
  /** How much of a grain is noise rather than tone, 0 to 1. */
  air?: number;
  /**
   * How far a grain's pitch climbs across its own length, as a multiple.
   *
   * A rising grain is a bubble, which is the one shape water is made of, so
   * a cloud of them is a stream, a pour, or a drip.
   */
  rise?: number;
}

/**
 * A run of hits, at a rate that can change while it runs.
 *
 * The rate being a curve rather than a number is the whole point: a ratchet
 * slowing down, a motor spinning up and a zip being pulled are the same
 * mechanism at three different accelerations.
 */
export interface ImpulseSource {
  kind: 'impulses';
  /** Hits per second, over time. */
  rate: Curve;
  /** How long one hit rings, in seconds. */
  ring: number;
  /** What it rings at, in Hz. */
  freq: number;
  /** How ragged the spacing is, 0 to 1. Nothing is clockwork, one is a rattle. */
  jitter?: number;
}

/**
 * A recording, named rather than carried.
 *
 * The audio lives in `samples.ts` under this id, because a {@link VoiceSpec}
 * is plain data and an AudioBuffer in one would stop it being writable to a
 * patch file, savable in a session, or renderable offline.
 */
export interface SampleSource {
  kind: 'sample';
  /** Which recording, by the id it was registered under. */
  id: string;
  /**
   * Faster or slower, which for a recording is pitch and length together.
   *
   * The way a sampler works, and the only honest reading of a pitch control
   * on a recording: stretching one to a new length without moving its pitch
   * is a phase vocoder, and one written in an afternoon sounds like one.
   */
  rate?: number;
}

export type SourceSpec =
  | OscSource
  | NoiseSource
  | ReverseSource
  | ModalSource
  | PluckSource
  | GrainSource
  | ImpulseSource
  | SampleSource;

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

/**
 * A room around a sound.
 *
 * Beat Studio has always had one reverb at the end of everything, which means
 * a click and an impact share a room whether that suits them or not. A voice
 * can now carry its own, which is what lets an impact have a hall behind it
 * while the click next to it stays dry.
 */
export interface ReverbSpec {
  kind: 'reverb';
  /** Length of the tail in seconds. */
  decay: number;
  /** How much of the sound is the room, 0 to 1. */
  mix: number;
  /**
   * How much of the untouched sound goes through, if not `1 - mix`.
   *
   * A blend is right for a pack, whose sounds were written against a format
   * that works that way. It is wrong for a control called Space: adding a
   * room to a hit should not thin the hit, and with a blend it does, because
   * every bit of room is a bit of the sound taken away. Setting this to 1
   * makes the room something added rather than something traded for.
   */
  dry?: number;
  /** Silence before the room answers, in seconds. */
  preDelay?: number;
  /** Takes the top off the tail, 0 to 1, for a softer room. */
  damping?: number;
  /** Multiplier on the tail length. */
  roomSize?: number;
}

/**
 * Saturation, which is what "punch" actually is.
 *
 * Pushing a sound into a gentle curve rather than letting it stay a clean
 * shape adds harmonics above what was there. Those harmonics are why a
 * saturated hit still reads on a laptop speaker that cannot reproduce any of
 * its low end, and why a sub with a little of this on it can be felt on a
 * phone at all. It is not distortion in the sense of damage; at low amounts
 * it is heard as weight rather than as an effect.
 */
export interface DriveSpec {
  kind: 'drive';
  /** 0 is untouched, 1 is as hard as this goes. */
  amount: number;
}

export type EffectSpec = ReverbSpec | DriveSpec;

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
  /** Applied to this layer alone, after its envelope. */
  effects?: readonly EffectSpec[];
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
  /** Applied to all the layers together. */
  effects?: readonly EffectSpec[];
}

/** What a voice is being asked for: how long, how high and how loud. */
export interface VoiceOptions {
  length: number;
  tune: number;
  gain: number;
  /**
   * Where to start drawing the noise from.
   *
   * Most of these voices are built on noise, so left to itself every render
   * draws a different sound. That is right for an instrument being played,
   * where a hi-hat struck sixteen times should not be the same recording
   * sixteen times. It is wrong for a sound placed on a timeline, which ought
   * to be the same sound every time it is heard, whether that is while you
   * are working or in the file you hand over. Giving a placed sound a number
   * of its own is what makes those the same thing.
   */
  seed?: number;
}

/** The same stream of numbers between 0 and 1 every time, from a given start. */
export function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn anything that names a sound into a number to draw noise from. */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
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
    } else if (point.curve === 'target') {
      param.setTargetAtTime(point.to, at, Math.max(1e-4, point.tc ?? 0.01));
    } else param.linearRampToValueAtTime(point.to, at);
  }
}

function noiseBuffer(
  ctx: BaseAudioContext,
  seconds: number,
  source: NoiseSource,
  random: () => number,
): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  fillNoise(data, source.color ?? 'white', random);
  if (source.fade) {
    for (let i = 0; i < length; i++) data[i] *= 1 - i / length;
  }
  return buffer;
}

/**
 * Noise of a given colour.
 *
 * Pink and brown are made by filtering white as it is generated rather than
 * afterwards. The pink coefficients are the usual published set, and brown is
 * a running sum held back from wandering away from zero. Both are written the
 * way the `@web-kits/audio` engine writes them, so a pack that asks for pink
 * gets the pink it was designed against.
 */
function fillNoise(
  data: Float32Array,
  color: 'white' | 'pink' | 'brown',
  random: () => number,
): void {
  if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return;
  }
  if (color === 'brown') {
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    return;
  }
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
}

/**
 * A room, as the impulse a convolver multiplies a sound by.
 *
 * Decaying noise, damped by rolling off what came before it, which is most of
 * what makes a room sound like a room rather than like a burst of static: the
 * high end goes first, exactly as it does off real walls.
 *
 * Shared with the room a whole layer can be put in, so the two cannot end up
 * being different rooms.
 */
export function roomImpulse(
  ctx: BaseAudioContext,
  seconds: number,
  damping: number,
  random: () => number,
): AudioBuffer {
  return roomOfLength(ctx, seconds, damping, random);
}

/** A room, built from decaying noise the convolver can multiply a sound by. */
function buildReverb(
  ctx: BaseAudioContext,
  spec: ReverbSpec,
  random: () => number,
): { input: AudioNode; output: AudioNode } {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const dry = ctx.createGain();
  dry.gain.value = spec.dry ?? 1 - spec.mix;
  input.connect(dry);
  dry.connect(output);

  const wet = ctx.createGain();
  wet.gain.value = spec.mix;
  input.connect(wet);

  const buffer = roomImpulse(
    ctx,
    Math.max(0.01, spec.decay * (spec.roomSize ?? 1)),
    spec.damping ?? 0,
    random,
  );

  const convolver = ctx.createConvolver();
  convolver.buffer = buffer;

  if (spec.preDelay && spec.preDelay > 0) {
    const wait = ctx.createDelay(Math.max(spec.preDelay + 0.01, 1));
    wait.delayTime.value = spec.preDelay;
    wet.connect(wait);
    wait.connect(convolver);
  } else {
    wet.connect(convolver);
  }
  convolver.connect(output);

  return { input, output };
}

/** How far into the curve the hardest setting pushes. */
const MAX_DRIVE = 7;
/** Points in the shaping curve. Enough that no step in it is audible. */
const CURVE_POINTS = 1024;

/**
 * The shape a pushed sound is bent into.
 *
 * Shared with the push a whole layer can be given, so the two cannot end up
 * being different kinds of saturation.
 */
export function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const drive = 1 + Math.max(0, Math.min(1, amount)) * MAX_DRIVE;
  const curve = new Float32Array(CURVE_POINTS);
  const ceiling = Math.tanh(drive);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = (i / (CURVE_POINTS - 1)) * 2 - 1;
    // Scaled so full scale in is still full scale out, and everything below
    // it is lifted towards the top rather than being squashed against it.
    curve[i] = Math.tanh(x * drive) / ceiling;
  }
  return curve;
}

/**
 * The shaper a push is made of.
 *
 * Deliberately not asked to work at four times the rate, which is the usual
 * advice and is wrong here. Measured, in this browser, at forty eight
 * thousand samples a second: four times over keeps what folds back down the
 * spectrum a hundred and forty nine decibels under the harmonics rather than
 * seventy two, and hands its output back a hundred and ninety two samples
 * late, which is four milliseconds. Seventy two decibels down is the noise
 * floor of a twelve bit recording and nobody will ever hear it. Four
 * milliseconds is an eighth of a frame, and it lands on a pushed sound and
 * not on the one next to it, which is a thing people do hear and, worse, a
 * thing they would have to work around without knowing why. This is a tool
 * for putting sounds on exact frames, so the delay is the one that has to go.
 *
 * It also means a bent copy and an untouched one stay in step with each
 * other, so blending them is a blend rather than a comb filter. See
 * shaper-check.html for the measurements.
 */
function driveShaper(ctx: BaseAudioContext, amount: number): WaveShaperNode {
  const shaper = ctx.createWaveShaper();
  shaper.curve = driveCurve(amount);
  shaper.oversample = 'none';
  return shaper;
}

function buildDrive(ctx: BaseAudioContext, spec: DriveSpec): { input: AudioNode; output: AudioNode } {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const amount = Math.max(0, Math.min(1, spec.amount));

  // Blended rather than switched in, so the bottom of the control is silence
  // rather than a step. At nothing it is exactly the sound that went in.
  const dry = ctx.createGain();
  dry.gain.value = 1 - amount;
  input.connect(dry);
  dry.connect(output);

  const wet = ctx.createGain();
  wet.gain.value = amount;
  const shaper = driveShaper(ctx, amount);
  input.connect(wet);
  wet.connect(shaper);
  shaper.connect(output);

  return { input, output };
}

/** The same shaper, for a push drawn over a whole layer. */
export function layerShaper(ctx: BaseAudioContext): WaveShaperNode {
  return driveShaper(ctx, 1);
}

/** Run a node through a chain of effects and on to a destination. */
function through(
  ctx: BaseAudioContext,
  from: AudioNode,
  effects: readonly EffectSpec[],
  dest: AudioNode,
  random: () => number,
): void {
  let cursor = from;
  for (const effect of effects) {
    const node = effect.kind === 'drive' ? buildDrive(ctx, effect) : buildReverb(ctx, effect, random);
    cursor.connect(node.input);
    cursor = node.output;
  }
  cursor.connect(dest);
}

/**
 * What is decaying before it gets turned round.
 *
 * Inharmonic, and each partial with a life of its own — the higher ones die
 * first, as they do on anything struck. Reversed, that becomes the thing this
 * voice is for: the top arrives last, so the sound brightens as it grows and
 * then stops. A single sine cannot do that. It was one, and the result was a
 * hum inside a noise swell rather than a hit backwards.
 */
const REVERSED_BODY: readonly (readonly [ratio: number, gain: number, life: number])[] = [
  [1, 1, 1],
  [2.37, 0.55, 0.62],
  [3.91, 0.3, 0.42],
  [5.62, 0.17, 0.3],
  [8.09, 0.09, 0.22],
];

function reverseBuffer(
  ctx: BaseAudioContext,
  seconds: number,
  source: ReverseSource,
  random: () => number,
): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const tone = 1 - source.air;
  const rate = ctx.sampleRate;

  for (let i = 0; i < length; i++) {
    const along = i / length;
    const decay = Math.pow(1 - along, source.shape);

    let body = 0;
    for (const [ratio, gain, life] of REVERSED_BODY) {
      // Shorter life, faster decay, so the partial is gone sooner.
      body += Math.sin((i * (2 * Math.PI * source.freq * ratio)) / rate) *
        gain * Math.pow(1 - along, source.shape / life);
    }

    data[i] = (random() * 2 - 1) * source.air * decay + body * tone * 0.55;
  }
  data.reverse();
  return buffer;
}

/** Build a layer's source and start it. Returns the node to carry on from. */
function buildSource(
  ctx: BaseAudioContext,
  layer: LayerSpec,
  t: number,
  random: () => number,
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

    if (source.fm) {
      // The modulator is pitched against where the carrier starts, so a
      // sweeping note keeps the same character as it moves.
      const carrier = source.freq[0]?.to ?? 440;
      const modulator = ctx.createOscillator();
      const depth = ctx.createGain();
      modulator.type = 'sine';
      modulator.frequency.value = carrier * source.fm.ratio;
      depth.gain.value = source.fm.depth;
      modulator.connect(depth);
      depth.connect(osc.frequency);
      modulator.start(t);
      modulator.stop(until);
    }

    return { node: osc, freq: osc.frequency };
  }

  if (source.kind === 'modal') {
    return { node: buildModal(ctx, source, layer, t, until), freq: null };
  }

  const node = ctx.createBufferSource();
  if (source.kind === 'sample') {
    /*
     * A recording, rather than something worked out here.
     *
     * Taken at the rate this context runs at: an offline render for an export
     * can be at a different rate from playback, and a buffer belongs to the
     * rate it was decoded at, so handing one straight over plays it at the
     * wrong pitch with nothing to say so. See `samples.ts`.
     *
     * A recording with nothing decoded yet renders as silence rather than
     * throwing. That happens for one frame after a session is opened, before
     * anything has been clicked and there is an audio context to decode with,
     * and a piece that refused to draw until then would be worse.
     */
    const buffer = bufferAt(ctx, source.id);
    if (!buffer) return { node, freq: null };
    node.buffer = buffer;
    if (source.rate && source.rate > 0) node.playbackRate.value = source.rate;
    node.start(t);
    // Stopped at the layer's length, which is how much of the recording is
    // wanted. Anything past that is cut by the envelope anyway; stopping the
    // node as well is what stops a five minute file being decoded, resampled
    // and mixed for the two seconds of it anybody asked for.
    node.stop(until);
    return { node, freq: null };
  }
  if (source.kind === 'reverse') node.buffer = reverseBuffer(ctx, length, source, random);
  else if (source.kind === 'pluck') node.buffer = pluckBuffer(ctx, length, source, random);
  else if (source.kind === 'grains') node.buffer = grainBuffer(ctx, length, source, random);
  else if (source.kind === 'impulses') node.buffer = impulseBuffer(ctx, length, source, random);
  else node.buffer = noiseBuffer(ctx, length, source, random);
  node.start(t);
  node.stop(until);
  return { node, freq: null };
}

/**
 * A struck body: one decaying sine for each note it rings at.
 *
 * Built in the graph rather than into a buffer because every partial is a
 * plain oscillator and the graph is better at those than a loop written by
 * hand. A hard strike wakes the high partials fully; a soft one leaves them
 * behind, which is done by leaning on the ones furthest from the bottom.
 */
function buildModal(
  ctx: BaseAudioContext,
  source: ModalSource,
  layer: LayerSpec,
  t: number,
  until: number,
): AudioNode {
  const out = ctx.createGain();
  const strike = Math.max(0, Math.min(1, source.strike ?? 1));

  for (const partial of source.partials) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = source.freq * partial.ratio;

    // How much this partial was woken. The first is always struck fully; the
    // rest are held back further the softer the strike and the higher they
    // sit, which is what a soft mallet does to a real object.
    const reach = partial.ratio <= 1 ? 1 : Math.pow(strike, Math.log2(partial.ratio));
    const peak = Math.max(0.0001, partial.gain * reach);

    const level = ctx.createGain();
    level.gain.setValueAtTime(peak, t);
    // Exponential, because that is how a ringing object actually falls away,
    // and it cannot reach zero, so it ends just under where anyone can hear.
    level.gain.exponentialRampToValueAtTime(peak * 0.0005, t + Math.max(0.01, partial.decay));

    osc.connect(level);
    level.connect(out);
    osc.start(t);
    osc.stop(Math.min(until, t + Math.max(0.01, partial.decay) + (layer.overrun ?? OVERRUN)));
  }

  return out;
}

/**
 * A plucked string, worked out one sample at a time.
 *
 * A short burst is written into a ring the length of one cycle, and then read
 * round and round, each time averaged a little with the sample before it. The
 * averaging is what takes the top off a bit more on every pass, which is why
 * a string starts bright and turns dull rather than simply getting quieter.
 */
function pluckBuffer(
  ctx: BaseAudioContext,
  seconds: number,
  source: PluckSource,
  random: () => number,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);

  const period = Math.max(2, Math.round(rate / Math.max(20, source.freq)));
  const colour = Math.max(0, Math.min(1, source.colour ?? 1));
  const damping = Math.max(0, Math.min(0.99, source.damping));
  const sustain = Math.max(0.8, Math.min(0.9999, source.sustain ?? 0.996));

  // The excitation. All noise is a plucked string; a single pulse is more
  // like something struck, and between them is everything else.
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) {
    const pulse = i === 0 ? 1 : 0;
    ring[i] = (random() * 2 - 1) * colour + pulse * (1 - colour);
  }

  /*
   * The damping is a filter that carries its own state round the loop rather
   * than an average of each sample with the one beside it. Averaging two
   * neighbours takes almost nothing off at these pitches: a tenth of a
   * percent per pass, which over a whole note is barely a change and leaves
   * the control with nothing to do. Carrying the state makes the parameter
   * mean something across its whole range, from a string that keeps its
   * harmonics for seconds to one that is a thud within two cycles.
   */
  let rolled = 0;
  for (let i = 0; i < length; i++) {
    const at = i % period;
    const held = ring[at];
    rolled = held * (1 - damping) + rolled * damping;
    ring[at] = rolled * sustain;
    data[i] = held;
  }

  return buffer;
}

/** A cloud of short bursts, scattered in time and in pitch. */
function grainBuffer(
  ctx: BaseAudioContext,
  seconds: number,
  source: GrainSource,
  random: () => number,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);

  const grain = Math.max(1, Math.round(rate * Math.max(0.001, source.grain)));
  const count = Math.max(1, Math.round(source.density * seconds));
  const air = Math.max(0, Math.min(1, source.air ?? 0));
  const rise = Math.max(0.05, source.rise ?? 1);

  /*
   * How loud one grain has to be so that a thousand of them are not a
   * thousand times louder.
   *
   * Grains land on top of each other, and how many are sounding at once is
   * how long one lasts times how many arrive a second. Their phases are
   * unrelated, so they pile up as the square root of that rather than in
   * step, and dividing by the same square root keeps a cloud at much the
   * same level whether it is a drizzle or a downpour. Without this the
   * density control was also a volume control, and a thick cloud peaked at
   * twice full scale.
   */
  const overlap = Math.max(1, source.density * Math.max(0.001, source.grain));
  const each = 1 / Math.sqrt(overlap);

  for (let g = 0; g < count; g++) {
    const at = Math.floor(random() * length);
    // Pitch scattered in octaves rather than in Hz, so the spread sounds the
    // same wherever the centre sits.
    const octaves = (random() * 2 - 1) * source.spread;
    const freq = source.freq * Math.pow(2, octaves);
    const step = (2 * Math.PI * freq) / rate;
    let phase = random() * Math.PI * 2;

    for (let i = 0; i < grain && at + i < length; i++) {
      const u = i / grain;
      // Raised cosine, so a grain fades in and out rather than clicking at
      // both ends. Thousands of clicks would be their own sound.
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
      phase += step * Math.pow(rise, u);
      const tone = source.freq > 0 ? Math.sin(phase) : 0;
      data[at + i] += (tone * (1 - air) + (random() * 2 - 1) * air) * window * each;
    }
  }

  return buffer;
}

/** A run of hits at a rate that can change while it runs. */
function impulseBuffer(
  ctx: BaseAudioContext,
  seconds: number,
  source: ImpulseSource,
  random: () => number,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);

  const ring = Math.max(1, Math.round(rate * Math.max(0.0005, source.ring)));
  const jitter = Math.max(0, Math.min(1, source.jitter ?? 0));
  const step = (2 * Math.PI * source.freq) / rate;

  // Walked forward in time rather than laid out in advance, because the gap
  // to the next hit depends on the rate where this one landed, which is the
  // only way a run that speeds up actually speeds up.
  let at = 0;
  let guard = 0;
  while (at < seconds && guard++ < 20000) {
    const hits = Math.max(0.1, valueOn(source.rate, at));
    const start = Math.floor(at * rate);

    for (let i = 0; i < ring && start + i < length; i++) {
      const decay = Math.exp(-4 * (i / ring));
      data[start + i] += Math.sin(i * step) * decay;
    }

    const gap = 1 / hits;
    at += gap * (1 + (random() * 2 - 1) * jitter);
  }

  return buffer;
}

/** Read a curve at a moment, for the places that need a number rather than a param. */
function valueOn(curve: Curve, at: number): number {
  if (!curve.length) return 1;
  if (at <= curve[0].at) return curve[0].to;
  for (let i = 1; i < curve.length; i++) {
    const from = curve[i - 1];
    const to = curve[i];
    if (at > to.at) continue;
    const span = to.at - from.at;
    if (span <= 0) return to.to;
    return from.to + ((at - from.at) / span) * (to.to - from.to);
  }
  return curve[curve.length - 1].to;
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
  seed?: number,
): GainNode[] {
  // One stream for the whole voice, so its layers stay in step with each
  // other however many of them there are.
  const random = seed === undefined ? Math.random : sequence(seed);

  /*
   * A separate stream for the effects.
   *
   * A room is built out of noise too, and seconds of it. Drawing that from
   * the same stream as the voice meant everything after it came out of a
   * different place in the sequence, so putting a sound in a room changed the
   * sound rather than only what was around it: the same hit with the room
   * turned up was a different hit. They are kept apart so the voice is the
   * voice whatever is done to it afterwards.
   */
  const forEffects = seed === undefined ? Math.random : sequence(seed ^ 0x5bf03635);

  // Anything applied to the voice as a whole sits between every layer and the
  // destination, so the layers reach it already summed.
  let out = dest;
  if (spec.effects?.length) {
    const bus = ctx.createGain();
    through(ctx, bus, spec.effects, dest, forEffects);
    out = bus;
  }

  // Handed back so a note still sounding can be let go of early. A voice has
  // one of these per layer rather than one overall, so letting go of a note
  // means letting go of all of them together.
  const gains: GainNode[] = [];

  for (const layer of spec.layers) {
    const start = t + (layer.delay ?? 0);
    const { node } = buildSource(ctx, layer, start, random);

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
    gains.push(gain);
    tail.connect(gain);
    if (layer.effects?.length) through(ctx, gain, layer.effects, out, forEffects);
    else gain.connect(out);

    for (const lfo of layer.lfo ?? []) {
      const target = lfo.target === 'gain' ? gain.gain : filterFreq;
      if (target) buildLfo(ctx, target, lfo, start, layer.length);
    }
  }

  return gains;
}
