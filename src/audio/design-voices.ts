import type { DesignName } from '../timeline/types.ts';
import {
  flat,
  ratio,
  renderVoice,
  sequence,
  type Curve,
  type LayerSpec,
  type VoiceOptions,
  type VoiceSpec,
} from './voice-spec.ts';

/**
 * Sound design voices, for placing against picture.
 *
 * These are not drums. They are the sounds motion graphics actually needs:
 * something to land a hit, something to carry a move, something to lead into a
 * cut. Every voice takes a length, because the sound has to fit the shape of
 * the animation rather than the other way round.
 *
 * Each one is a description rather than a piece of code that makes noise. It
 * says what the voice is built from and how each part moves, and
 * {@link renderVoice} is the only thing that turns that into sound. Written
 * this way a voice can be exported to a patch file, read back from one, and
 * changed without touching the audio graph at all.
 *
 * They are still built from different mechanisms rather than from one
 * mechanism with the numbers moved around, which is what keeps them apart
 * from each other however they are tuned or stretched. `tools/voice-check.html`
 * measures that, and `tools/voice-print.html` measures whether a change to any
 * of them altered how it sounds.
 */

export type DesignOptions = VoiceOptions;

// ---------- shapes every voice is built out of ----------

/** Starts at full and decays away. */
const decays = (peak: number, over: number, floor = 0.0008): Curve => [
  { at: 0, to: peak },
  { at: over, to: floor, curve: 'exp' },
];

/** Rises quickly to full, then decays away. */
const struck = (peak: number, over: number, attack: number, floor = 0.0008): Curve => [
  { at: 0, to: 0 },
  { at: attack, to: peak, curve: 'linear' },
  { at: over, to: floor, curve: 'exp' },
];

/** Grows out of near silence to a peak, then falls back. */
const grows = (
  peak: number,
  to: number,
  over: number,
  floor = 0.0008,
): Curve => [
  { at: 0, to: floor },
  { at: to, to: peak, curve: 'exp' },
  { at: over, to: floor, curve: 'exp' },
];

/** Rises, sits at level, then falls. */
const holds = (
  peak: number,
  attack: number,
  until: number,
  over: number,
  floor = 0.0008,
): Curve => [
  { at: 0, to: 0 },
  { at: attack, to: peak, curve: 'linear' },
  { at: until, to: peak, curve: 'set' },
  { at: over, to: floor, curve: 'exp' },
];

const noise = (
  length: number,
  gain: Curve,
  filter: LayerSpec['filter'],
  lfo?: LayerSpec['lfo'],
): LayerSpec => ({ source: { kind: 'noise' }, filter, gain, length, ...(lfo ? { lfo } : {}) });

const tone = (
  type: OscillatorType,
  freq: Curve,
  gain: Curve,
  length: number,
  extra: Partial<LayerSpec> = {},
): LayerSpec => ({ source: { kind: 'osc', type, freq }, gain, length, ...extra });

/** These four have always stopped sooner than the rest. See LayerSpec.overrun. */
const SHORT_TAIL = 0.02;

/**
 * Partials that are not whole multiples of each other.
 *
 * Whole multiples sound like a note. These ratios are close to a struck bar,
 * which is what makes metal read as metal rather than as a pitch. Higher
 * partials fade first, as they do on a real struck object.
 */
function inharmonic(
  root: number,
  ratios: readonly number[],
  dur: number,
  gain: number,
): LayerSpec[] {
  return ratios.map((r, i) =>
    tone(
      'sine',
      flat(root * r),
      struck((gain * 0.5) / (i + 1), Math.max(0.05, dur * (1 - i / (ratios.length + 1))), 0.004, 0.0006),
      dur,
    ),
  );
}

/**
 * A struck body, as the notes it rings at.
 *
 * Each partial carries its own decay, so the layer's own level is left flat:
 * what shapes this sound is the object falling silent one partial at a time,
 * not an envelope laid over the top of it. Decays are given as a share of the
 * whole length, so stretching the sound stretches the ringing rather than
 * cutting it off.
 */
const body = (
  freq: number,
  partials: readonly (readonly [ratio: number, gain: number, decay: number])[],
  dur: number,
  gain: number,
  strike = 1,
): LayerSpec => ({
  source: {
    kind: 'modal',
    freq,
    strike,
    partials: partials.map(([ratio, level, decay]) => ({ ratio, gain: level, decay: decay * dur })),
  },
  gain: flat(gain),
  length: dur,
});

/** Something excited once and left to run round itself. */
const plucked = (
  freq: number,
  damping: number,
  dur: number,
  gain: number,
  extra: Partial<LayerSpec> = {},
  colour = 1,
  sustain = 0.998,
): LayerSpec => ({
  source: { kind: 'pluck', freq, damping, colour, sustain },
  gain: decays(gain, dur),
  length: dur,
  ...extra,
});

/** A cloud of short bursts. */
const cloud = (
  spec: { density: number; grain: number; freq: number; spread: number; air?: number; rise?: number },
  dur: number,
  gain: Curve,
  filter?: LayerSpec['filter'],
  lfo?: LayerSpec['lfo'],
): LayerSpec => ({
  source: { kind: 'grains', ...spec },
  gain,
  length: dur,
  ...(filter ? { filter } : {}),
  ...(lfo ? { lfo } : {}),
});

/** A run of hits, at a rate that can change while it runs. */
const run = (
  spec: { rate: Curve; ring: number; freq: number; jitter?: number },
  dur: number,
  gain: Curve,
  filter?: LayerSpec['filter'],
): LayerSpec => ({
  source: { kind: 'impulses', ...spec },
  gain,
  length: dur,
  ...(filter ? { filter } : {}),
});

const one = (duration: number, layer: LayerSpec): VoiceSpec => ({ duration, layers: [layer] });
const all = (duration: number, layers: LayerSpec[]): VoiceSpec => ({ duration, layers });

// ---------- the voices ----------

/**
 * Every voice, as a function from what is being asked for to a description.
 *
 * The record is keyed by every name in {@link DesignName}, so a voice cannot
 * be added to the palette without being described here.
 */
export const DESIGN_SPECS: Record<DesignName, (o: DesignOptions) => VoiceSpec> = {
  /* ---------- hits ---------- */

  /** A hit. Pitch falls fast, with a transient on top so it cuts through. */
  impact: (o) => {
    const dur = Math.max(0.12, o.length);
    const f0 = 180 * ratio(o.tune);
    const snap = Math.min(0.09, dur);
    return all(dur, [
      tone(
        'sine',
        [{ at: 0, to: f0 }, { at: dur * 0.7, to: Math.max(24, f0 * 0.22), curve: 'exp' }],
        struck(1.1 * o.gain, dur, 0.006),
        dur,
      ),
      // Transient, so the hit reads on small speakers as well as large ones.
      noise(snap, decays(0.5 * o.gain, snap), {
        type: 'highpass',
        freq: flat(2200 * ratio(o.tune * 0.5)),
        q: 0.7,
      }),
    ]);
  },

  /** Soft and dull. All body, no transient, so it lands without cutting. */
  thud: (o) => {
    const dur = Math.max(0.08, o.length);
    const r = ratio(o.tune);
    return all(dur, [
      // Sits above the sub rather than on top of it, with enough midrange to
      // be heard as a box being struck rather than as low end.
      noise(dur, decays(0.8 * o.gain, dur), { type: 'lowpass', freq: flat(620 * r), q: 1.2 }),
      tone(
        'triangle',
        [{ at: 0, to: 180 * r }, { at: dur * 0.6, to: 120 * r, curve: 'exp' }],
        struck(0.7 * o.gain, dur, 0.012),
        dur,
      ),
    ]);
  },

  /** The heavy one. A hit with a wide tail behind it. */
  slam: (o) => {
    const dur = Math.max(0.2, o.length);
    const r = ratio(o.tune);
    const crack = Math.min(0.14, dur);
    // Built from its own parts rather than from the impact, which made the
    // two of them measure as near neighbours.
    return all(dur, [
      noise(crack, decays(0.75 * o.gain, crack), {
        type: 'bandpass',
        freq: [{ at: 0, to: 2600 * r }, { at: crack, to: 700 * r, curve: 'exp' }],
        q: 1.1,
      }),
      noise(dur, decays(0.42 * o.gain, dur), {
        type: 'bandpass',
        freq: [{ at: 0, to: 900 * r }, { at: dur, to: 180 * r, curve: 'exp' }],
        q: 0.5,
      }),
      tone(
        'sine',
        [{ at: 0, to: 70 * r }, { at: dur * 0.8, to: 34 * r, curve: 'exp' }],
        decays(0.8 * o.gain, dur),
        dur,
      ),
    ]);
  },

  /** Struck metal. Rings on long after the strike, and never lands on a note. */
  metal: (o) => {
    const dur = Math.max(0.2, o.length);
    return all(dur, inharmonic(220 * ratio(o.tune), [1, 2.76, 5.4, 8.93, 13.34, 18.64], dur, o.gain));
  },

  /** The same material, hit briefly. Short, hard and metallic. */
  clank: (o) => {
    const dur = Math.max(0.05, Math.min(0.6, o.length));
    const snap = Math.min(0.02, dur);
    return all(dur, [
      ...inharmonic(300 * ratio(o.tune), [1, 2.14, 3.77, 7.09], dur, o.gain),
      noise(snap, decays(0.4 * o.gain, snap), { type: 'bandpass', freq: flat(3200), q: 2 }),
    ]);
  },

  /* ---------- movement ---------- */

  /** A move. The filter sweeps up and back down while the level swells. */
  whoosh: (o) => {
    const dur = Math.max(0.15, o.length);
    const low = 180 * ratio(o.tune);
    const high = 1400 * ratio(o.tune);
    // Low and round, so it reads as something with size going past. The swipe
    // covers the thin bright end.
    return one(
      dur,
      noise(dur, grows(0.55 * o.gain, dur * 0.55, dur), {
        type: 'bandpass',
        freq: [
          { at: 0, to: low },
          { at: dur * 0.55, to: high, curve: 'exp' },
          { at: dur, to: low * 0.7, curve: 'exp' },
        ],
        q: 0.7,
      }),
    );
  },

  /** A quick pass. Higher and tighter than a whoosh, and over faster. */
  swipe: (o) => {
    const dur = Math.max(0.1, Math.min(1.2, o.length));
    const r = ratio(o.tune);
    // Thin and bright throughout, which is what keeps it apart from the whoosh.
    return one(
      dur,
      noise(dur, grows(0.45 * o.gain, dur * 0.6, dur), {
        type: 'bandpass',
        freq: [{ at: 0, to: 2000 * r }, { at: dur, to: 12000 * r, curve: 'exp' }],
        q: 4.5,
      }),
    );
  },

  /** Noise being chopped, for propellers, flickers and fast repeats. */
  flutter: (o) => {
    const dur = Math.max(0.1, o.length);
    return one(
      dur,
      noise(
        dur,
        grows(0.3 * o.gain, 0.04, dur),
        { type: 'bandpass', freq: flat(900 * ratio(o.tune)), q: 5 },
        // Deep enough to reach silence between beats, so it is heard as
        // chopping rather than as a steady bed with a wobble on it.
        [{ rate: 7.5, depth: 0.42 * o.gain, target: 'gain' }],
      ),
    );
  },

  /** A held tone with the filter swinging under it. */
  wobble: (o) => {
    const dur = Math.max(0.2, o.length);
    const r = ratio(o.tune);
    return one(
      dur,
      tone('sawtooth', flat(82 * r), holds(0.34 * o.gain, 0.03, dur * 0.8, dur), dur, {
        filter: { type: 'lowpass', freq: flat(700 * r), q: 7 },
        // Deep and quick enough that the movement is the sound, rather than a
        // drone with a slight waver on it.
        lfo: [{ rate: 6.5, depth: 640, target: 'filterFreq' }],
      }),
    );
  },

  /* ---------- lead ins ---------- */

  /** A lead in. Everything climbs and then stops, so it wants an end anchor. */
  riser: (o) => {
    const dur = Math.max(0.2, o.length);
    const r = ratio(o.tune);
    // Mostly tone. The swell is the one made of pure noise, so leading with
    // pitch here is what keeps the two apart.
    return all(dur, [
      noise(dur, grows(0.14 * o.gain, dur * 0.92, dur), {
        type: 'bandpass',
        freq: [{ at: 0, to: 240 * r }, { at: dur, to: 5200 * r, curve: 'exp' }],
        q: 3.2,
      }),
      tone(
        'sawtooth',
        [{ at: 0, to: 110 * r }, { at: dur, to: 1500 * r, curve: 'exp' }],
        grows(0.42 * o.gain, dur * 0.9, dur, 0.0006),
        dur,
        { filter: { type: 'lowpass', freq: flat(4200) } },
      ),
    ]);
  },

  /**
   * A reverse swell. The level rises to nothing and stops dead, which is what
   * makes a cut feel inevitable. Anchored to its end by default.
   */
  swell: (o) => {
    const dur = Math.max(0.2, o.length);
    const r = ratio(o.tune);
    // Nothing but noise, and no pitch to follow, which is the whole difference
    // between this and the riser.
    return one(
      dur,
      noise(
        dur,
        [
          { at: 0, to: 0.0006 },
          { at: dur * 0.97, to: 0.5 * o.gain, curve: 'exp' },
          // Cut rather than fade, so the following hit lands in silence.
          { at: dur, to: 0.0001, curve: 'linear' },
        ],
        {
          type: 'lowpass',
          freq: [{ at: 0, to: 400 * r }, { at: dur, to: 3000 * r, curve: 'exp' }],
          q: 0.5,
        },
      ),
    );
  },

  /**
   * A hit played backwards.
   *
   * A buffer written with a decaying sound and read back the other way round,
   * which is a shape no envelope can make. It grows out of nothing and stops
   * dead.
   */
  reverse: (o) => {
    const dur = Math.max(0.15, o.length);
    return one(dur, {
      // Noise and tone together, so it has both air and body when reversed.
      source: { kind: 'reverse', freq: 320 * ratio(o.tune), shape: 3, air: 0.6 },
      gain: flat(0.7 * o.gain),
      length: dur,
      overrun: SHORT_TAIL,
    });
  },

  /* ---------- low end ---------- */

  /** Weight under a hit. Low and slow, nothing on top. */
  sub: (o) => {
    const dur = Math.max(0.2, o.length);
    const f0 = 90 * ratio(o.tune);
    return one(
      dur,
      tone(
        'sine',
        [{ at: 0, to: f0 }, { at: dur, to: Math.max(20, f0 * 0.35), curve: 'exp' }],
        struck(0.95 * o.gain, dur, 0.02),
        dur,
      ),
    );
  },

  /** Weather rather than a hit. Very low, slow and wide. */
  rumble: (o) => {
    const dur = Math.max(0.3, o.length);
    return one(
      dur,
      noise(
        dur,
        [
          { at: 0, to: 0.0008 },
          { at: dur * 0.35, to: 1.1 * o.gain, curve: 'exp' },
          { at: dur * 0.6, to: 1.1 * o.gain, curve: 'set' },
          { at: dur, to: 0.0008, curve: 'exp' },
        ],
        { type: 'lowpass', freq: flat(85 * ratio(o.tune)), q: 1.4 },
        // A slow swell, so it moves without ever becoming a beat.
        [{ rate: 1.3, depth: 0.25 * o.gain, target: 'gain' }],
      ),
    );
  },

  /** A held bed to sit under everything else. Two voices, slightly apart. */
  drone: (o) => {
    const dur = Math.max(0.3, o.length);
    const r = ratio(o.tune);
    const envelope = holds(0.3 * o.gain, Math.min(0.4, dur * 0.3), dur * 0.7, dur, 0.0006);
    // The small difference between them is what stops it sounding synthetic.
    return all(
      dur,
      [-6, 6].map((detune) => ({
        source: { kind: 'osc' as const, type: 'sawtooth' as OscillatorType, freq: flat(55 * r), detune },
        // Fixed on purpose. Anything moving here would blur it into the wobble.
        filter: { type: 'lowpass' as BiquadFilterType, freq: flat(520 * r) },
        gain: envelope,
        length: dur,
      })),
    );
  },

  /* ---------- detail ---------- */

  /**
   * A single point in time. For anything that needs to be exact.
   *
   * Kept as close to an instant as sound allows, and with no movement in it,
   * which is what separates it from the swipe and the zap. Those two are about
   * travel; this one is about a moment.
   */
  click: (o) => {
    const dur = Math.max(0.004, Math.min(0.06, o.length));
    return one(
      dur,
      noise(dur, decays(0.75 * o.gain, dur), {
        type: 'highpass',
        freq: flat(6400 * ratio(o.tune)),
        q: 0.6,
      }),
    );
  },

  /** Drier and smaller than a click. For counters and small steps. */
  tick: (o) => {
    const dur = Math.max(0.008, Math.min(0.08, o.length));
    return one(
      dur,
      noise(dur, decays(0.7 * o.gain, dur), {
        type: 'bandpass',
        freq: flat(2100 * ratio(o.tune)),
        q: 6,
      }),
    );
  },

  /** A blip. A short pitched note, for things appearing. */
  pop: (o) => {
    const dur = Math.max(0.05, Math.min(0.5, o.length));
    const f0 = 660 * ratio(o.tune);
    return one(
      dur,
      tone(
        'triangle',
        [{ at: 0, to: f0 * 0.6 }, { at: dur * 0.25, to: f0, curve: 'exp' }],
        struck(0.5 * o.gain, dur, 0.006),
        dur,
      ),
    );
  },

  /** A plain tone. Deliberately electronic, for anything on a screen. */
  beep: (o) => {
    const dur = Math.max(0.03, Math.min(1.5, o.length));
    const peak = 0.24 * o.gain;
    // Flat, with only enough shaping to stop it clicking at the ends.
    return one(
      dur,
      tone('square', flat(880 * ratio(o.tune)), [
        { at: 0, to: 0 },
        { at: 0.004, to: peak, curve: 'linear' },
        { at: dur - 0.006, to: peak, curve: 'set' },
        { at: dur, to: 0, curve: 'linear' },
      ], dur, { overrun: SHORT_TAIL }),
    );
  },

  /** A fast rise. For things appearing and counting up. */
  chirp: (o) => {
    const dur = Math.max(0.03, Math.min(0.8, o.length));
    const r = ratio(o.tune);
    return one(
      dur,
      tone(
        'sine',
        [{ at: 0, to: 240 * r }, { at: dur, to: 2100 * r, curve: 'exp' }],
        struck(0.4 * o.gain, dur, 0.006),
        dur,
        { overrun: SHORT_TAIL },
      ),
    );
  },

  /* ---------- texture ---------- */

  /** A fast fall with an edge on it. Electric rather than physical. */
  zap: (o) => {
    const dur = Math.max(0.08, Math.min(1.5, o.length));
    const r = ratio(o.tune);
    return one(
      dur,
      tone(
        'sawtooth',
        [{ at: 0, to: 2600 * r }, { at: dur, to: 90 * r, curve: 'exp' }],
        decays(0.45 * o.gain, dur),
        dur,
        {
          overrun: SHORT_TAIL,
          // A resonant filter riding the pitch down keeps this clearly a
          // falling tone. Noise on top made it read as a click instead.
          filter: {
            type: 'lowpass',
            freq: [{ at: 0, to: 5200 * r }, { at: dur, to: 200 * r, curve: 'exp' }],
            q: 9,
          },
        },
      ),
    );
  },

  /**
   * Broken up rather than smooth.
   *
   * Several very short bursts at uneven spacing inside the length, which is a
   * shape no envelope produces, so it never resembles the other voices.
   */
  glitch: (o) => {
    const dur = Math.max(0.06, o.length);
    const bursts = Math.max(3, Math.min(14, Math.round(dur * 16)));
    const r = ratio(o.tune);
    // Where the bursts fall is part of the description, so a placed glitch is
    // the same glitch every time it is heard rather than a new one.
    const random = o.seed === undefined ? Math.random : sequence(o.seed ^ 0x9e3779b9);
    const layers: LayerSpec[] = [];
    for (let i = 0; i < bursts; i++) {
      // Uneven on purpose. Evenly spaced bursts read as a rhythm.
      const delay = (i / bursts) * dur + random() * (dur / bursts) * 0.7;
      const life = 0.006 + random() * 0.03;
      layers.push({
        ...noise(life, decays((0.25 + random() * 0.35) * o.gain, life), {
          type: 'bandpass',
          freq: flat((600 + random() * 5200) * r),
          q: 3,
        }),
        delay,
      });
    }
    return all(dur, layers);
  },

  /** High, bright and slow to arrive. For sparkle and reveals. */
  shimmer: (o) => {
    const dur = Math.max(0.3, o.length);
    return all(dur, [
      ...inharmonic(1400 * ratio(o.tune), [1, 1.83, 2.71, 3.94, 5.3], dur, o.gain * 0.5),
      noise(dur, grows(0.1 * o.gain, dur * 0.4, dur, 0.0006), {
        type: 'highpass',
        freq: flat(7000),
        q: 0.7,
      }),
    ]);
  },

  /** Flat noise that goes nowhere. For interference and dead air. */
  static: (o) => {
    const dur = Math.max(0.05, o.length);
    const peak = 0.3 * o.gain;
    return one(
      dur,
      noise(
        dur,
        // No movement at all beyond the edges, which is what sets it apart.
        [
          { at: 0, to: 0 },
          { at: 0.01, to: peak, curve: 'linear' },
          { at: dur - 0.01, to: peak, curve: 'set' },
          { at: dur, to: 0, curve: 'linear' },
        ],
        { type: 'bandpass', freq: flat(2400 * ratio(o.tune)), q: 0.4 },
      ),
    );
  },

  // ---------- struck bodies ----------

  bell: (o) => {
    const dur = Math.max(0.3, o.length);
    const r = ratio(o.tune);
    // Nowhere near whole multiples, which is what stops a bell reading as a
    // note. The lowest partial outlives the rest by a long way.
    // The partial half an octave below the named note is the hum, and it is
    // the longest lived thing in a real bell. Without it this was a clank.
    return one(dur, body(320 * r, [
      [0.5, 0.3, 1],
      [1, 0.42, 0.78],
      [2.76, 0.24, 0.5],
      [5.4, 0.13, 0.26],
      [8.93, 0.07, 0.13],
    ], dur, 0.9 * o.gain));
  },

  glass: (o) => {
    const dur = Math.max(0.25, o.length);
    const r = ratio(o.tune);
    // High, and it keeps its top end nearly as long as its bottom, which is
    // the whole difference between glass and everything else struck.
    return one(dur, body(1180 * r, [
      [1, 0.36, 1],
      [2.41, 0.3, 0.88],
      [4.18, 0.22, 0.74],
      [6.92, 0.14, 0.6],
    ], dur, 0.75 * o.gain));
  },

  wood: (o) => {
    const dur = Math.max(0.06, Math.min(0.5, o.length));
    const r = ratio(o.tune);
    // The opposite of glass: the high partials are gone almost at once, which
    // is why a wooden block is a knock rather than a ring.
    return one(dur, body(560 * r, [
      [1, 0.6, 1],
      [3.24, 0.3, 0.3],
      [6.1, 0.16, 0.12],
    ], dur, 0.95 * o.gain, 0.85));
  },

  pipe: (o) => {
    const dur = Math.max(0.2, o.length);
    const r = ratio(o.tune);
    // Odd multiples only, which is what a tube closed at one end rings at,
    // and why it sounds hollow rather than solid.
    // Air through it as well as the ringing. A struck bar has no breath; a
    // tube does, and that is most of what tells the two apart.
    return all(dur, [
      body(190 * r, [
        [1, 0.5, 1],
        [3, 0.26, 0.66],
        [5, 0.14, 0.4],
        [7, 0.07, 0.22],
      ], dur, 0.8 * o.gain, 0.7),
      noise(
        dur,
        // Loud enough and long enough to be heard as air in a tube rather
        // than as a tick at the front of a ringing bar.
        holds(0.3 * o.gain, dur * 0.08, dur * 0.6, dur),
        { type: 'bandpass', freq: flat(190 * r * 2.2), q: 0.9 },
      ),
    ]);
  },

  // ---------- plucked ----------

  string: (o) => {
    const dur = Math.max(0.15, o.length);
    return one(dur, plucked(196 * ratio(o.tune), 0.32, dur, 0.8 * o.gain));
  },

  thunk: (o) => {
    const dur = Math.max(0.06, Math.min(0.6, o.length));
    // Damped so hard it is a knock on something hollow rather than a note.
    return one(dur, plucked(88 * ratio(o.tune), 0.88, dur, 1.1 * o.gain, {}, 0.4, 0.985));
  },

  wire: (o) => {
    const dur = Math.max(0.3, o.length);
    // Far higher and far less damped than a string, so it rings for seconds
    // where a string is gone in one. A cable under tension, not an instrument.
    return one(dur, plucked(1420 * ratio(o.tune), 0.02, dur, 0.42 * o.gain, {
      filter: { type: 'highpass', freq: flat(900) },
    }, 1, 0.9999));
  },

  // ---------- clouds ----------

  rain: (o) => {
    const dur = Math.max(0.2, o.length);
    // Two sizes at once. A wash of fine drops on its own is only filtered
    // noise; the larger, rarer drops falling through it are what the ear
    // reads as rain rather than as hiss.
    return all(dur, [
      cloud(
        // Dense, because rain is a wash and not a scatter. Thinning it out to
        // separate it from static only walked it into fire, which is the one
        // voice here that really is a scatter.
        { density: 620, grain: 0.003, freq: 0, spread: 0, air: 1 },
        dur,
        holds(0.34 * o.gain, 0.05, dur * 0.85, dur),
        // What separates it from static instead: static is defined by nothing
        // moving at all, so this moves. The window it is heard through drifts
        // across the whole sound, the way rain gets heavier and lighter.
        {
          type: 'highpass',
          freq: [
            { at: 0, to: 2000 },
            { at: dur * 0.45, to: 3600, curve: 'exp' },
            { at: dur, to: 2200, curve: 'exp' },
          ],
        },
        // Gusting. Static is defined by nothing moving at all, so the surest
        // way to keep rain away from it is to keep rain moving, and rain does
        // come in waves.
        [{ rate: 0.8, depth: 0.3, target: 'gain' }],
      ),
      cloud(
        // Rare, because the larger drops are punctuation over the wash. Any
        // more of them and rain turns into crackle, which is fire.
        { density: 24, grain: 0.011, freq: 0, spread: 0, air: 1 },
        dur,
        holds(0.5 * o.gain, 0.05, dur * 0.85, dur),
        { type: 'bandpass', freq: flat(1300), q: 1.2 },
      ),
    ]);
  },

  fire: (o) => {
    const dur = Math.max(0.2, o.length);
    // Fewer and larger than rain, and low enough to have some body, which is
    // the difference between crackling and hissing.
    // A fire is a low roar with sharp cracks over it. One cloud gives only
    // one of the two, and the cracks are what say fire rather than wind.
    return all(dur, [
      noise(
        dur,
        holds(0.34 * o.gain, dur * 0.15, dur * 0.8, dur),
        { type: 'lowpass', freq: flat(420) },
      ),
      cloud(
        { density: 34, grain: 0.006, freq: 0, spread: 0, air: 1 },
        dur,
        holds(0.6 * o.gain, 0.02, dur * 0.9, dur),
        { type: 'highpass', freq: flat(1800) },
      ),
    ]);
  },

  gravel: (o) => {
    const dur = Math.max(0.15, o.length);
    // Small stones have a pitch, and a heap of them has many. Made of tonal
    // grains thrown across a wide low range rather than of noise, which is
    // what keeps it away from every other rustle in here.
    return one(dur, cloud(
      { density: 190, grain: 0.022, freq: 150 * ratio(o.tune), spread: 1.6, air: 0.35 },
      dur,
      holds(0.75 * o.gain, 0.02, dur * 0.7, dur),
      { type: 'lowpass', freq: flat(2200) },
    ));
  },

  swarm: (o) => {
    const dur = Math.max(0.25, o.length);
    const r = ratio(o.tune);
    // Pitched grains thrown across four octaves. Nothing else here is both
    // tonal and unplaceable at the same time.
    return one(dur, cloud(
      { density: 260, grain: 0.03, freq: 760 * r, spread: 2, air: 0.15 },
      dur,
      holds(0.35 * o.gain, dur * 0.2, dur * 0.7, dur),
    ));
  },

  pour: (o) => {
    const dur = Math.max(0.2, o.length);
    const r = ratio(o.tune);
    // Every grain climbs in pitch across its own length, which is the one
    // shape a bubble in water actually makes.
    return one(dur, cloud(
      { density: 55, grain: 0.035, freq: 520 * r, spread: 1.1, air: 0.05, rise: 3.4 },
      dur,
      holds(0.45 * o.gain, 0.04, dur * 0.8, dur),
    ));
  },

  // ---------- runs of hits ----------

  ratchet: (o) => {
    const dur = Math.max(0.15, o.length);
    return one(dur, run(
      // Low and woody rather than bright and ticking. A pawl running over a
      // gear is a clatter, and pitched up here it was only a fast tick.
      { rate: [{ at: 0, to: 38 }, { at: dur, to: 7 }], ring: 0.016, freq: 620, jitter: 0.1 },
      dur,
      decays(0.85 * o.gain, dur, 0.02),
      { type: 'lowpass', freq: flat(2600) },
    ));
  },

  clockwork: (o) => {
    const dur = Math.max(0.2, o.length);
    return one(dur, run(
      { rate: flat(7), ring: 0.008, freq: 1900, jitter: 0.015 },
      dur,
      holds(0.75 * o.gain, 0.005, dur * 0.95, dur),
      { type: 'highpass', freq: flat(900) },
    ));
  },

  zip: (o) => {
    const dur = Math.max(0.1, Math.min(1.2, o.length));
    return one(dur, run(
      { rate: [{ at: 0, to: 24 }, { at: dur, to: 130 }], ring: 0.004, freq: 3100, jitter: 0.12 },
      dur,
      holds(0.5 * o.gain, 0.01, dur * 0.9, dur),
      { type: 'highpass', freq: flat(1200) },
    ));
  },

  motor: (o) => {
    const dur = Math.max(0.2, o.length);
    const r = ratio(o.tune);
    // Fast enough that the hits stop being hits and become the pitch itself,
    // which is what a motor is.
    return one(dur, run(
      // Slow enough that the separate firings are still audible. Faster than
      // this and it stops being a machine and becomes a buzzing note, which
      // is a sound this palette already has several of.
      { rate: [{ at: 0, to: 13 }, { at: dur * 0.35, to: 26 }, { at: dur, to: 24 }], ring: 0.012, freq: 210 * r, jitter: 0.14 },
      dur,
      holds(0.8 * o.gain, dur * 0.12, dur * 0.85, dur),
      // Left far brighter than a rumble. Rolled off low it was a rumble with
      // a pulse in it, and this palette already has a rumble.
      { type: 'bandpass', freq: flat(520 * r), q: 0.7 },
    ));
  },

};

/** Describe one voice without playing it, for exporting and for editing. */
export function designSpec(name: DesignName, options: DesignOptions): VoiceSpec {
  return DESIGN_SPECS[name](options);
}

/** Play one design voice at an absolute context time. */
export function playDesign(
  ctx: BaseAudioContext,
  dest: AudioNode,
  name: DesignName,
  t: number,
  options: DesignOptions,
): void {
  const build = DESIGN_SPECS[name];
  if (build) renderVoice(ctx, dest, build(options), t, options.seed);
}
