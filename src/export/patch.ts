import { KIT_SOUNDS } from '../constants.ts';
import { DESIGN_SPECS } from '../audio/design-voices.ts';
import { KIT_SPECS } from '../audio/voices.ts';
import { DESIGN_DEFAULT_LENGTH, DESIGN_NAMES } from '../timeline/types.ts';
import type { Curve, LayerSpec, VoiceSpec } from '../audio/voice-spec.ts';

/**
 * The palette, written out as a `@web-kits/audio` patch.
 *
 * Beat Studio's voices are descriptions already, so this is a conversion
 * rather than a second copy of them: nothing here decides what a voice is,
 * it only says the same thing in someone else's words. Add a voice and it
 * appears in the file without anyone editing this.
 *
 * The file it writes is a patch, which is that project's unit of exchange. It
 * can be committed to a repository and installed by anyone with
 * `npx @web-kits/audio add <owner>/<repo>`, played in any page, or read to
 * see how a sound is put together.
 *
 * Format: https://audio.raphaelsalaja.com/schemas/patch.schema.json
 */

const SCHEMA = 'https://audio.raphaelsalaja.com/schemas/patch.schema.json';

/** Bump when a voice changes, so an installed copy can be told apart. */
const PATCH_VERSION = '1.0.0';

// ---------- the shape of a patch ----------
// Only the parts of the format this file writes. The published schema is the
// authority; these types are here so the compiler checks what is written.

type PatchFrequency = number | { start: number; end: number };

interface PatchSource {
  type: 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise';
  frequency?: PatchFrequency;
  detune?: number;
  color?: 'white';
}

interface PatchFilter {
  type: BiquadFilterType;
  frequency: number;
  resonance?: number;
  envelope?: { attack?: number; peak: number; decay: number };
}

interface PatchEnvelope {
  attack?: number;
  decay: number;
  sustain?: number;
  release?: number;
}

interface PatchLayer {
  source: PatchSource;
  filter?: PatchFilter;
  envelope?: PatchEnvelope;
  gain?: number;
  delay?: number;
  lfo?: { type: 'sine'; frequency: number; depth: number; target: 'gain' | 'filter.frequency' };
}

type PatchSound = PatchLayer | { layers: PatchLayer[] };

export interface Patch {
  $schema: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  sounds: Record<string, PatchSound>;
}

// A patch is read by people as well as by machines, and 1399.9999999999998
// helps nobody.
const hz = (value: number): number => Math.round(value * 100) / 100;
const secs = (value: number): number => Math.round(value * 10000) / 10000;
const level = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * How closely each voice survives the conversion, and what is lost.
 *
 * Measured rather than guessed at: every sound here was rendered by the
 * published `@web-kits/audio` engine and compared against Beat Studio's own
 * rendering of the same voice. `tools/README.md` says how to run it again.
 *
 * Across all 37 the middle score is 0.987 and levels land within a tenth.
 * Everything that comes out under 0.93 is listed here with the reason,
 * because a number on its own does not tell you what to expect. `reverse` is
 * listed in spite of scoring well, because what it does there is not what it
 * does here: a buffer read backwards has no expression in that format at all,
 * so it is rewritten rather than approximated, and somebody ought to know
 * that whatever the score says.
 *
 * Two limits account for nearly all of it. That format has no way to say a
 * level that rises exponentially, only one that rises in a straight line,
 * which is what every lead in here is built on and why those also read
 * louder. And a cutoff that sweeps one way has to snap back at the end
 * rather than stay where it arrived.
 */
export const APPROXIMATE: Record<string, { match: number; why: string }> = {
  pop: {
    match: 0.681,
    why: 'the pitch reaches its note a quarter of the way in. There it climbs across the whole sound.',
  },
  zap: {
    match: 0.779,
    why: 'the cutoff rides the pitch down and stays there. There it springs back at the end.',
  },
  glitch: {
    match: 0.814,
    why: 'the bursts fall at random every time it plays. One arrangement is written down.',
  },
  wobble: {
    match: 0.829,
    why: 'the swing under the tone is deeper here than the same numbers give there.',
  },
  swipe: {
    match: 0.836,
    why: 'it grows in exponentially. A straight line is the only rise that format has, and it holds more level.',
  },
  rumble: {
    match: 0.84,
    why: 'the slow swell on top of the hold does not carry across the same way.',
  },
  swell: { match: 0.891, why: 'grows in exponentially, as the swipe does.' },
  whoosh: { match: 0.896, why: 'grows in exponentially, and its cutoff comes back down at the end.' },
  riser: { match: 0.924, why: 'grows in exponentially, as the swipe does.' },
  clank: { match: 0.926, why: 'the strike on top of the partials lands slightly differently.' },
  reverse: {
    match: 0.973,
    why:
      'built from a buffer read backwards, which that format cannot describe at ' +
      'all. Rewritten as noise and a tone that grow out of nothing and stop, ' +
      'which is the same shape by another route, and it measures closer than ' +
      'most of the ones above.',
  },
};

/** Frequency over time, as far as the format can say it. */
function toFrequency(curve: Curve): PatchFrequency {
  if (curve.length === 1) return hz(curve[0].to);
  return { start: hz(curve[0].to), end: hz(curve[curve.length - 1].to) };
}

/**
 * A cutoff that moves.
 *
 * The format gives a base, a peak reached over an attack, and a return to the
 * base over a decay. A sweep that only goes one way has no return, so its
 * decay is zero and the snap back lands where the sound has already ended.
 */
function toFilter(filter: NonNullable<LayerSpec['filter']>): PatchFilter {
  const out: PatchFilter = { type: filter.type, frequency: hz(filter.freq[0].to) };
  if (filter.q !== undefined) out.resonance = level(filter.q);

  if (filter.freq.length > 1) {
    const top = filter.freq[1];
    const last = filter.freq[filter.freq.length - 1];
    out.envelope = {
      ...(top.at ? { attack: secs(top.at) } : {}),
      peak: hz(top.to),
      decay: secs(Math.max(0, last.at - top.at)),
    };
  }
  return out;
}

/**
 * A level curve, as an attack, decay, sustain and release.
 *
 * The loudest point is the peak, and how long it takes to get there is the
 * attack. A point that sits at the peak rather than passing through it means
 * the sound holds, which is a sustain and then a release. Everything else
 * falls away from the peak, which is a decay.
 */
function toEnvelope(curve: Curve, length: number): { envelope: PatchEnvelope; gain: number } {
  let peak = 0;
  for (let i = 1; i < curve.length; i++) if (curve[i].to > curve[peak].to) peak = i;

  const gain = curve[peak].to;
  const attack = curve[peak].at;
  const ends = curve[curve.length - 1].at || length;

  let hold = peak;
  for (let i = peak + 1; i < curve.length; i++) {
    if (Math.abs(curve[i].to - gain) > 1e-9) break;
    hold = i;
  }

  if (hold > peak) {
    return {
      gain,
      envelope: {
        ...(attack ? { attack: secs(attack) } : {}),
        decay: secs(curve[hold].at - attack),
        sustain: 1,
        release: secs(Math.max(0, ends - curve[hold].at)),
      },
    };
  }

  // A fall, split evenly between their decay and their release.
  //
  // Their engine does not ramp to a floor the way this one does. It eases
  // towards silence with a time constant of a third of the decay, and then
  // eases again through the release, so a single decay leaves the sound still
  // ringing at a twentieth of its level when it should be finished. Two
  // phases of equal length fall about as fast as one exponential ramp here
  // does, and the total stays the same, which matters because the total is
  // also what their pitch and cutoff sweeps are measured against.
  const span = Math.max(0.001, ends - attack);
  return {
    gain,
    envelope: {
      ...(attack ? { attack: secs(attack) } : {}),
      decay: secs(span / 2),
      sustain: 0.001,
      release: secs(span / 2),
    },
  };
}

/** One layer, converted. A reversed buffer is handled by its caller. */
function toLayer(layer: LayerSpec): PatchLayer[] {
  const { envelope, gain } = toEnvelope(layer.gain, layer.length);
  const shared = {
    ...(layer.filter ? { filter: toFilter(layer.filter) } : {}),
    envelope,
    gain: level(gain),
    ...(layer.delay ? { delay: secs(layer.delay) } : {}),
    ...(layer.lfo?.length
      ? {
          lfo: {
            type: 'sine' as const,
            frequency: level(layer.lfo[0].rate),
            depth: level(layer.lfo[0].depth),
            target: layer.lfo[0].target === 'gain' ? ('gain' as const) : ('filter.frequency' as const),
          },
        }
      : {}),
  };

  if (layer.source.kind === 'osc') {
    return [
      {
        source: {
          type: layer.source.type as PatchSource['type'],
          frequency: toFrequency(layer.source.freq),
          ...(layer.source.detune ? { detune: layer.source.detune } : {}),
        },
        ...shared,
      },
    ];
  }

  if (layer.source.kind === 'noise') {
    return [{ source: { type: 'noise', color: 'white' }, ...shared }];
  }

  // A struck body is already a stack of decaying sines, and the format has
  // sines and envelopes, so this one converts exactly rather than nearly.
  if (layer.source.kind === 'modal') {
    const { freq, partials } = layer.source;
    return partials.map((partial) => ({
      source: { type: 'sine' as const, frequency: hz(freq * partial.ratio) },
      envelope: { attack: 0.001, decay: secs(partial.decay) },
      gain: level(gain * partial.gain),
    }));
  }

  // The next three have no equivalent at all: the format has no way to say
  // "run this round itself", "scatter these" or "repeat this getting faster".
  // Each is rebuilt from what is there, and what that costs is recorded in
  // APPROXIMATE above rather than left for someone to discover.
  if (layer.source.kind === 'pluck') {
    return [
      {
        source: { type: 'sawtooth' as const, frequency: hz(layer.source.freq) },
        ...shared,
      },
    ];
  }

  if (layer.source.kind === 'grains') {
    const { freq } = layer.source;
    return freq > 0
      ? [{ source: { type: 'sine' as const, frequency: hz(freq) }, ...shared }]
      : [{ source: { type: 'noise' as const, color: 'white' as const }, ...shared }];
  }

  if (layer.source.kind === 'impulses') {
    return [{ source: { type: 'sine' as const, frequency: hz(layer.source.freq) }, ...shared }];
  }

  /*
   * A recording cannot go into a patch at all, so it does not pretend to.
   *
   * The format describes a sound as a graph of standard parts. There is no
   * part that means "this file", and writing the nearest synthesised thing
   * would hand somebody a patch that plays a sound they never chose. Left out
   * with a name, which is what the palette export reports at the end.
   */
  if (layer.source.kind === 'sample') return [];

  // A buffer read backwards has no equivalent, so it is rebuilt out of what
  // the format does have: noise and a tone, both growing out of nothing over
  // the whole length and stopping rather than fading.
  const rise: PatchEnvelope = { attack: secs(layer.length), decay: 0.005 };
  return [
    { source: { type: 'noise', color: 'white' }, envelope: rise, gain: level(gain * layer.source.air) },
    {
      source: { type: 'sine', frequency: hz(layer.source.freq) },
      envelope: rise,
      gain: level(gain * (1 - layer.source.air)),
    },
  ];
}

/** One voice, converted. */
export function toPatchSound(spec: VoiceSpec): PatchSound {
  const layers = spec.layers.flatMap(toLayer);
  return layers.length === 1 ? layers[0] : { layers };
}

/** Turn a readable label into a name a patch can key on. */
function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * One arrangement of the voices that draw from noise, so the file is the same
 * file every time it is written.
 *
 * `glitch` scatters its bursts at random, which is right when it is played
 * and wrong when it is written down: without this, exporting the palette
 * twice gave two different files, and anybody keeping one under version
 * control got a diff for having pressed the button. The number itself means
 * nothing beyond being fixed.
 */
const WRITTEN = 0x9e3779b9;

/**
 * Every voice in the palette, at the length and pitch it is offered at.
 *
 * Length and pitch are the starting points rather than the whole story: a
 * consumer changes pitch with `detune` when playing, the same way placing a
 * sound here does.
 */
export function buildPatch(): Patch {
  const sounds: Record<string, PatchSound> = {};

  for (const name of DESIGN_NAMES) {
    sounds[name] = toPatchSound(
      DESIGN_SPECS[name]({ length: DESIGN_DEFAULT_LENGTH[name], tune: 0, gain: 1, seed: WRITTEN }),
    );
  }

  for (const { pad, label } of KIT_SOUNDS) {
    sounds[slug(label)] = toPatchSound(KIT_SPECS[pad](1));
  }

  return {
    $schema: SCHEMA,
    name: 'Beat Studio',
    version: PATCH_VERSION,
    description:
      'Sound design voices for motion graphics, from Beat Studio. Impacts and ' +
      'whooshes to land a hit and carry a move, risers and reverse swells to ' +
      'lead into one, low end to sit underneath, detail and texture on top, ' +
      'and a full synthesised drum kit. Every one is built from a different ' +
      'method rather than from one method with the numbers changed, so they ' +
      'stay apart from each other however they are tuned or stretched.',
    tags: ['sound-design', 'motion-graphics', 'impacts', 'whooshes', 'risers', 'drums', 'ui'],
    sounds,
  };
}

/** The patch as the text that goes in the file. */
export function patchJson(): string {
  return `${JSON.stringify(buildPatch(), null, 2)}\n`;
}
