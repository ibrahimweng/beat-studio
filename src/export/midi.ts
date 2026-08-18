import type { NoteEvent } from '../types.ts';

/** Ticks per quarter note written into the file header. */
const TICKS_PER_BEAT = 480;
/** Shortest note-off gap, so a hit never collapses to zero length. */
const MIN_NOTE = 0.06;

/**
 * Variable-length quantity: MIDI's own integer encoding, seven bits per byte
 * with the high bit marking "more to come".
 */
function vlq(value: number): number[] {
  let n = value;
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

/**
 * Write recorded notes as a type-0 Standard MIDI File.
 *
 * Events arrive with absolute times in seconds; they are converted to ticks,
 * split into note-on/note-off pairs, sorted, then written as delta times.
 */
export function encodeMidi(events: readonly NoteEvent[], bpm: number): Blob {
  const track: number[] = [];

  // Tempo meta event, in microseconds per quarter note.
  const microsPerBeat = Math.round(60_000_000 / bpm);
  track.push(
    0,
    0xff,
    0x51,
    0x03,
    (microsPerBeat >> 16) & 255,
    (microsPerBeat >> 8) & 255,
    microsPerBeat & 255,
  );

  const toTicks = (seconds: number): number => Math.round((seconds * TICKS_PER_BEAT * bpm) / 60);

  const timed: { tick: number; data: number[] }[] = [];
  for (const e of events) {
    const on = toTicks(e.t);
    const off = toTicks(e.t + Math.max(MIN_NOTE, e.dur || 0.2));
    const velocity = Math.max(1, Math.min(127, Math.round((e.vel || 0.8) * 127)));
    timed.push({ tick: on, data: [0x90 | (e.ch & 15), e.midi, velocity] });
    timed.push({ tick: off, data: [0x80 | (e.ch & 15), e.midi, 0] });
  }
  timed.sort((a, b) => a.tick - b.tick);

  let last = 0;
  for (const event of timed) {
    for (const b of vlq(event.tick - last)) track.push(b);
    for (const b of event.data) track.push(b);
    last = event.tick;
  }

  // End of track
  track.push(0, 0xff, 0x2f, 0x00);

  const length = track.length;
  const bytes = [
    // MThd, 6 bytes of header, format 0, one track, division
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1,
    (TICKS_PER_BEAT >> 8) & 255, TICKS_PER_BEAT & 255,
    // MTrk plus track length
    0x4d, 0x54, 0x72, 0x6b,
    (length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255,
    ...track,
  ];

  return new Blob([new Uint8Array(bytes)], { type: 'audio/midi' });
}
