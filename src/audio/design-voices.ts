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

/** A steady oscillator driving a parameter, for tremolo and filter movement. */
function lfo(
  ctx: BaseAudioContext,
  target: AudioParam,
  t: number,
  dur: number,
  rate: number,
  depth: number,
): void {
  const osc = ctx.createOscillator();
  const amount = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = rate;
  amount.gain.value = depth;
  osc.connect(amount);
  amount.connect(target);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/**
 * A stack of partials that are not whole multiples of each other.
 *
 * Whole multiples sound like a note. These ratios are close to a struck bar,
 * which is what makes metal read as metal rather than as a pitch.
 */
function inharmonic(
  ctx: BaseAudioContext,
  dest: AudioNode,
  t: number,
  root: number,
  dur: number,
  gain: number,
  ratios: readonly number[],
): void {
  ratios.forEach((ratio, i) => {
    const osc = ctx.createOscillator();
    const level = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = root * ratio;
    // Higher partials fade first, as they do on a real struck object.
    const life = dur * (1 - i / (ratios.length + 1));
    level.gain.setValueAtTime(0, t);
    level.gain.linearRampToValueAtTime((gain * 0.5) / (i + 1), t + 0.004);
    level.gain.exponentialRampToValueAtTime(0.0006, t + Math.max(0.05, life));
    osc.connect(level);
    level.connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  });
}

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
  // Low and round, so it reads as something with size going past. The swipe
  // covers the thin bright end.
  const bed = noiseBed(ctx, dest, t, dur, 'bandpass', 0.7);

  const low = 180 * ratio(o.tune);
  const high = 1400 * ratio(o.tune);
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
  // Mostly tone. The swell is the one made of pure noise, so leading with
  // pitch here is what keeps the two apart.
  const bed = noiseBed(ctx, dest, t, dur, 'bandpass', 3.2);
  bed.filter.frequency.setValueAtTime(240 * ratio(o.tune), t);
  bed.filter.frequency.exponentialRampToValueAtTime(5200 * ratio(o.tune), t + dur);
  bed.gain.gain.setValueAtTime(0.0008, t);
  bed.gain.gain.exponentialRampToValueAtTime(0.14 * o.gain, t + dur * 0.92);
  bed.gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(110 * ratio(o.tune), t);
  osc.frequency.exponentialRampToValueAtTime(1500 * ratio(o.tune), t + dur);
  gain.gain.setValueAtTime(0.0006, t);
  gain.gain.exponentialRampToValueAtTime(0.42 * o.gain, t + dur * 0.9);
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

/**
 * A single point in time. For anything that needs to be exact.
 *
 * Kept as close to an instant as sound allows, and with no movement in it,
 * which is what separates it from the swipe and the zap. Those two are about
 * travel; this one is about a moment.
 */
function click(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.004, Math.min(0.06, o.length));
  const bed = noiseBed(ctx, dest, t, dur, 'highpass', 0.6);
  bed.filter.frequency.value = 6400 * ratio(o.tune);
  bed.gain.gain.setValueAtTime(0.75 * o.gain, t);
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
  // Nothing but noise, and no pitch to follow, which is the whole difference
  // between this and the riser.
  const bed = noiseBed(ctx, dest, t, dur, 'lowpass', 0.5);
  bed.filter.frequency.setValueAtTime(400 * ratio(o.tune), t);
  bed.filter.frequency.exponentialRampToValueAtTime(3000 * ratio(o.tune), t + dur);
  bed.gain.gain.setValueAtTime(0.0006, t);
  bed.gain.gain.exponentialRampToValueAtTime(0.5 * o.gain, t + dur * 0.97);
  // Cut rather than fade, so the following hit lands in silence.
  bed.gain.gain.linearRampToValueAtTime(0.0001, t + dur);
}

/* ---------- hits ---------- */

/** Soft and dull. All body, no transient, so it lands without cutting. */
function thud(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.08, o.length);
  // Sits above the sub rather than on top of it, with enough midrange to be
  // heard as a box being struck rather than as low end.
  const bed = noiseBed(ctx, dest, t, dur, 'lowpass', 1.2);
  bed.filter.frequency.value = 620 * ratio(o.tune);
  bed.gain.gain.setValueAtTime(0.8 * o.gain, t);
  bed.gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(180 * ratio(o.tune), t);
  osc.frequency.exponentialRampToValueAtTime(120 * ratio(o.tune), t + dur * 0.6);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.7 * o.gain, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** The heavy one. A hit with a wide tail behind it. */
function slam(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.2, o.length);

  // Built from its own parts rather than by calling impact, which made the
  // two of them measure as near neighbours.
  const crack = noiseBed(ctx, dest, t, Math.min(0.14, dur), 'bandpass', 1.1);
  crack.filter.frequency.setValueAtTime(2600 * ratio(o.tune), t);
  crack.filter.frequency.exponentialRampToValueAtTime(700 * ratio(o.tune), t + Math.min(0.14, dur));
  crack.gain.gain.setValueAtTime(0.75 * o.gain, t);
  crack.gain.gain.exponentialRampToValueAtTime(0.0008, t + Math.min(0.14, dur));

  const tail = noiseBed(ctx, dest, t, dur, 'bandpass', 0.5);
  tail.filter.frequency.setValueAtTime(900 * ratio(o.tune), t);
  tail.filter.frequency.exponentialRampToValueAtTime(180 * ratio(o.tune), t + dur);
  tail.gain.gain.setValueAtTime(0.42 * o.gain, t);
  tail.gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);

  const low = ctx.createOscillator();
  const lowGain = ctx.createGain();
  low.type = 'sine';
  low.frequency.setValueAtTime(70 * ratio(o.tune), t);
  low.frequency.exponentialRampToValueAtTime(34 * ratio(o.tune), t + dur * 0.8);
  lowGain.gain.setValueAtTime(0.8 * o.gain, t);
  lowGain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  low.connect(lowGain);
  lowGain.connect(dest);
  low.start(t);
  low.stop(t + dur + 0.05);
}

/** Struck metal. Rings on long after the strike, and never lands on a note. */
function metal(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.2, o.length);
  inharmonic(ctx, dest, t, 220 * ratio(o.tune), dur, o.gain, [1, 2.76, 5.4, 8.93, 13.34, 18.64]);
}

/** The same material, hit briefly. Short, hard and metallic. */
function clank(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.05, Math.min(0.6, o.length));
  inharmonic(ctx, dest, t, 300 * ratio(o.tune), dur, o.gain, [1, 2.14, 3.77, 7.09]);
  const snap = noiseBed(ctx, dest, t, Math.min(0.02, dur), 'bandpass', 2);
  snap.filter.frequency.value = 3200;
  snap.gain.gain.setValueAtTime(0.4 * o.gain, t);
  snap.gain.gain.exponentialRampToValueAtTime(0.0008, t + Math.min(0.02, dur));
}

/* ---------- movement ---------- */

/** A quick pass. Higher and tighter than a whoosh, and over faster. */
function swipe(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.1, Math.min(1.2, o.length));
  // Thin and bright throughout, which is what keeps it apart from the whoosh.
  const bed = noiseBed(ctx, dest, t, dur, 'bandpass', 4.5);
  bed.filter.frequency.setValueAtTime(2000 * ratio(o.tune), t);
  bed.filter.frequency.exponentialRampToValueAtTime(12000 * ratio(o.tune), t + dur);
  bed.gain.gain.setValueAtTime(0.0008, t);
  bed.gain.gain.exponentialRampToValueAtTime(0.45 * o.gain, t + dur * 0.6);
  bed.gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
}

/** Noise being chopped, for propellers, flickers and fast repeats. */
function flutter(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.1, o.length);
  const bed = noiseBed(ctx, dest, t, dur, 'bandpass', 5);
  bed.filter.frequency.value = 900 * ratio(o.tune);
  bed.gain.gain.setValueAtTime(0.0008, t);
  bed.gain.gain.exponentialRampToValueAtTime(0.3 * o.gain, t + 0.04);
  bed.gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  // Deep enough to reach silence between beats, so it is heard as chopping
  // rather than as a steady bed with a wobble on it.
  lfo(ctx, bed.gain.gain, t, dur, 7.5, 0.42 * o.gain);
}

/** A held tone with the filter swinging under it. */
function wobble(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.2, o.length);
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.value = 82 * ratio(o.tune);
  filter.type = 'lowpass';
  filter.Q.value = 7;
  filter.frequency.value = 700 * ratio(o.tune);
  // Deep and quick enough that the movement is the sound, rather than a
  // drone with a slight waver on it.
  lfo(ctx, filter.frequency, t, dur, 6.5, 640);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.34 * o.gain, t + 0.03);
  gain.gain.setValueAtTime(0.34 * o.gain, t + dur * 0.8);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/* ---------- lead ins ---------- */

/**
 * A hit played backwards.
 *
 * Built by filling a buffer with a decaying sound and then reading the samples
 * out in reverse, which is a different shape from anything an envelope can
 * make. It grows out of nothing and stops dead.
 */
function reverse(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.15, o.length);
  const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const step = (2 * Math.PI * 320 * ratio(o.tune)) / ctx.sampleRate;

  for (let i = 0; i < length; i++) {
    const decay = Math.pow(1 - i / length, 3);
    // Noise and tone together, so it has both air and body when reversed.
    data[i] = ((Math.random() * 2 - 1) * 0.6 + Math.sin(i * step) * 0.4) * decay;
  }
  data.reverse();

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = 0.7 * o.gain;
  src.connect(gain);
  gain.connect(dest);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/* ---------- low end ---------- */

/** Weather rather than a hit. Very low, slow and wide. */
function rumble(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.3, o.length);
  const bed = noiseBed(ctx, dest, t, dur, 'lowpass', 1.4);
  bed.filter.frequency.value = 85 * ratio(o.tune);
  bed.gain.gain.setValueAtTime(0.0008, t);
  bed.gain.gain.exponentialRampToValueAtTime(1.1 * o.gain, t + dur * 0.35);
  bed.gain.gain.setValueAtTime(1.1 * o.gain, t + dur * 0.6);
  bed.gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  // A slow swell, so it moves without ever becoming a beat.
  lfo(ctx, bed.gain.gain, t, dur, 1.3, 0.25 * o.gain);
}

/** A held bed to sit under everything else. Two voices, slightly apart. */
function drone(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.3, o.length);
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  // Fixed on purpose. Anything moving here would blur it into the wobble.
  filter.frequency.value = 520 * ratio(o.tune);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.3 * o.gain, t + Math.min(0.4, dur * 0.3));
  gain.gain.setValueAtTime(0.3 * o.gain, t + dur * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.0006, t + dur);
  filter.connect(gain);
  gain.connect(dest);

  // The small difference between them is what stops it sounding synthetic.
  for (const detune of [-6, 6]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55 * ratio(o.tune);
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

/* ---------- detail ---------- */

/** Drier and smaller than a click. For counters and small steps. */
function tick(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.008, Math.min(0.08, o.length));
  const bed = noiseBed(ctx, dest, t, dur, 'bandpass', 6);
  bed.filter.frequency.value = 2100 * ratio(o.tune);
  bed.gain.gain.setValueAtTime(0.7 * o.gain, t);
  bed.gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
}

/** A plain tone. Deliberately electronic, for anything on a screen. */
function beep(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.03, Math.min(1.5, o.length));
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 880 * ratio(o.tune);
  // Flat, with only enough shaping to stop it clicking at the ends.
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.24 * o.gain, t + 0.004);
  gain.gain.setValueAtTime(0.24 * o.gain, t + dur - 0.006);
  gain.gain.linearRampToValueAtTime(0, t + dur);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** A fast rise. For things appearing and counting up. */
function chirp(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.03, Math.min(0.8, o.length));
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(240 * ratio(o.tune), t);
  osc.frequency.exponentialRampToValueAtTime(2100 * ratio(o.tune), t + dur);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.4 * o.gain, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/* ---------- texture ---------- */

/** A fast fall with an edge on it. Electric rather than physical. */
function zap(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.08, Math.min(1.5, o.length));
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(2600 * ratio(o.tune), t);
  osc.frequency.exponentialRampToValueAtTime(90 * ratio(o.tune), t + dur);

  // A resonant filter riding the pitch down keeps this clearly a falling
  // tone. Noise on top made it read as a click instead.
  filter.type = 'lowpass';
  filter.Q.value = 9;
  filter.frequency.setValueAtTime(5200 * ratio(o.tune), t);
  filter.frequency.exponentialRampToValueAtTime(200 * ratio(o.tune), t + dur);

  gain.gain.setValueAtTime(0.45 * o.gain, t);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/**
 * Broken up rather than smooth.
 *
 * Several very short bursts at uneven spacing inside the length, which is a
 * shape no envelope produces, so it never resembles the other voices.
 */
function glitch(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.06, o.length);
  const bursts = Math.max(3, Math.min(14, Math.round(dur * 16)));
  for (let i = 0; i < bursts; i++) {
    // Uneven on purpose. Evenly spaced bursts read as a rhythm.
    const at = t + (i / bursts) * dur + Math.random() * (dur / bursts) * 0.7;
    const life = 0.006 + Math.random() * 0.03;
    const bed = noiseBed(ctx, dest, at, life, 'bandpass', 3);
    bed.filter.frequency.value = (600 + Math.random() * 5200) * ratio(o.tune);
    bed.gain.gain.setValueAtTime((0.25 + Math.random() * 0.35) * o.gain, at);
    bed.gain.gain.exponentialRampToValueAtTime(0.0008, at + life);
  }
}

/** High, bright and slow to arrive. For sparkle and reveals. */
function shimmer(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.3, o.length);
  inharmonic(ctx, dest, t, 1400 * ratio(o.tune), dur, o.gain * 0.5, [1, 1.83, 2.71, 3.94, 5.3]);
  const air = noiseBed(ctx, dest, t, dur, 'highpass', 0.7);
  air.filter.frequency.value = 7000;
  air.gain.gain.setValueAtTime(0.0006, t);
  air.gain.gain.exponentialRampToValueAtTime(0.1 * o.gain, t + dur * 0.4);
  air.gain.gain.exponentialRampToValueAtTime(0.0006, t + dur);
}

/** Flat noise that goes nowhere. For interference and dead air. */
function noiseFloor(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions): void {
  const dur = Math.max(0.05, o.length);
  const bed = noiseBed(ctx, dest, t, dur, 'bandpass', 0.4);
  bed.filter.frequency.value = 2400 * ratio(o.tune);
  // No movement at all beyond the edges, which is what sets it apart.
  bed.gain.gain.setValueAtTime(0, t);
  bed.gain.gain.linearRampToValueAtTime(0.3 * o.gain, t + 0.01);
  bed.gain.gain.setValueAtTime(0.3 * o.gain, t + dur - 0.01);
  bed.gain.gain.linearRampToValueAtTime(0, t + dur);
}

const VOICES: Record<
  DesignName,
  (ctx: BaseAudioContext, dest: AudioNode, t: number, o: DesignOptions) => void
> = {
  impact, thud, slam, metal, clank,
  whoosh, swipe, flutter, wobble,
  riser, swell, reverse,
  sub, rumble, drone,
  click, tick, pop, beep, chirp,
  zap, glitch, shimmer, static: noiseFloor,
};

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
