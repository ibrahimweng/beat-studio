/**
 * The timeline as a MIDI file, for whoever picks this up next.
 *
 * A sound design pass is often handed to somebody who then scores it, and what
 * they want first is not the audio. It is where everything lands: the cuts,
 * the hits, the build, the moment that has to be felt. A marker list says that
 * in a spreadsheet. This says it in the one file a music program will open on
 * its own timeline, in sync, with every sound already on a row of its own.
 *
 * Nothing here is a musical transcription. The forty design voices are not
 * notes and have no pitch worth writing down. What each one gets is a row,
 * chosen once and kept, so a piano roll reads as the piece's structure: every
 * impact on one line, every whoosh on the line under it.
 *
 * The drum kit is the exception, and it is written as real General MIDI
 * percussion on the channel the standard reserves for it. A kick placed here
 * opens as a kick anywhere.
 */
import { PAD_MIDI } from '../constants.ts';
import type { PadName } from '../types.ts';
import type { NoteEvent } from '../types.ts';
import { cueLength, cueStart, sortCues } from '../timeline/project.ts';
import { DESIGN_NAMES } from '../timeline/types.ts';
import type { Cue, CueSource, DesignName, Project } from '../timeline/types.ts';
import { encodeMidi } from './midi.ts';

/**
 * The channels, following General MIDI where it has an opinion.
 *
 * Nine is percussion by the standard, so the kit lands on it and plays as a
 * kit in anything. The rest are ours: separate channels rather than one,
 * because the first thing anybody does with this file is mute a row to hear
 * what is underneath.
 */
const CHANNEL = {
  piano: 0,
  guitar: 1,
  design: 2,
  recorded: 3,
  kit: 9,
} as const;

/**
 * Where the design voices start on the keyboard.
 *
 * Low C. Forty voices from here reach the top of a piano's range and no
 * further, so every one of them has a row and none of them lands somewhere a
 * piano roll will not draw.
 */
const DESIGN_BASE = 36;

/** The same for recordings and pack sounds, above the design voices. */
const RECORDED_BASE = 24;

/** A row for each design voice, worked out once and never reordered. */
const DESIGN_ROW = new Map<DesignName, number>(
  DESIGN_NAMES.map((name, i) => [name, DESIGN_BASE + i]),
);

/**
 * Which note and channel a sound is written as.
 *
 * Returns null for nothing: every sound on the timeline is somewhere in the
 * file, because a handover that quietly leaves things out is worse than no
 * handover.
 */
export function noteFor(
  source: CueSource,
  /** Rows already handed out to recordings, so each keeps the same one. */
  recorded: Map<string, number>,
): { midi: number; ch: number } {
  if (source.kind === 'kit') {
    return { midi: PAD_MIDI[source.name as PadName] ?? PAD_MIDI.kick, ch: CHANNEL.kit };
  }

  if (source.kind === 'pitched') {
    return {
      midi: source.midi ?? 60,
      ch: source.name === 'guitar' ? CHANNEL.guitar : CHANNEL.piano,
    };
  }

  if (source.kind === 'design') {
    return { midi: DESIGN_ROW.get(source.name as DesignName) ?? DESIGN_BASE, ch: CHANNEL.design };
  }

  // A recording or a pack sound has no pitch of its own, so it is given a row
  // and keeps it. Held by name rather than counted, so the same sound is the
  // same row wherever it appears in the piece.
  const key = `${source.pack ?? ''}:${source.name}`;
  let row = recorded.get(key);
  if (row === undefined) {
    row = RECORDED_BASE + (recorded.size % 12);
    recorded.set(key, row);
  }
  return { midi: row, ch: CHANNEL.recorded };
}

/** Every sound on the timeline, as notes. */
export function cueNotes(project: Project): NoteEvent[] {
  const recorded = new Map<string, number>();
  const notes: NoteEvent[] = [];

  for (const cue of sortCues(project.cues)) {
    // A muted sound is one somebody is comparing without, not one they have
    // taken out. It is not in the audio, so it is not in this either.
    if (cue.muted) continue;
    notes.push(noteOf(cue, recorded));
  }

  return notes;
}

function noteOf(cue: Cue, recorded: Map<string, number>): NoteEvent {
  const { midi, ch } = noteFor(cue.source, recorded);
  return {
    midi,
    // Where the sound actually begins, which for anything anchored to its end
    // is not where the cue sits.
    t: cueStart(cue),
    dur: cueLength(cue),
    // Level as velocity, held inside what MIDI has. A stack is one sound and
    // so is one note: the parts under it are how it is made, not what it is.
    vel: Math.max(0.05, Math.min(1, cue.gain)),
    ch,
  };
}

/**
 * The timeline as a Standard MIDI File.
 *
 * The tempo written into it is the project's own, which is what the beat
 * snapping uses. It is only there because MIDI measures time in beats: the
 * file lines up in seconds either way, since the times are worked out against
 * the same tempo that is written down.
 */
export function encodeProjectMidi(project: Project): Blob {
  return encodeMidi(cueNotes(project), project.bpm || 120);
}
