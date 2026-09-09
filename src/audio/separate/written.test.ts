import { describe, expect, it } from 'vitest';
import { fromBuffer, PEAKS, Written } from './written.ts';

/**
 * A part is a file, and this is what that costs and what it buys.
 *
 * Everything here is about the one decision in `written.ts`: a separated part is
 * quantised as it is made rather than kept as floating point. What it buys is
 * the length of recording that can be taken apart at all. What it costs is
 * precision, and the size of that cost is a number rather than a feeling — so it
 * is written down here as one.
 */

const RATE = 48_000;

/** How far a sample can move by being written at twenty four bits. */
const A_STEP = 1 / 0x7fffff;

function filled(length: number, channels: number, make: (at: number, lane: number) => number) {
  const part = new Written(length, channels, RATE);
  const lanes: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const lane = new Float32Array(length);
    for (let i = 0; i < length; i++) lane[i] = make(i, c);
    lanes.push(lane);
  }
  part.write(0, lanes, 0, length);
  return { part, lanes };
}

describe('writing a part as it is made', () => {
  /*
   * What comes back is what went in, to within one step of the format.
   *
   * Half a step is the most a rounded number can move, and there is one round
   * per sample, so half a step is the claim and a whole one is the margin. This
   * is the number that decides whether "the parts add back up to the recording"
   * survives being written down: four parts, each out by at most half a step,
   * add up to something at most two steps from the recording, which is about
   * two ten-millionths — below where sixteen bit playback could show it and far
   * below anything audible.
   */
  it('gives back the samples it was given, to within one step of the format', () => {
    const { part, lanes } = filled(4096, 2, (at, lane) =>
      Math.sin((2 * Math.PI * (lane ? 220 : 440) * at) / RATE) * 0.8,
    );
    const back = part.samples();
    for (let c = 0; c < 2; c++) {
      const got = back.getChannelData(c);
      let worst = 0;
      for (let i = 0; i < lanes[c].length; i++) worst = Math.max(worst, Math.abs(got[i] - lanes[c][i]));
      expect(worst, `channel ${c} moved by ${worst}`).toBeLessThan(A_STEP);
    }
  });

  /*
   * A file cannot hold more than full scale, and neither can a part.
   *
   * Worth stating rather than discovering. A mix that is itself over the top
   * cannot be reconstructed from parts that are written down, because the loud
   * moments were never expressible. Real recordings do not go over; material
   * assembled in a test can, and `refine.test.ts` scales its fixture for exactly
   * this reason.
   */
  it('holds nothing louder than full scale, either way up', () => {
    const { part } = filled(64, 1, (at) => (at % 2 ? 4 : -4));
    const back = part.samples().getChannelData(0);
    for (let i = 0; i < 64; i++) expect(Math.abs(back[i])).toBeLessThanOrEqual(1);
    expect(back[0]).toBeCloseTo(-1, 5);
    expect(back[1]).toBeCloseTo(1, 5);
  });

  it('counts the energy on the way past, so nothing has to read it back', () => {
    const { part, lanes } = filled(2048, 2, (at, lane) => (lane ? 0.25 : -0.5) * (at % 3 ? 1 : 0));
    let expected = 0;
    for (const lane of lanes) for (const value of lane) expected += value * value;
    expect(part.energy).toBeCloseTo(expected, 4);
  });

  /*
   * The waveform is the loudest sample in each slice, not the average.
   *
   * An average of a waveform is roughly nothing however loud it is, so a drum
   * part drawn from its mean would be a flat line with the odd bump. The single
   * loud sample planted here is a drum hit standing in for itself: it has to
   * reach the top of its own column and leave the others alone.
   */
  it('draws each slice from the loudest sample in it', () => {
    const length = PEAKS * 10;
    const part = new Written(length, 1, RATE);
    const lane = new Float32Array(length);
    lane[Math.floor(length / 2)] = 0.9;
    part.write(0, [lane], 0, length);

    const loudest = part.peaks.indexOf(Math.max(...part.peaks));
    expect(part.peaks[loudest]).toBeCloseTo(0.9, 4);
    expect(loudest).toBe(Math.floor(part.peaks.length / 2));
    // And every other column is silent, rather than smeared with a share of it.
    const rest = [...part.peaks].filter((_value, at) => at !== loudest);
    expect(Math.max(...rest)).toBe(0);
  });

  it('fills its waveform from stretches written one after another', () => {
    const length = PEAKS * 4;
    const whole = filled(length, 1, (at) => Math.sin(at / 20) * 0.6).part;

    const piecemeal = new Written(length, 1, RATE);
    const lane = new Float32Array(length);
    for (let i = 0; i < length; i++) lane[i] = Math.sin(i / 20) * 0.6;
    // In three uneven stretches, which is what the block loop hands over.
    piecemeal.write(0, [lane], 0, 1000);
    piecemeal.write(1000, [lane.subarray(1000)], 0, 1500);
    piecemeal.write(2500, [lane.subarray(2500)], 0, length - 2500);

    expect([...piecemeal.peaks]).toEqual([...whole.peaks]);
    expect(piecemeal.energy).toBeCloseTo(whole.energy, 4);
  });

  it('is a WAV file that says what it holds', async () => {
    const { part } = filled(1000, 2, (at) => Math.sin(at / 10) * 0.5);
    const view = new DataView(await part.wav().arrayBuffer());
    const text = (at: number, long: number): string =>
      String.fromCharCode(...Array.from({ length: long }, (_, i) => view.getUint8(at + i)));

    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(text(12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true), 'uncompressed PCM').toBe(1);
    expect(view.getUint16(22, true), 'channels').toBe(2);
    expect(view.getUint32(24, true), 'rate').toBe(RATE);
    expect(view.getUint16(34, true), 'bits').toBe(24);
    expect(text(36, 4)).toBe('data');
    expect(view.getUint32(40, true), 'bytes of samples').toBe(1000 * 2 * 3);
    expect(view.byteLength).toBe(44 + 1000 * 2 * 3);
  });

  /*
   * The bytes are handed over to the file, not copied alongside it.
   *
   * This is the whole saving, so it is stated as a test rather than trusted to a
   * comment: if a part could still be read back afterwards it would be held
   * twice, which is the doubling the file exists to remove. Nothing in the app
   * asks for both — the screen wants a file, and going deeper into a part
   * decodes the one it was registered as.
   */
  it('lets go of its samples once it has been asked for a file', () => {
    const { part } = filled(256, 1, () => 0.5);
    expect(part.wav().size).toBeGreaterThan(0);
    // The same file again, rather than a second copy of it.
    expect(part.wav()).toBe(part.wav());
    expect(() => part.samples()).toThrow(/handed over/);
    expect(() => part.write(0, [new Float32Array(1)], 0, 1)).toThrow(/already been written/);
  });

  it('still knows how long and how loud it was after that', () => {
    const { part } = filled(RATE, 2, () => 0.5);
    const peaks = [...part.peaks];
    const energy = part.energy;
    part.wav();
    expect(part.duration).toBe(1);
    expect(part.length).toBe(RATE);
    expect([...part.peaks]).toEqual(peaks);
    expect(part.energy).toBe(energy);
  });
});

describe('wrapping samples that already exist', () => {
  /*
   * The seam is satisfiable by a separator that works the other way round.
   *
   * `PartAudio` says a part is a file first, which is true of the one here
   * because it is written a stretch at a time. Something that hands back whole
   * buffers — a trained model, or a test — should not have to care, and this is
   * the test that it does not have to.
   */
  it('takes a whole buffer and gives back a part like any other', () => {
    const buffer = new AudioBuffer({ numberOfChannels: 2, length: 4096, sampleRate: RATE });
    for (let c = 0; c < 2; c++) {
      const lane = buffer.getChannelData(c);
      for (let i = 0; i < lane.length; i++) lane[i] = Math.sin((i / 30) * (c + 1)) * 0.7;
    }

    const part = fromBuffer(buffer);
    expect(part.length).toBe(4096);
    expect(part.channels).toBe(2);
    expect(part.rate).toBe(RATE);

    const back = part.samples();
    for (let c = 0; c < 2; c++) {
      const was = buffer.getChannelData(c);
      const got = back.getChannelData(c);
      let worst = 0;
      for (let i = 0; i < was.length; i++) worst = Math.max(worst, Math.abs(got[i] - was[i]));
      expect(worst).toBeLessThan(A_STEP);
    }
  });
});
