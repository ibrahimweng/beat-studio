import { describe, expect, it } from 'vitest';
import { encodeMidi } from './midi.ts';
import type { NoteEvent } from '../types.ts';

const TICKS_PER_BEAT = 480;
/** At 120 bpm a beat is half a second, so a second is this many ticks. */
const TICKS_PER_SECOND = 960;

interface Played {
  tick: number;
  kind: 'on' | 'off' | 'meta';
  channel?: number;
  note?: number;
  velocity?: number;
  meta?: number;
  data?: number[];
}

/** Everything the file says, read back the way any sequencer reads it. */
async function play(blob: Blob): Promise<{ view: DataView; header: Record<string, number>; events: Played[] }> {
  const view = new DataView(await blob.arrayBuffer());
  const header = {
    headerLength: view.getUint32(4),
    format: view.getUint16(8),
    tracks: view.getUint16(10),
    division: view.getUint16(12),
    trackLength: view.getUint32(18),
  };

  const events: Played[] = [];
  let at = 22;
  const end = 22 + header.trackLength;
  let tick = 0;

  while (at < end) {
    // Variable-length quantity: seven bits a byte, high bit means more.
    let delta = 0;
    for (;;) {
      const byte = view.getUint8(at++);
      delta = (delta << 7) | (byte & 0x7f);
      if (!(byte & 0x80)) break;
    }
    tick += delta;

    const status = view.getUint8(at++);
    if (status === 0xff) {
      const meta = view.getUint8(at++);
      const length = view.getUint8(at++);
      const data: number[] = [];
      for (let i = 0; i < length; i++) data.push(view.getUint8(at++));
      events.push({ tick, kind: 'meta', meta, data });
      continue;
    }
    const note = view.getUint8(at++);
    const velocity = view.getUint8(at++);
    events.push({
      tick,
      kind: (status & 0xf0) === 0x90 ? 'on' : 'off',
      channel: status & 0x0f,
      note,
      velocity,
    });
  }

  return { view, header, events };
}

const note = (over: Partial<NoteEvent> = {}): NoteEvent => ({
  midi: 60,
  t: 0,
  dur: 0.5,
  vel: 0.8,
  ch: 0,
  ...over,
});

const text = (view: DataView, at: number): string =>
  Array.from({ length: 4 }, (_, i) => String.fromCharCode(view.getUint8(at + i))).join('');

describe('the file around the notes', () => {
  it('is a type 0 file with one track', async () => {
    const { view, header } = await play(encodeMidi([note()], 120));
    expect(text(view, 0)).toBe('MThd');
    expect(text(view, 14)).toBe('MTrk');
    expect(header.headerLength).toBe(6);
    expect(header.format).toBe(0);
    expect(header.tracks).toBe(1);
    expect(header.division).toBe(TICKS_PER_BEAT);
  });

  it('says how long the track is, and is that long', async () => {
    // A length that disagrees with the bytes is a file that opens truncated,
    // or not at all.
    const blob = encodeMidi([note(), note({ t: 1, midi: 64 })], 120);
    const { header } = await play(blob);
    expect(blob.size).toBe(22 + header.trackLength);
  });

  it('opens with the tempo and closes with the end of the track', async () => {
    const { events } = await play(encodeMidi([note()], 150));
    const first = events[0];
    const last = events[events.length - 1];

    expect(first.kind).toBe('meta');
    expect(first.meta).toBe(0x51);
    const micros = (first.data![0] << 16) | (first.data![1] << 8) | first.data![2];
    expect(micros).toBe(Math.round(60_000_000 / 150));

    expect(last.kind).toBe('meta');
    expect(last.meta).toBe(0x2f);
  });

  it('is a whole file even with nothing recorded', async () => {
    const { header, events } = await play(encodeMidi([], 120));
    expect(header.tracks).toBe(1);
    expect(events.map((e) => e.meta)).toEqual([0x51, 0x2f]);
  });

  it('carries the type on the blob', () => {
    expect(encodeMidi([], 120).type).toBe('audio/midi');
  });
});

describe('turning seconds into ticks', () => {
  it('puts a note where it was played, and lifts it where it ended', async () => {
    const { events } = await play(encodeMidi([note({ t: 0.5, dur: 0.25 })], 120));
    const on = events.find((e) => e.kind === 'on')!;
    const off = events.find((e) => e.kind === 'off')!;

    expect(on.tick).toBe(0.5 * TICKS_PER_SECOND);
    expect(off.tick).toBe(0.75 * TICKS_PER_SECOND);
  });

  it('follows the tempo it is told, not the one it wrote last', async () => {
    const { events } = await play(encodeMidi([note({ t: 1, dur: 1 })], 60));
    // At 60 bpm a beat is a second, so a second is one beat of ticks.
    expect(events.find((e) => e.kind === 'on')!.tick).toBe(TICKS_PER_BEAT);
    expect(events.find((e) => e.kind === 'off')!.tick).toBe(TICKS_PER_BEAT * 2);
  });

  it('encodes a gap too big for one byte across several', async () => {
    /*
     * Delta times are MIDI's own seven-bits-to-a-byte integers, and anything
     * past 127 needs more than one. A note a second in is 960 ticks, which is
     * the first case that goes wrong if that is written as a plain byte.
     */
    const { view, header } = await play(encodeMidi([note({ t: 1 })], 120));

    // The tempo event takes seven bytes, so the first note's delta follows it.
    const at = 22 + 7;
    expect(view.getUint8(at)).toBe(0x87);
    expect(view.getUint8(at + 1)).toBe(0x40);
    expect((0x07 << 7) | 0x40).toBe(TICKS_PER_SECOND);

    const { events } = await play(encodeMidi([note({ t: 1 })], 120));
    expect(events.find((e) => e.kind === 'on')!.tick).toBe(TICKS_PER_SECOND);
    expect(header.trackLength).toBeGreaterThan(0);
  });

  it('gives a note with no length one anyway', async () => {
    // A note-on and note-off on the same tick is a note no synth will sound.
    const { events } = await play(encodeMidi([note({ t: 0, dur: 0 })], 120));
    const on = events.find((e) => e.kind === 'on')!;
    const off = events.find((e) => e.kind === 'off')!;
    expect(off.tick).toBeGreaterThan(on.tick);
  });
});

describe('the notes themselves', () => {
  it('keeps the pitch and the channel', async () => {
    const { events } = await play(encodeMidi([note({ midi: 42, ch: 9 })], 120));
    for (const event of events.filter((e) => e.kind !== 'meta')) {
      expect(event.note).toBe(42);
      expect(event.channel).toBe(9);
    }
  });

  it('turns a velocity of nought to one into the seven bits MIDI has', async () => {
    const { events } = await play(
      encodeMidi([note({ t: 0, vel: 1 }), note({ t: 1, vel: 0.5 })], 120),
    );
    const ons = events.filter((e) => e.kind === 'on');
    expect(ons[0].velocity).toBe(127);
    expect(ons[1].velocity).toBe(64);
  });

  it('never writes a velocity of nought, which would mean a note off', async () => {
    const { events } = await play(encodeMidi([note({ vel: 0 })], 120));
    const on = events.find((e) => e.kind === 'on')!;
    // A note-on at nought is how a file ends up sounding empty.
    expect(on.velocity).toBeGreaterThanOrEqual(1);
  });

  it('holds a velocity past the top at the top', async () => {
    const { events } = await play(encodeMidi([note({ vel: 4 })], 120));
    expect(events.find((e) => e.kind === 'on')!.velocity).toBe(127);
  });

  it('keeps a channel inside the sixteen there are', async () => {
    const { events } = await play(encodeMidi([note({ ch: 20 })], 120));
    // Spilling out of the channel nibble would corrupt the status byte and
    // turn the note into some other kind of message entirely.
    expect(events.find((e) => e.kind === 'on')!.channel).toBe(20 & 15);
  });
});

describe('putting the notes in order', () => {
  it('sorts what it was given, however it arrived', async () => {
    /*
     * Written as where every note actually lands rather than as "the ticks go
     * up", because the ticks always go up: they are rebuilt by adding deltas,
     * and a delta is never written negative however wrong it is. An earlier
     * version of this test asserted the weaker thing and passed happily with
     * the sort taken out altogether.
     */
    const { events } = await play(
      encodeMidi(
        [note({ t: 2, midi: 62 }), note({ t: 0, midi: 60 }), note({ t: 1, midi: 61 })],
        120,
      ),
    );

    expect(
      events.filter((e) => e.kind !== 'meta').map((e) => [e.tick, e.kind, e.note]),
    ).toEqual([
      [0, 'on', 60],
      [480, 'off', 60],
      [960, 'on', 61],
      [1440, 'off', 61],
      [1920, 'on', 62],
      [2400, 'off', 62],
    ]);
  });

  it('writes a note off after the note it belongs to, not before', async () => {
    /*
     * The other thing the sort has to survive: a note that is still sounding
     * when the next one starts. Its note off belongs after that note on, and
     * putting the pairs down in the order they were played does not achieve
     * that on its own.
     */
    const { events } = await play(
      encodeMidi([note({ t: 0, dur: 3, midi: 60 }), note({ t: 1, dur: 0.5, midi: 67 })], 120),
    );

    expect(
      events.filter((e) => e.kind !== 'meta').map((e) => [e.tick, e.kind, e.note]),
    ).toEqual([
      [0, 'on', 60],
      [960, 'on', 67],
      [1440, 'off', 67],
      [2880, 'off', 60],
    ]);
  });

  it('lifts a note before starting the next one on the same pitch', async () => {
    /*
     * Two notes of the same pitch touching end to end. If the second note-on
     * is written before the first note-off, the off silences the note that
     * just started and the second one is never heard.
     */
    const { events } = await play(
      encodeMidi([note({ t: 0, dur: 1, midi: 60 }), note({ t: 1, dur: 1, midi: 60 })], 120),
    );
    const played = events.filter((e) => e.kind !== 'meta');
    expect(played.map((e) => e.kind)).toEqual(['on', 'off', 'on', 'off']);
  });

  it('writes overlapping notes without losing either', async () => {
    const { events } = await play(
      encodeMidi([note({ t: 0, dur: 2, midi: 60 }), note({ t: 1, dur: 2, midi: 67 })], 120),
    );
    const played = events.filter((e) => e.kind !== 'meta');
    expect(played).toHaveLength(4);
    expect(played.filter((e) => e.kind === 'on').map((e) => e.note)).toEqual([60, 67]);
    expect(played.filter((e) => e.kind === 'off').map((e) => e.note)).toEqual([60, 67]);
  });

  it('gives every note an off, however many there are', async () => {
    const notes = Array.from({ length: 60 }, (_, i) =>
      note({ t: i * 0.1, dur: 0.3, midi: 40 + (i % 24) }),
    );
    const { events } = await play(encodeMidi(notes, 96));
    expect(events.filter((e) => e.kind === 'on')).toHaveLength(60);
    expect(events.filter((e) => e.kind === 'off')).toHaveLength(60);
  });
});
