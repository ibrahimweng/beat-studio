import type { DesignName } from '../timeline/types.ts';
import {
  flat,
  ratio,
  renderVoice,
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
    const layers: LayerSpec[] = [];
    for (let i = 0; i < bursts; i++) {
      // Uneven on purpose. Evenly spaced bursts read as a rhythm.
      const delay = (i / bursts) * dur + Math.random() * (dur / bursts) * 0.7;
      const life = 0.006 + Math.random() * 0.03;
      layers.push({
        ...noise(life, decays((0.25 + Math.random() * 0.35) * o.gain, life), {
          type: 'bandpass',
          freq: flat((600 + Math.random() * 5200) * r),
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
  if (build) renderVoice(ctx, dest, build(options), t);
}
