import type { PadName, Voice } from '../types.ts';
import { flat, renderVoice, type LayerSpec, type VoiceSpec } from './voice-spec.ts';

/**
 * Voice synthesis. Every function here is pure in the sense that matters: it
 * takes an audio context and a destination, schedules nodes, and touches
 * nothing else. No DOM, no app state.
 *
 * All timings are absolute context times so the transport can schedule ahead
 * of the clock. The context is a BaseAudioContext rather than an
 * AudioContext, so the same voices render live and offline. Offline rendering
 * is how a cue lands exactly on the frame it was placed on.
 */

/** Convert a MIDI note number to Hz. */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * A filtered burst of white noise with a linear fade across the buffer and an
 * exponential gain decay. This is the backbone of the hats, snare and cymbals.
 */
export function noise(
  ctx: BaseAudioContext,
  dest: AudioNode,
  t: number,
  dur: number,
  amp: number,
  type: BiquadFilterType,
  freq: number,
  q?: number,
): void {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  if (q) filter.Q.value = q;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(amp, t);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/**
 * A pitch-swept oscillator: the body of the kick, toms and floor. The sweep
 * lands at f1 four fifths of the way through, which is what gives the drum its
 * "thump then tail" shape rather than a flat tone.
 */
export function boom(
  ctx: BaseAudioContext,
  dest: AudioNode,
  t: number,
  f0: number,
  f1: number,
  dur: number,
  amp: number,
  type: OscillatorType = 'sine',
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(amp, t + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/**
 * Every drum voice, described rather than coded.
 *
 * Each one is the same two ingredients the kit has always been built from: a
 * burst of filtered noise, and a tuned oscillator whose pitch falls quickly.
 * Writing them down means the kit can go into a patch file alongside the
 * design voices, and a pack from somewhere else can stand in for any of them.
 */
const KIT_OVERRUN = 0.02;

export const KIT_SPECS: Record<PadName, (vel: number) => VoiceSpec> = {
  kick: (v) => ({ duration: 0.42, layers: [tuned('sine', 148, 46, 0.42, 1.15 * v), burst(0.02, 0.3 * v, 'highpass', 1400)] }),
  kick2: (v) => ({ duration: 0.5, layers: [tuned('sine', 118, 40, 0.5, 1.1 * v), burst(0.02, 0.22 * v, 'highpass', 900)] }),
  snare: (v) => ({ duration: 0.19, layers: [burst(0.19, 0.62 * v, 'bandpass', 1900, 0.8), tuned('triangle', 220, 170, 0.09, 0.4 * v)] }),
  hhc: (v) => ({ duration: 0.05, layers: [burst(0.05, 0.42 * v, 'highpass', 8200)] }),
  hho: (v) => ({ duration: 0.38, layers: [burst(0.38, 0.34 * v, 'highpass', 7200)] }),
  tom1: (v) => ({ duration: 0.3, layers: [tuned('sine', 250, 128, 0.3, 0.8 * v)] }),
  tom2: (v) => ({ duration: 0.34, layers: [tuned('sine', 200, 104, 0.34, 0.8 * v)] }),
  tom3: (v) => ({ duration: 0.38, layers: [tuned('sine', 165, 88, 0.38, 0.8 * v)] }),
  floor: (v) => ({ duration: 0.46, layers: [tuned('sine', 128, 66, 0.46, 0.85 * v)] }),
  crash1: (v) => ({
    duration: 1.5,
    layers: [burst(1.5, 0.4 * v, 'highpass', 5200), burst(1.1, 0.16 * v, 'bandpass', 8600, 0.6, 0.01)],
  }),
  crash2: (v) => ({
    duration: 1.7,
    layers: [burst(1.7, 0.42 * v, 'highpass', 4600), burst(1.2, 0.16 * v, 'bandpass', 7800, 0.6, 0.01)],
  }),
  splash: (v) => ({ duration: 0.55, layers: [burst(0.55, 0.36 * v, 'highpass', 6800)] }),
  ride: (v) => ({
    duration: 1.1,
    layers: [burst(1.1, 0.24 * v, 'bandpass', 4400, 1.2), tuned('sine', 560, 520, 0.5, 0.1 * v)],
  }),
};

/**
 * A pitch-swept oscillator: the body of the kick, toms and floor.
 *
 * The sweep lands at f1 four fifths of the way through, which is what gives
 * the drum its thump then tail shape rather than a flat tone.
 */
function tuned(
  type: OscillatorType,
  f0: number,
  f1: number,
  dur: number,
  amp: number,
): LayerSpec {
  return {
    source: { kind: 'osc', type, freq: [{ at: 0, to: f0 }, { at: dur * 0.8, to: f1, curve: 'exp' }] },
    gain: [
      { at: 0, to: 0 },
      { at: 0.004, to: amp, curve: 'linear' },
      { at: dur, to: 0.0008, curve: 'exp' },
    ],
    length: dur,
    overrun: KIT_OVERRUN,
  };
}

/**
 * A filtered burst of noise. This makes the hi-hats, the snare rattle and the
 * cymbals. The buffer fades out across its own length as well as being shaped
 * by the envelope, which is part of why the kit sounds the way it does.
 */
function burst(
  dur: number,
  amp: number,
  type: BiquadFilterType,
  freq: number,
  q?: number,
  delay?: number,
): LayerSpec {
  return {
    source: { kind: 'noise', fade: true },
    filter: { type, freq: flat(freq), ...(q !== undefined ? { q } : {}) },
    gain: [{ at: 0, to: amp }, { at: dur, to: 0.0008, curve: 'exp' }],
    length: dur,
    overrun: KIT_OVERRUN,
    ...(delay !== undefined ? { delay } : {}),
  };
}

/** Describe one drum voice without playing it, for exporting and editing. */
export function kitSpec(pad: PadName, vel = 1): VoiceSpec {
  return KIT_SPECS[pad](vel);
}

/** Fire one drum voice at an absolute context time. */
export function drum(
  ctx: BaseAudioContext,
  dest: AudioNode,
  pad: PadName,
  t: number,
  vel = 1,
  seed?: number,
): void {
  const build = KIT_SPECS[pad];
  if (build) renderVoice(ctx, dest, build(vel), t, seed);
}

/**
 * Additive piano. Four partials over a shared envelope, with the upper ones
 * detuned slightly sharp so the tone beats the way a struck string does.
 * Returns the voice so a key-up can release it early.
 */
export function pianoSynth(
  ctx: BaseAudioContext,
  dest: AudioNode,
  midi: number,
  t: number,
  vel: number,
): Voice {
  const f = midiToFreq(midi);
  // Bass notes ring longer than treble, same as a real instrument.
  const dur = Math.max(0.8, Math.min(7, 1.1 + (100 - midi) * 0.06));

  const gain = ctx.createGain();
  gain.connect(dest);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.42 * vel, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0006, t + dur);

  const partials: [number, number, OscillatorType][] = [
    [1, 1, 'triangle'],
    [2, 0.3, 'sine'],
    [3, 0.13, 'sine'],
    [4.02, 0.06, 'sine'],
  ];
  for (const [h, a, type] of partials) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f * h * (1 + h * 0.0004);
    const partialGain = ctx.createGain();
    partialGain.gain.value = a;
    osc.connect(partialGain);
    partialGain.connect(gain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // Hammer noise, so the attack has some air to it.
  noise(ctx, dest, t, 0.028, 0.05 * vel, 'bandpass', Math.min(9000, f * 4), 1.4);

  return { gain, dur };
}

/**
 * Plucked string: a saw-led stack through a lowpass that closes as the note
 * decays, which is what makes it read as a pluck rather than a held pad.
 */
export function pluck(
  ctx: BaseAudioContext,
  dest: AudioNode,
  midi: number,
  t: number,
  vel: number,
): void {
  const f = midiToFreq(midi);
  const dur = 1.5;

  const gain = ctx.createGain();
  gain.connect(dest);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.3 * vel, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0006, t + dur);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(7000, f * 8), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(400, f * 2), t + dur);
  lp.connect(gain);

  const partials: [number, number, OscillatorType][] = [
    [1, 1, 'sawtooth'],
    [2, 0.22, 'sine'],
    [3, 0.1, 'sine'],
  ];
  for (const [h, a, type] of partials) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f * h;
    const partialGain = ctx.createGain();
    partialGain.gain.value = a * 0.5;
    osc.connect(partialGain);
    partialGain.connect(lp);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  noise(ctx, dest, t, 0.03, 0.06 * vel, 'highpass', 2400);
}

/** Metronome click. Routed to the monitor bus so it stays out of recordings. */
export function click(ctx: BaseAudioContext, dest: AudioNode, t: number, strong: boolean): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = strong ? 1750 : 1150;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(strong ? 0.16 : 0.09, t + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.045);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + 0.06);
}

/**
 * Build a synthetic impulse response: exponentially decaying noise. Cheaper
 * and smaller than shipping a real IR file, and the convolver does not care.
 *
 * The noise is drawn from a fixed sequence rather than at random, which
 * matters more than it sounds like it should. Every chain builds its own
 * reverb, so with real randomness the mixed file and each layer of a set of
 * stems all had a different tail, and the layers no longer added up to the
 * mix. Exporting the same project twice did not give the same file either.
 * One sequence gives the same room every time, and noise is noise.
 */
export function makeImpulseResponse(ctx: BaseAudioContext, dur: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    // A different sequence per side, so the room has a stereo width to it.
    const next = sequence(0x1d872b41 + c * 0x9e3779b9);
    for (let i = 0; i < len; i++) {
      data[i] = (next() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buffer;
}

/** The same stream of numbers between 0 and 1 every time, from a given start. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
