import { describe, expect, it } from 'vitest';
import { cueNotes, encodeProjectMidi, noteFor } from './timeline-midi.ts';
import { emptyProject, makeCue } from '../timeline/project.ts';
import { DESIGN_NAMES } from '../timeline/types.ts';
import type { Cue, CueSource, Project } from '../timeline/types.ts';
import { PAD_MIDI } from '../constants.ts';

function project(cues: Cue[], over: Partial<Project> = {}): Project {
  return { ...emptyProject(), duration: 30, cues, ...over };
}

const design = (name: string, at: number, over: Partial<Cue> = {}): Cue => ({
  ...makeCue(at, 'impacts', { kind: 'design', name } as CueSource),
  ...over,
});

const rows = (): Map<string, number> => new Map();

describe('which row a sound is written on', () => {
  it('writes the kit as real percussion, on the channel reserved for it', () => {
    /*
     * The one part of this that is not an invention of ours. A kick written
     * as General MIDI percussion opens as a kick in anything, which is worth
     * more than any row we could choose for it.
     */
    const note = noteFor({ kind: 'kit', name: 'kick' }, rows());
    expect(note.midi).toBe(PAD_MIDI.kick);
    expect(note.ch).toBe(9);
  });

  it('keeps a pitched sound on its own pitch', () => {
    expect(noteFor({ kind: 'pitched', name: 'piano', midi: 48 }, rows())).toEqual({
      midi: 48,
      ch: 0,
    });
    // The two instruments are apart, so either can be muted on its own.
    expect(noteFor({ kind: 'pitched', name: 'guitar', midi: 55 }, rows()).ch).toBe(1);
  });

  it('gives each design voice a row of its own', () => {
    /*
     * They are not notes and have no pitch worth writing down. A row each is
     * what makes the piano roll read as the shape of the piece: every impact
     * on one line, every whoosh on the line under it.
     */
    const seen = new Set<number>();
    for (const name of DESIGN_NAMES) {
      const { midi, ch } = noteFor({ kind: 'design', name }, rows());
      expect(ch).toBe(2);
      seen.add(midi);
    }
    expect(seen.size).toBe(DESIGN_NAMES.length);
  });

  it('keeps every row inside what a piano roll will draw', () => {
    for (const name of DESIGN_NAMES) {
      const { midi } = noteFor({ kind: 'design', name }, rows());
      expect(midi).toBeGreaterThanOrEqual(0);
      expect(midi).toBeLessThanOrEqual(127);
    }
  });

  it('gives a recording the same row wherever it appears', () => {
    const held = rows();
    const first = noteFor({ kind: 'sample', name: 'door-slam' }, held);
    const other = noteFor({ kind: 'sample', name: 'glass' }, held);
    const again = noteFor({ kind: 'sample', name: 'door-slam' }, held);

    expect(again).toEqual(first);
    expect(other.midi).not.toBe(first.midi);
    expect(first.ch).toBe(3);
  });

  it('tells two pack sounds of the same name apart', () => {
    const held = rows();
    const mine = noteFor({ kind: 'pack', name: 'hit', pack: 'mine' }, held);
    const theirs = noteFor({ kind: 'pack', name: 'hit', pack: 'theirs' }, held);
    expect(mine.midi).not.toBe(theirs.midi);
  });
});

describe('turning the timeline into notes', () => {
  it('writes one note for each sound, in the order they happen', () => {
    const notes = cueNotes(
      project([design('impact', 2), design('whoosh', 0.5), design('riser', 4)]),
    );
    expect(notes).toHaveLength(3);
    expect(notes.map((n) => n.t)).toEqual([...notes.map((n) => n.t)].sort((a, b) => a - b));
  });

  it('writes a sound where it begins, not where its cue sits', () => {
    /*
     * A riser is anchored to where it finishes, so the cue's own time is the
     * end of it. Writing the note there would put it a second late in
     * whatever opens the file, which is the whole thing this is for.
     */
    const riser = design('riser', 5, { anchor: 'end', length: 1.5 });
    const [note] = cueNotes(project([riser]));
    expect(note.t).toBeCloseTo(3.5, 5);
    expect(note.dur).toBeCloseTo(1.5, 5);
  });

  it('leaves out a sound that has been silenced', () => {
    // Muted is somebody comparing without it. It is not in the audio, so it
    // is not in this either.
    const notes = cueNotes(project([design('impact', 1), design('thud', 2, { muted: true })]));
    expect(notes).toHaveLength(1);
  });

  it('carries the level across as velocity, inside what MIDI has', () => {
    const notes = cueNotes(
      project([design('impact', 1, { gain: 1 }), design('thud', 2, { gain: 0 })]),
    );
    expect(notes[0].vel).toBe(1);
    // Never nought: a note at nought velocity means note off, and the sound
    // would be missing from a file that says it is there.
    expect(notes[1].vel).toBeGreaterThan(0);
  });

  it('writes one note for a stack, since a stack is one sound', () => {
    const stacked = design('thud', 1, {
      source: { kind: 'design', name: 'thud', with: [{ kind: 'design', name: 'sub', mix: 0.5 }] },
    });
    expect(cueNotes(project([stacked]))).toHaveLength(1);
  });

  it('says nothing about an empty timeline', () => {
    expect(cueNotes(project([]))).toEqual([]);
  });
});

describe('the file itself', () => {
  it('is a MIDI file a program will open', async () => {
    const blob = encodeProjectMidi(project([design('impact', 1), design('whoosh', 2)]));
    expect(blob.type).toBe('audio/midi');
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    expect(String.fromCharCode(...head)).toBe('MThd');
  });

  it('carries the tempo the project is set to, since MIDI counts in beats', async () => {
    const blob = encodeProjectMidi(project([design('impact', 1)], { bpm: 90 }));
    const view = new DataView(await blob.arrayBuffer());
    // The tempo meta event opens the track: delta, ff, 51, 03, then the value.
    const micros = (view.getUint8(26) << 16) | (view.getUint8(27) << 8) | view.getUint8(28);
    expect(micros).toBe(Math.round(60_000_000 / 90));
  });

  it('puts a sound at the same moment in seconds whatever the tempo says', async () => {
    /*
     * The point of writing the tempo down. Times are worked out against the
     * same tempo the file declares, so a sound two seconds in opens two
     * seconds in, whatever number that tempo happens to be.
     */
    const at = 2;
    for (const bpm of [60, 120, 137]) {
      const blob = encodeProjectMidi(project([design('impact', at)], { bpm }));
      const view = new DataView(await blob.arrayBuffer());

      // Straight after the tempo event comes the first note's delta.
      let cursor = 22 + 7;
      let ticks = 0;
      for (;;) {
        const byte = view.getUint8(cursor++);
        ticks = (ticks << 7) | (byte & 0x7f);
        if (!(byte & 0x80)) break;
      }
      // 480 ticks to a beat, and bpm beats a minute.
      expect((ticks / 480) * (60 / bpm)).toBeCloseTo(at, 2);
    }
  });
});
