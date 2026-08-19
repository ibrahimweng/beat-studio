import type { DesignName } from '../timeline/types.ts';

/**
 * Sound design voices for scoring picture.
 *
 * These are not drums. They are the sounds motion graphics actually needs:
 * something to land a hit, something to carry a move, something to lead into a
 * cut. Every voice takes a length, because the sound has to fit the shape of
 * the animation rather than the other way round.
 *
 * All of them accept a BaseAudioContext, so the same code renders live and
 * offline.
 */

export interface DesignOptions {
  /** Seconds the voice should occupy. */
  length: number;
  /** Pitch offset in semitones. */
  tune: number;
  /** Level, roughly 0 to 1.5. */
  gain: number;
}

const ratio = (semitones: number): number => Math.pow(2, semitones / 12);

/** Filtered noise with its own gain envelope, shaped by the caller. */
function noiseBed(
  ctx: BaseAudioContext,
  dest: AudioNode,
  t: number,
  dur: number,
  type: BiquadFilterType,
  q: number,
): { filter: BiquadFilterNode; gain: GainNode } {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;

  const gain = ctx.createGain();
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start(t);
  src.stop(t + dur + 0.05);
  return { filter, gain };
}

/** A hit. Pitch falls fast, with a transient on top so it cuts through. */
function impact(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.12, o.length);
  const f0 = 180 * ratio(o.tune);

  const osc = ctx.createOscillator();
  const body = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(24, f0 * 0.22), t + dur * 0.7);
  body.gain.setValueAtTime(0, t);
  body.gain.linearRampToValueAtTime(1.1 * o.gain, t + 0.006);
  body.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  osc.connect(body);
  body.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.05);

  // Transient, so the hit reads on small speakers as well as large ones.
  const snap = noiseBed(ctx, dest, t, Math.min(0.09, dur), 'highpass', 0.7);
  snap.filter.frequency.value = 2200 * ratio(o.tune * 0.5);
  snap.gain.gain.setValueAtTime(0.5 * o.gain, t);
  snap.gain.gain.exponentialRampToValueAtTime(0.0008, t + Math.min(0.09, dur));
}

/** A move. The filter sweeps up and back down while the level swells. */
function whoosh(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.15, o.length);
  const peak = t + dur * 0.55;
  const bed = noiseBed(ctx, dest, t, dur, 'bandpass', 1.1);

  const low = 320 * ratio(o.tune);
  const high = 2600 * ratio(o.tune);
  bed.filter.frequency.setValueAtTime(low, t);
  bed.filter.frequency.exponentialRampToValueAtTime(high, peak);
  bed.filter.frequency.exponentialRampToValueAtTime(low * 0.7, t + dur);

  bed.gain.gain.setValueAtTime(0.0008, t);
  bed.gain.gain.exponentialRampToValueAtTime(0.55 * o.gain, peak);
  bed.gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
}

/** A lead in. Everything climbs and then stops, so it wants an end anchor. */
function riser(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.2, o.length);
  const bed = noiseBed(ctx, dest, t, dur, 'bandpass', 3.2);
  bed.filter.frequency.setValueAtTime(240 * ratio(o.tune), t);
  bed.filter.frequency.exponentialRampToValueAtTime(5200 * ratio(o.tune), t + dur);
  bed.gain.gain.setValueAtTime(0.0008, t);
  bed.gain.gain.exponentialRampToValueAtTime(0.4 * o.gain, t + dur * 0.92);
  bed.gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);

  // A tone underneath gives the climb a pitch to follow.
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(110 * ratio(o.tune), t);
  osc.frequency.exponentialRampToValueAtTime(880 * ratio(o.tune), t + dur);
  gain.gain.setValueAtTime(0.0006, t);
  gain.gain.exponentialRampToValueAtTime(0.18 * o.gain, t + dur * 0.9);
  gain.gain.exponentialRampToValueAtTime(0.0006, t + dur);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4200;
  osc.connect(lp);
  lp.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Weight under a hit. Low and slow, nothing on top. */
function sub(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.2, o.length);
  const f0 = 90 * ratio(o.tune);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f0 * 0.35), t + dur);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.95 * o.gain, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** A tick. For counters, small UI moves and anything that needs to be exact. */
function click(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.02, Math.min(0.2, o.length));
  const bed = noiseBed(ctx, dest, t, dur, 'highpass', 0.9);
  bed.filter.frequency.value = 3400 * ratio(o.tune);
  bed.gain.gain.setValueAtTime(0.6 * o.gain, t);
  bed.gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
}

/** A blip. A short pitched note, for things appearing. */
function pop(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.05, Math.min(0.5, o.length));
  const f0 = 660 * ratio(o.tune);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(f0 * 0.6, t);
  osc.frequency.exponentialRampToValueAtTime(f0, t + dur * 0.25);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.5 * o.gain, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/**
 * A reverse swell. The level rises to nothing and stops dead, which is what
 * makes a cut feel inevitable. Anchored to its end by default.
 */
function swell(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.2, o.length);
  const bed = noiseBed(ctx, dest, t, dur, 'lowpass', 0.9);
  bed.filter.frequency.setValueAtTime(700 * ratio(o.tune), t);
  bed.filter.frequency.exponentialRampToValueAtTime(4800 * ratio(o.tune), t + dur);
  bed.gain.gain.setValueAtTime(0.0006, t);
  bed.gain.gain.exponentialRampToValueAtTime(0.5 * o.gain, t + dur * 0.97);
  // Cut rather than fade, so the following hit lands in silence.
  bed.gain.gain.linearRampToValueAtTime(0.0001, t + dur);
}

const VOICES: Record<
  DesignName,
  (ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions) => void
> = { impact, whoosh, riser, sub, click, pop, swell };

/** Play one design voice at an absolute context time. */
export function playDesign(
  ctx: BaseAudioContext,
  dest: AudioNode,
  name: DesignName,
  t: number,
  options: DesignOptions,
): void {
  VOICES[name]?.(ctx, dest, t, options);
}
