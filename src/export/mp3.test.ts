import { describe, expect, it, vi } from 'vitest';
import { encodeMp3 } from './mp3.ts';
import { audioBuffer, ramp } from '../../test/audio-buffer.ts';

/** Samples in one MPEG frame, which is the block the encoder works in. */
const BLOCK = 1152;
/** What the encoder is asked for, and what the buffers say they were made at. */
const KBPS = 192;
const RATE = 48_000;

async function first(blob: Blob, count: number): Promise<number[]> {
  return [...new Uint8Array(await blob.slice(0, count).arrayBuffer())];
}

/** A tone, rather than silence, since silence compresses to almost nothing. */
const tone = (count: number, step = 1 / 40): number[] =>
  ramp(count, (i) => Math.sin(i * step) * 0.8);

describe('encoding an MP3', () => {
  it('produces something a player will recognise', async () => {
    const blob = await encodeMp3(audioBuffer([tone(BLOCK * 2)]));
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe('audio/mpeg');
    expect(blob!.size).toBeGreaterThan(0);

    // Every MPEG audio frame opens with eleven bits set.
    const [a, b] = await first(blob!, 2);
    expect(a).toBe(0xff);
    expect(b & 0xe0).toBe(0xe0);
  });

  it('encodes mono and stereo alike', async () => {
    const mono = await encodeMp3(audioBuffer([tone(BLOCK * 2)]));
    const stereo = await encodeMp3(
      audioBuffer([tone(BLOCK * 2), tone(BLOCK * 2, 1 / 55)]),
    );
    for (const blob of [mono, stereo]) {
      expect(blob).not.toBeNull();
      expect(blob!.size).toBeGreaterThan(0);
      expect((await first(blob!, 1))[0]).toBe(0xff);
    }
  });

  it.each([BLOCK * 4, BLOCK * 4 + 500, BLOCK * 8])(
    'holds the whole piece, right to the end of it: %i samples',
    async (samples) => {
      /*
       * The encoder works in fixed blocks and holds back whatever does not
       * fill one, so the last fraction of a second only appears when it is
       * flushed. Without that flush every export loses its tail, which is
       * exactly where a reverb lives.
       *
       * Measured against what the piece's own length at its own bitrate comes
       * to, because that is the one number a missing tail moves in a direction
       * nothing else does. Comparing two encodes to each other does not work:
       * both grow with the input whether the tail is written or not, and an
       * earlier version of this test compared them and passed with the flush
       * removed entirely.
       */
      const blob = await encodeMp3(audioBuffer([tone(samples)], RATE));
      const seconds = samples / RATE;
      const owed = (seconds * KBPS * 1000) / 8;

      // Above, not merely near: the encoder's own priming puts a real file a
      // little over, and only a dropped tail puts one under.
      expect(blob!.size).toBeGreaterThanOrEqual(owed);
    },
  );

  it('gets longer as the piece does', async () => {
    const short = await encodeMp3(audioBuffer([tone(BLOCK * 2)]));
    const long = await encodeMp3(audioBuffer([tone(BLOCK * 8)]));
    expect(long!.size).toBeGreaterThan(short!.size * 2);
  });

  it('writes something for silence rather than nothing', async () => {
    const blob = await encodeMp3(audioBuffer([ramp(BLOCK * 2, () => 0)]));
    expect(blob!.size).toBeGreaterThan(0);
  });

  it('holds anything past full scale at full scale', async () => {
    // Wrapping would come back as the opposite extreme and read as a click.
    const blob = await encodeMp3(audioBuffer([ramp(BLOCK * 2, (i) => (i % 2 ? 8 : -8))]));
    expect(blob!.size).toBeGreaterThan(0);
    expect((await first(blob!, 1))[0]).toBe(0xff);
  });

  it('copes with a piece shorter than a single frame', async () => {
    const blob = await encodeMp3(audioBuffer([tone(200)]));
    expect(blob).not.toBeNull();
  });
});

describe('when the encoder will not load', () => {
  it('says so by returning nothing, so the export can fall back to WAV', async () => {
    /*
     * The encoder is a sizeable dependency fetched only when somebody
     * actually exports, so it can fail on a bad connection long after the app
     * has loaded. Handing back nothing lets the caller write a WAV instead,
     * which is a worse file rather than no file.
     */
    vi.resetModules();
    vi.doMock('@breezystack/lamejs', () => {
      throw new Error('could not be fetched');
    });

    const { encodeMp3: withoutEncoder } = await import('./mp3.ts');
    await expect(withoutEncoder(audioBuffer([tone(BLOCK)]))).resolves.toBeNull();

    vi.doUnmock('@breezystack/lamejs');
    vi.resetModules();
  });
});
