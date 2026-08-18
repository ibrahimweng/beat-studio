import type { PadName, Voice } from '../types.ts';

/**
 * Voice synthesis. Every function here is pure in the sense that matters: it
 * takes an AudioContext and a destination, schedules nodes, and touches
 * nothing else. No DOM, no app state.
 *
 * All timings are absolute AudioContext times so the transport can schedule
 * ahead of the clock.
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
  ctx: AudioContext,
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
  ctx: AudioContext,
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

/** Fire one drum voice at an absolute context time. */
export function drum(
  ctx: AudioContext,
  dest: AudioNode,
  pad: PadName,
  t: number,
  vel = 1,
): void {
  const v = vel;
  switch (pad) {
    case 'kick':
      boom(ctx, dest, t, 148, 46, 0.42, 1.15 * v);
      noise(ctx, dest, t, 0.02, 0.3 * v, 'highpass', 1400);
      break;
    case 'kick2':
      boom(ctx, dest, t, 118, 40, 0.5, 1.1 * v);
      noise(ctx, dest, t, 0.02, 0.22 * v, 'highpass', 900);
      break;
    case 'snare':
      noise(ctx, dest, t, 0.19, 0.62 * v, 'bandpass', 1900, 0.8);
      boom(ctx, dest, t, 220, 170, 0.09, 0.4 * v, 'triangle');
      break;
    case 'hhc':
      noise(ctx, dest, t, 0.05, 0.42 * v, 'highpass', 8200);
      break;
    case 'hho':
      noise(ctx, dest, t, 0.38, 0.34 * v, 'highpass', 7200);
      break;
    case 'tom1':
      boom(ctx, dest, t, 250, 128, 0.3, 0.8 * v);
      break;
    case 'tom2':
      boom(ctx, dest, t, 200, 104, 0.34, 0.8 * v);
      break;
    case 'tom3':
      boom(ctx, dest, t, 165, 88, 0.38, 0.8 * v);
      break;
    case 'floor':
      boom(ctx, dest, t, 128, 66, 0.46, 0.85 * v);
      break;
    case 'crash1':
      noise(ctx, dest, t, 1.5, 0.4 * v, 'highpass', 5200);
      noise(ctx, dest, t + 0.01, 1.1, 0.16 * v, 'bandpass', 8600, 0.6);
      break;
    case 'crash2':
      noise(ctx, dest, t, 1.7, 0.42 * v, 'highpass', 4600);
      noise(ctx, dest, t + 0.01, 1.2, 0.16 * v, 'bandpass', 7800, 0.6);
      break;
    case 'splash':
      noise(ctx, dest, t, 0.55, 0.36 * v, 'highpass', 6800);
      break;
    case 'ride':
      noise(ctx, dest, t, 1.1, 0.24 * v, 'bandpass', 4400, 1.2);
      boom(ctx, dest, t, 560, 520, 0.5, 0.1 * v);
      break;
  }
}

/**
 * Additive piano. Four partials over a shared envelope, with the upper ones
 * detuned slightly sharp so the tone beats the way a struck string does.
 * Returns the voice so a key-up can release it early.
 */
export function pianoSynth(
  ctx: AudioContext,
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
  ctx: AudioContext,
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
export function click(ctx: AudioContext, dest: AudioNode, t: number, strong: boolean): void {
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
 */
export function makeImpulseResponse(ctx: AudioContext, dur: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buffer;
}
