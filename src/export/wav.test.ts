import { describe, expect, it } from 'vitest';
import { encodeWav } from './wav.ts';
import { audioBuffer, ramp } from '../../test/audio-buffer.ts';

async function read(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer());
}

const text = (view: DataView, at: number, length: number): string =>
  Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(at + i))).join('');

/** Read one signed 24 bit sample, smallest byte first. */
function int24(view: DataView, at: number): number {
  const raw = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
  return raw & 0x800000 ? raw - 0x1000000 : raw;
}

const HEADER = 44;

describe('the header', () => {
  it('says RIFF, WAVE, fmt and data, in the places a reader looks', async () => {
    const view = await read(encodeWav(audioBuffer([[0, 0, 0]])));
    expect(text(view, 0, 4)).toBe('RIFF');
    expect(text(view, 8, 4)).toBe('WAVE');
    expect(text(view, 12, 4)).toBe('fmt ');
    expect(text(view, 36, 4)).toBe('data');
  });

  it('describes uncompressed PCM', async () => {
    const view = await read(encodeWav(audioBuffer([[0]])));
    expect(view.getUint32(16, true)).toBe(16); // the fmt chunk is 16 bytes
    expect(view.getUint16(20, true)).toBe(1); // format 1
  });

  it.each([
    [16, 2],
    [24, 3],
  ])('works out the rates and alignments for %i bit', async (bits, bytesPerSample) => {
    /*
     * The two numbers nothing complains about and everything depends on. A
     * wrong byte rate or block align opens as noise, or at the wrong speed,
     * in whatever the file is dropped into.
     */
    const frames = 10;
    const view = await read(
      encodeWav(audioBuffer([ramp(frames, () => 0), ramp(frames, () => 0)], 44_100), bits as 16 | 24),
    );
    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(44_100); // sample rate
    expect(view.getUint32(28, true)).toBe(44_100 * 2 * bytesPerSample); // byte rate
    expect(view.getUint16(32, true)).toBe(2 * bytesPerSample); // block align
    expect(view.getUint16(34, true)).toBe(bits);
  });

  it.each([
    [16, 1],
    [16, 2],
    [24, 1],
    [24, 2],
  ])('declares sizes that match the file it is on, at %i bit and %i channels', async (bits, channels) => {
    const frames = 37;
    const buffer = audioBuffer(Array.from({ length: channels }, () => ramp(frames, () => 0.25)));
    const blob = encodeWav(buffer, bits as 16 | 24);
    const view = await read(blob);

    const dataBytes = frames * channels * (bits / 8);
    expect(blob.size).toBe(HEADER + dataBytes);
    expect(view.getUint32(40, true)).toBe(dataBytes); // the data chunk
    // RIFF counts everything after its own first eight bytes.
    expect(view.getUint32(4, true)).toBe(blob.size - 8);
  });

  it('writes a usable header for a buffer with nothing in it', async () => {
    const blob = encodeWav(audioBuffer([[]]));
    const view = await read(blob);
    expect(blob.size).toBe(HEADER);
    expect(text(view, 0, 4)).toBe('RIFF');
    expect(view.getUint32(40, true)).toBe(0);
    expect(view.getUint32(4, true)).toBe(36);
  });

  it('carries the type on the blob, so the browser names the file right', () => {
    expect(encodeWav(audioBuffer([[0]])).type).toBe('audio/wav');
  });
});

describe('the samples', () => {
  it('uses the whole range at 24 bit, which is not symmetric', async () => {
    /*
     * There is one more step below zero than above it. Reaching for a single
     * multiplier is the obvious simplification and it is wrong: it either
     * wastes the bottom step or overflows the top one.
     */
    const view = await read(encodeWav(audioBuffer([[1, -1, 0]])));
    expect(int24(view, HEADER)).toBe(0x7fffff);
    expect(int24(view, HEADER + 3)).toBe(-0x800000);
    expect(int24(view, HEADER + 6)).toBe(0);
  });

  it('uses the whole range at 16 bit, the same way', async () => {
    const view = await read(encodeWav(audioBuffer([[1, -1, 0]]), 16));
    expect(view.getInt16(HEADER, true)).toBe(32767);
    expect(view.getInt16(HEADER + 2, true)).toBe(-32768);
    expect(view.getInt16(HEADER + 4, true)).toBe(0);
  });

  it('holds anything past full scale at full scale, rather than wrapping', async () => {
    /*
     * Wrapping is the loudest possible sound a file can contain: a sample
     * that overflowed comes back round as the opposite extreme, and reads as
     * a click on every hit that ever went over.
     */
    const view = await read(encodeWav(audioBuffer([[2, -2, 1e9, -1e9]])));
    expect(int24(view, HEADER)).toBe(0x7fffff);
    expect(int24(view, HEADER + 3)).toBe(-0x800000);
    expect(int24(view, HEADER + 6)).toBe(0x7fffff);
    expect(int24(view, HEADER + 9)).toBe(-0x800000);
  });

  it('writes 24 bit samples smallest byte first', async () => {
    // 0x123456 as bytes is 56 34 12, and the wrong way round is a different
    // and much louder sound.
    const value = 0x123456 / 0x7fffff;
    const view = await read(encodeWav(audioBuffer([[value]])));
    expect(view.getUint8(HEADER)).toBe(0x56);
    expect(view.getUint8(HEADER + 1)).toBe(0x34);
    expect(view.getUint8(HEADER + 2)).toBe(0x12);
  });

  it('lays stereo out one frame at a time, left then right', async () => {
    const view = await read(encodeWav(audioBuffer([[0.5, 0.25], [-0.5, -0.25]]), 16));
    expect(view.getInt16(HEADER, true)).toBe(Math.round(0.5 * 32767));
    expect(view.getInt16(HEADER + 2, true)).toBe(Math.round(-0.5 * 32768));
    expect(view.getInt16(HEADER + 4, true)).toBe(Math.round(0.25 * 32767));
    expect(view.getInt16(HEADER + 6, true)).toBe(Math.round(-0.25 * 32768));
  });

  it('keeps every sample it was given', async () => {
    const frames = 512;
    const left = ramp(frames, (i) => Math.sin(i / 8) * 0.9);
    const view = await read(encodeWav(audioBuffer([left]), 24));

    for (let i = 0; i < frames; i++) {
      const written = int24(view, HEADER + i * 3) / (left[i] < 0 ? 0x800000 : 0x7fffff);
      expect(written).toBeCloseTo(left[i], 5);
    }
  });

  it('writes the first two channels of something wider, rather than refusing', async () => {
    // A WAV here is a deliverable for an editing timeline, and those are
    // stereo. More than two is folded rather than failed.
    const buffer = audioBuffer([[1], [-1], [0.5], [0.25]]);
    const blob = encodeWav(buffer, 16);
    const view = await read(blob);

    expect(view.getUint16(22, true)).toBe(2);
    expect(blob.size).toBe(HEADER + 1 * 2 * 2);
    expect(view.getInt16(HEADER, true)).toBe(32767);
    expect(view.getInt16(HEADER + 2, true)).toBe(-32768);
  });

  it('defaults to 24 bit, which is what post production expects', async () => {
    const blob = encodeWav(audioBuffer([[0, 0, 0, 0]]));
    expect(blob.size).toBe(HEADER + 4 * 3);
    expect((await read(blob)).getUint16(34, true)).toBe(24);
  });
});
