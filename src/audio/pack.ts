import type {
  Curve,
  EffectSpec,
  LayerSpec,
  Point,
  SourceSpec,
  VoiceOptions,
  VoiceSpec,
} from './voice-spec.ts';
import { ratio } from './voice-spec.ts';

/**
 * Reading a sound pack written for `@web-kits/audio`.
 *
 * That format describes a sound as plain data, the same way Beat Studio does
 * now, so a pack written for it can be read straight into the palette and
 * played by the same code that plays everything else. Nothing is fetched and
 * nothing is decoded: a pack is a small text file describing how to make the
 * sounds, not the sounds themselves.
 *
 * The conversion follows that project's own engine rather than the written
 * format, because the format says what the fields are and the engine decides
 * what they do. Where they differ the engine wins, since that is what the
 * pack was made against. `tools/pack-check.html` renders every sound both
 * ways and compares them.
 *
 * Format: https://audio.raphaelsalaja.com/schemas/patch.schema.json
 */

/**
 * The packs currently loaded, by id.
 *
 * A table of what can be played, the same way DESIGN_SPECS is one. Keeping it
 * here rather than in the store is what lets a placed sound be turned into
 * sound without anything in audio/ needing to know the app exists.
 */
const loaded = new Map<string, Map<string, VoiceSpec>>();

/** Make a pack's sounds playable. Loading one over another replaces it. */
export function registerPack(pack: Pack): void {
  loaded.set(pack.id, new Map(pack.sounds.map((sound) => [sound.name, sound.spec])));
}

export function unregisterPack(id: string): void {
  loaded.delete(id);
}

/** What a placed pack sound is made of, or null if that pack is not loaded. */
export function packSpec(packId: string, name: string): VoiceSpec | null {
  return loaded.get(packId)?.get(name) ?? null;
}

/** The level a sound eases towards rather than reaching, in that engine. */
const SILENCE = 0.0001;
/** How long a source runs on after its envelope, in that engine. */
const OVERRUN = 0.1;
/** What a layer plays at when it does not say. */
const DEFAULT_GAIN = 0.5;
/** What a sound does when it has no envelope at all. */
const NO_ENVELOPE = { seconds: 0.5, tc: 0.15 };

export interface PackSound {
  name: string;
  spec: VoiceSpec;
}

export interface Pack {
  /** Unique within a session, and what a placed sound refers to. */
  id: string;
  name: string;
  author?: string;
  version?: string;
  description?: string;
  sounds: PackSound[];
  /** Anything in the file this app cannot make, so it can be reported. */
  skipped: string[];
  /**
   * The file as it arrived.
   *
   * Kept so a session can carry its packs with it. A session that named its
   * packs and left it there would open somewhere else with sounds on the
   * timeline that nothing could play.
   */
  file: unknown;
}

/**
 * Read a pack file.
 *
 * Everything is checked, because the file came off disk and was written by
 * someone else. A sound that cannot be made is left out and named in
 * `skipped` rather than added as something that would play nothing.
 */
export function readPack(raw: unknown, id: string): Pack | null {
  if (!raw || typeof raw !== 'object') return null;
  const file = raw as Record<string, unknown>;
  if (typeof file.name !== 'string' || !file.name) return null;
  if (!file.sounds || typeof file.sounds !== 'object') return null;

  const sounds: PackSound[] = [];
  const skipped: string[] = [];

  for (const [name, definition] of Object.entries(file.sounds as Record<string, unknown>)) {
    const result = toSpec(definition);
    if (result.spec) sounds.push({ name, spec: result.spec });
    else skipped.push(`${name}: ${result.why}`);
  }

  if (!sounds.length) return null;

  return {
    id,
    name: file.name,
    ...(typeof file.author === 'string' ? { author: file.author } : {}),
    ...(typeof file.version === 'string' ? { version: file.version } : {}),
    ...(typeof file.description === 'string' ? { description: file.description } : {}),
    sounds,
    skipped,
    file: raw,
  };
}

/** One sound from a pack, as something this app can play. */
export function toSpec(raw: unknown): { spec: VoiceSpec | null; why: string } {
  if (!raw || typeof raw !== 'object') return { spec: null, why: 'not a sound' };
  const definition = raw as Record<string, unknown>;

  const source = Array.isArray(definition.layers) ? definition.layers : [definition];
  const layers: LayerSpec[] = [];
  for (const entry of source) {
    const layer = toLayer(entry);
    if (layer) layers.push(layer);
  }
  if (!layers.length) return { spec: null, why: 'nothing in it this app can make' };

  const effects = toEffects(definition.effects);
  return {
    spec: {
      duration: layers.reduce((longest, layer) => Math.max(longest, layer.length), 0),
      layers,
      ...(effects.length ? { effects } : {}),
    },
    why: '',
  };
}

function toLayer(raw: unknown): LayerSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const layer = raw as Record<string, unknown>;

  const envelope = (layer.envelope ?? null) as Record<string, number> | null;
  const attack = number(envelope?.attack, 0);
  const decay = number(envelope?.decay, 0);
  const release = number(envelope?.release, 0);
  const sustain = number(envelope?.sustain, 0);
  const gain = number(layer.gain, DEFAULT_GAIN);

  // The length of a sound is its envelope. Nothing else decides it, and a
  // sound with no envelope is given a short fade, as that engine does.
  const duration = envelope ? attack + decay + release : NO_ENVELOPE.seconds;

  const source = toSource(layer.source, duration);
  if (!source) return null;

  const filter = toFilter(layer.filter);
  const effects = toEffects(layer.effects);

  return {
    source,
    ...(filter ? { filter } : {}),
    gain: toEnvelope(envelope, gain, attack, decay, sustain, release),
    // A source runs on past its envelope, and the noise it is made from has
    // to be long enough to cover that, so the two are one number here.
    length: duration + OVERRUN,
    overrun: 0,
    ...(number(layer.delay, 0) > 0 ? { delay: number(layer.delay, 0) } : {}),
    ...(effects.length ? { effects } : {}),
  };
}

/**
 * An attack, decay, sustain and release, as a curve.
 *
 * Written to match what that engine actually schedules rather than what the
 * names suggest. It eases towards each stage rather than arriving at it, over
 * a third of the time given, and a sound with no sustain simply eases towards
 * silence from the end of its attack.
 */
function toEnvelope(
  envelope: Record<string, number> | null,
  gain: number,
  attack: number,
  decay: number,
  sustain: number,
  release: number,
): Curve {
  if (!envelope) {
    return [
      { at: 0, to: gain },
      { at: 0, to: SILENCE, curve: 'target', tc: NO_ENVELOPE.tc },
    ];
  }

  const points: Point[] = [{ at: 0, to: SILENCE }];
  if (attack > 0) points.push({ at: attack, to: gain, curve: 'linear' });
  else points.push({ at: 0, to: gain, curve: 'set' });

  if (sustain > 0) {
    points.push({
      at: attack,
      to: Math.max(sustain * gain, SILENCE),
      curve: 'target',
      tc: decay / 3,
    });
    if (release > 0) {
      points.push({ at: attack + decay, to: SILENCE, curve: 'target', tc: release / 3 });
    }
  } else {
    points.push({ at: attack, to: SILENCE, curve: 'target', tc: decay / 3 });
  }
  return points;
}

function toSource(raw: unknown, duration: number): SourceSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const type = source.type;

  if (type === 'noise') {
    const color = source.color;
    return {
      kind: 'noise',
      color: color === 'pink' || color === 'brown' ? color : 'white',
    };
  }

  if (type === 'sine' || type === 'triangle' || type === 'square' || type === 'sawtooth') {
    const fm = source.fm as { ratio?: unknown; depth?: unknown } | undefined;
    return {
      kind: 'osc',
      type,
      freq: toFrequency(source.frequency, duration),
      ...(number(source.detune, 0) !== 0 ? { detune: number(source.detune, 0) } : {}),
      ...(fm && typeof fm === 'object'
        ? { fm: { ratio: number(fm.ratio, 1), depth: number(fm.depth, 0) } }
        : {}),
    };
  }

  // Samples, streams and wavetables are not made here. None of the packs
  // published so far use them, and a sound that fetches a file is a different
  // kind of thing from one that describes itself.
  return null;
}

function toFrequency(raw: unknown, duration: number): Curve {
  if (typeof raw === 'number' && Number.isFinite(raw)) return [{ at: 0, to: raw }];
  if (raw && typeof raw === 'object') {
    const sweep = raw as { start?: unknown; end?: unknown };
    const start = number(sweep.start, 440);
    const end = number(sweep.end, start);
    return [
      { at: 0, to: start },
      { at: duration, to: Math.max(end, 1), curve: 'exp' },
    ];
  }
  return [{ at: 0, to: 440 }];
}

function toFilter(raw: unknown): LayerSpec['filter'] {
  // Only ever one in practice, and the first is the one an LFO would reach.
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first || typeof first !== 'object') return undefined;
  const filter = first as Record<string, unknown>;

  const type = filter.type;
  const allowed: BiquadFilterType[] = [
    'lowpass', 'highpass', 'bandpass', 'notch', 'allpass', 'peaking', 'lowshelf', 'highshelf',
  ];
  if (typeof type !== 'string' || !allowed.includes(type as BiquadFilterType)) return undefined;

  const base = number(filter.frequency, 1000);
  const envelope = filter.envelope as Record<string, number> | undefined;

  let freq: Curve = [{ at: 0, to: base }];
  if (envelope && typeof envelope === 'object') {
    const attack = number(envelope.attack, 0);
    const decay = number(envelope.decay, 0);
    freq = [
      { at: 0, to: base },
      { at: attack, to: number(envelope.peak, base), curve: 'linear' },
      // It always comes back to where it started, however far it went.
      { at: attack + decay, to: Math.max(base, 1), curve: 'exp' },
    ];
  }

  return { type: type as BiquadFilterType, freq, q: number(filter.resonance, 1) };
}

/** Only a room, for now. Everything else in a pack is left off and named. */
function toEffects(raw: unknown): EffectSpec[] {
  if (!Array.isArray(raw)) return [];
  const effects: EffectSpec[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const effect = entry as Record<string, unknown>;
    if (effect.type !== 'reverb') continue;
    effects.push({
      kind: 'reverb',
      decay: number(effect.decay, 0.5),
      mix: Math.max(0, Math.min(1, number(effect.mix, 0.3))),
      ...(number(effect.preDelay, 0) > 0 ? { preDelay: number(effect.preDelay, 0) } : {}),
      ...(number(effect.damping, 0) > 0 ? { damping: number(effect.damping, 0) } : {}),
      ...(number(effect.roomSize, 1) !== 1 ? { roomSize: number(effect.roomSize, 1) } : {}),
    });
  }
  return effects;
}

/** A room stretches with the sound it is around. Saturation does not. */
const stretchEffect = (stretch: number) => (effect: EffectSpec): EffectSpec =>
  effect.kind === 'reverb' ? { ...effect, decay: effect.decay * stretch } : effect;

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Fit a pack sound to what is being asked of it.
 *
 * A pack sound arrives at one length, pitch and level, where a placed sound
 * needs all three. Stretching moves every time in the description together,
 * so the shape is kept and only the scale changes, and tuning multiplies
 * every frequency rather than detuning, so a sweep stays a sweep.
 */
export function shapeSpec(base: VoiceSpec, options: VoiceOptions): VoiceSpec {
  const stretch = base.duration > 0 ? Math.max(0.02, options.length) / base.duration : 1;
  const pitch = ratio(options.tune);

  const times = (curve: Curve): Curve =>
    curve.map((point) => ({
      ...point,
      at: point.at * stretch,
      ...(point.tc !== undefined ? { tc: point.tc * stretch } : {}),
    }));

  return {
    ...base,
    duration: base.duration * stretch,
    layers: base.layers.map((layer) => ({
      ...layer,
      source:
        layer.source.kind === 'osc'
          ? {
              ...layer.source,
              freq: layer.source.freq.map((point) => ({ ...point, to: point.to * pitch })),
            }
          : layer.source,
      ...(layer.filter
        ? {
            filter: {
              ...layer.filter,
              freq: layer.filter.freq.map((point) => ({
                ...point,
                at: point.at * stretch,
                to: point.to * pitch,
              })),
            },
          }
        : {}),
      gain: times(layer.gain).map((point) =>
        // The floor an exponential eases towards is a level, not a shape, so
        // it is left where it is while everything above it is scaled.
        point.to <= SILENCE ? point : { ...point, to: point.to * options.gain },
      ),
      length: layer.length * stretch,
      ...(layer.delay ? { delay: layer.delay * stretch } : {}),
      ...(layer.effects ? { effects: layer.effects.map(stretchEffect(stretch)) } : {}),
    })),
    ...(base.effects ? { effects: base.effects.map(stretchEffect(stretch)) } : {}),
  };
}
