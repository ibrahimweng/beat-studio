import { cueGain, cueLength, cueStart } from '../timeline/project.ts';
import type { Cue, DesignName, Project } from '../timeline/types.ts';
import type { PadName } from '../types.ts';
import { playDesign } from './design-voices.ts';
import { packSpec, shapeSpec } from './pack.ts';
import { effectChain, renderVoice, seedFrom, type EffectSpec } from './voice-spec.ts';
import { drum, pianoSynth, pluck } from './voices.ts';

/**
 * Play whatever a cue points at.
 *
 * One place decides how a cue turns into sound, so live playback, auditioning
 * and the exported file cannot disagree about what a cue means.
 */
export function playCue(
  ctx: BaseAudioContext,
  out: AudioNode,
  cue: Cue,
  at: number,
  outputGain: number,
): void {
  const { source } = cue;

  // A placed sound is one sound, not a new one each time it is heard. Drawing
  // its noise from its own id means auditioning it, playing the timeline and
  // exporting all produce the same thing, and that a set of stems adds up to
  // the mixed file exactly rather than nearly.
  const seed = seedFrom(cue.id);

  // The room and the push belong to the placed sound rather than to the voice,
  // so they are put in front of whatever is about to play. That is what lets
  // the same two controls reach a design voice, a drum, a pack sound and a
  // piano note, none of which are built the same way underneath.
  const dest = effectChain(ctx, cueEffects(cue), out, seed);
  const gain = outputGain;

  if (source.kind === 'pack') {
    // A pack sound arrives at one length, pitch and level. Fitting it to what
    // was asked for keeps the shape and changes only the scale, so the three
    // controls mean the same thing as they do for the voices built in here.
    const base = source.pack ? packSpec(source.pack, source.name) : null;
    if (base) {
      renderVoice(
        ctx,
        dest,
        shapeSpec(base, { length: cueLength(cue), tune: cue.tune, gain }),
        at,
        seed,
      );
    }
    return;
  }

  if (source.kind === 'design') {
    playDesign(ctx, dest, source.name as DesignName, at, {
      length: cueLength(cue),
      tune: cue.tune,
      gain,
      seed,
    });
    return;
  }

  if (source.kind === 'kit') {
    // Kit voices have fixed shapes, so tune is applied as level only.
    drum(ctx, dest, source.name as PadName, at, gain, seed);
    return;
  }

  const midi = (source.midi ?? 60) + cue.tune;
  if (source.name === 'guitar') pluck(ctx, dest, midi, at, gain);
  else pianoSynth(ctx, dest, midi, at, gain);
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
      damping: 0.35,
    });
  }
  return effects;
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
