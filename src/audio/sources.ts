import { cueGain, cueLength, cueStart } from '../timeline/project.ts';
import type { Cue, DesignName, Project } from '../timeline/types.ts';
import type { PadName } from '../types.ts';
import { playDesign } from './design-voices.ts';
import { drum, pianoSynth, pluck } from './voices.ts';

/**
 * Play whatever a cue points at.
 *
 * One place decides how a cue turns into sound, so live playback, auditioning
 * and the exported file cannot disagree about what a cue means.
 */
export function playCue(
  ctx: BaseAudioContext,
  dest: AudioNode,
  cue: Cue,
  at: number,
  gain: number,
): void {
  const { source } = cue;

  if (source.kind === 'design') {
    playDesign(ctx, dest, source.name as DesignName, at, {
      length: cueLength(cue),
      tune: cue.tune,
      gain,
    });
    return;
  }

  if (source.kind === 'kit') {
    // Kit voices have fixed shapes, so tune is applied as level only.
    drum(ctx, dest, source.name as PadName, at, gain);
    return;
  }

  const midi = (source.midi ?? 60) + cue.tune;
  if (source.name === 'guitar') pluck(ctx, dest, midi, at, gain);
  else pianoSynth(ctx, dest, midi, at, gain);
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
