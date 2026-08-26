import { cueGain, cueLength, cueStart } from '../timeline/project.ts';
import type { Cue, DesignName, Project } from '../timeline/types.ts';
import type { PadName } from '../types.ts';
import { designSpec } from './design-voices.ts';
import { packSpec, shapeSpec } from './pack.ts';
import { renderVoice, seedFrom, type EffectSpec, type VoiceSpec } from './voice-spec.ts';
import { guitarSpec, kitSpec, pianoSpec } from './voices.ts';

/**
 * What a cue is made of, at a given level.
 *
 * One place decides what a placed sound means, so live playback, auditioning,
 * the exported file and saving a sound of your own cannot disagree about it.
 * Every kind of source ends up as the same kind of description here, which is
 * what lets the room and the push reach all of them without any of them
 * knowing about it.
 */
export function specForCue(cue: Cue, gain: number): VoiceSpec | null {
  const { source } = cue;
  const options = { length: cueLength(cue), tune: cue.tune, gain };

  let spec: VoiceSpec | null;
  if (source.kind === 'design') {
    spec = designSpec(source.name as DesignName, options);
  } else if (source.kind === 'kit') {
    // Kit voices have fixed shapes, so tune is applied as level only.
    spec = kitSpec(source.name as PadName, gain);
  } else if (source.kind === 'pack') {
    // A pack sound arrives at one length, pitch and level. Fitting it to what
    // was asked for keeps the shape and changes only the scale, so the three
    // controls mean the same thing as they do for the voices built in here.
    const base = source.pack ? packSpec(source.pack, source.name) : null;
    spec = base ? shapeSpec(base, options) : null;
  } else {
    const midi = (source.midi ?? 60) + cue.tune;
    spec = source.name === 'guitar' ? guitarSpec(midi, gain) : pianoSpec(midi, gain);
  }
  if (!spec) return null;

  // The room and the push belong to the placed sound rather than to the
  // voice, so they go after whatever the voice brought with it.
  const effects = cueEffects(cue);
  return effects.length ? { ...spec, effects: [...(spec.effects ?? []), ...effects] } : spec;
}

/**
 * The room and the push a placed sound asks for.
 *
 * Pushed first and then put in a room, which is the order these happen in
 * anywhere else: saturating a room's tail sounds like a fault, while putting
 * a saturated sound in a room sounds like a sound in a room.
 */
function cueEffects(cue: Cue): EffectSpec[] {
  const effects: EffectSpec[] = [];
  if (cue.drive > 0) effects.push({ kind: 'drive', amount: cue.drive });
  if (cue.space > 0) {
    effects.push({
      kind: 'reverb',
      // A bigger setting is a bigger room as well as more of it, since a long
      // tail at a low level is a hall heard from outside rather than a space
      // the sound is in.
      decay: 0.4 + cue.space * 2.2,
      // Added to the sound rather than blended with it, so turning this up
      // puts the hit in a room instead of trading the hit away for one.
      dry: 1,
      mix: cue.space * 0.45,
      // A real room answers after the sound, not at the same instant as it.
      // Without this the first sample of the room lands on the transient and
      // colours it, at a polarity that is different every time, so the same
      // hit could come out fractionally softer or harder for no reason you
      // could see. A bigger room is heard from further away, so it waits
      // slightly longer.
      preDelay: 0.012 + cue.space * 0.02,
      damping: 0.35,
    });
  }
  return effects;
}

/** Play whatever a cue points at. */
export function playCue(
  ctx: BaseAudioContext,
  dest: AudioNode,
  cue: Cue,
  at: number,
  gain: number,
): void {
  const spec = specForCue(cue, gain);
  // A placed sound is one sound, not a new one each time it is heard. Drawing
  // its noise from its own id means auditioning it, playing the timeline and
  // exporting all produce the same thing, and that a set of stems adds up to
  // the mixed file exactly rather than nearly.
  if (spec) renderVoice(ctx, dest, spec, at, seedFrom(cue.id));
}

/** Schedule a cue against a timeline whose zero sits at `originTime`. */
export function scheduleCue(
  ctx: BaseAudioContext,
  dest: AudioNode,
  project: Project,
  cue: Cue,
  originTime: number,
): void {
  playCue(ctx, dest, cue, originTime + cueStart(cue), cueGain(project, cue));
}
