/**
 * Where a separated part is put as it is made.
 *
 * A part used to be an AudioBuffer, and that is what decided how long a
 * recording this could take. Four parts held as floating point are four times
 * the size of the recording; the encoded files are three quarters of that again
 * on top, and both exist at once while the parts are being written out. Eight
 * minutes of stereo is a gigabyte and a half that way, which is where a browser
 * tab stops allocating and starts failing.
 *
 * So a part is a file first and samples second. The block loop quantises each
 * stretch of it the moment that stretch is final — which is as soon as the
 * following block has been added, because nothing after that touches it — and
 * never allocates a full-length lane at all. The working set is one block wide.
 *
 * Measured, a minute of forty eight kilohertz stereo went from costing 180
 * megabytes at the peak to 90, which is 15.6 bytes for every sample of every
 * channel: four for the recording and twelve for the four parts. The ceiling did
 * not move; a minute simply reaches half as far up it, so the longest recording
 * that can be taken apart went from eight minutes to sixteen.
 *
 * Twenty four bits, matching every other file this app writes. A part is
 * something somebody will put under a voiceover, and the room underneath the
 * quiet detail is the whole reason for the depth.
 *
 * Nothing here touches the page.
 */

import type { PartAudio } from './types.ts';

/** A WAV header is 44 bytes before the samples start. */
const HEADER = 44;

/** Twenty four bits, so three bytes a sample. */
const BYTES = 3;

/*
 * Negative and positive full scale are not symmetric in PCM: there is one more
 * step below zero than above it. The same pair as `src/export/wav.ts`, which
 * writes the same format for the same reason.
 */
const FLOOR = 0x800000;
const CEILING = 0x7fffff;

/**
 * How many slices a part's waveform is drawn from.
 *
 * Enough that a hit half a second into a three minute part lands in a different
 * column from the one before it, and few enough that the row redraws without
 * thinking about it.
 */
export const PEAKS = 700;

/**
 * One separated part, written as it is made.
 *
 * Built empty and filled by {@link write} in order. The peaks and the energy are
 * counted on the way past, because both would otherwise mean reading every
 * sample back a second time, and reading every sample back is the cost this
 * whole file exists to avoid.
 */
export class Written implements PartAudio {
  readonly rate: number;
  readonly channels: number;
  readonly length: number;
  readonly peaks: Float32Array;

  #bytes: Uint8Array<ArrayBuffer> | null;
  #file: Blob | null = null;
  #energy = 0;
  /** How many peak slices there are per sample, worked out once. */
  #perSample: number;

  constructor(length: number, channels: number, rate: number, slices = PEAKS) {
    this.rate = rate;
    this.channels = channels;
    this.length = length;
    this.peaks = new Float32Array(Math.max(1, Math.min(slices, length || 1)));
    this.#perSample = this.peaks.length / Math.max(1, length);
    this.#bytes = new Uint8Array(new ArrayBuffer(HEADER + length * channels * BYTES));
    describe(this.#bytes, length, channels, rate);
  }

  get duration(): number {
    return this.rate > 0 ? this.length / this.rate : 0;
  }

  get energy(): number {
    return this.#energy;
  }

  /**
   * Write a stretch of finished samples into the part.
   *
   * `into` is where the stretch belongs in the part; `lanes` holds one array per
   * channel and `at` is where in them it starts. Called once per stretch and
   * never twice for the same sample — the block loop only hands over what no
   * later block can still add to.
   */
  write(into: number, lanes: readonly Float32Array[], at: number, count: number): void {
    const bytes = this.#bytes;
    if (!bytes) throw new Error('this part has already been written out');

    let offset = HEADER + into * this.channels * BYTES;
    for (let i = 0; i < count; i++) {
      // Which column of the waveform this sample is drawn in.
      const slice = Math.min(this.peaks.length - 1, Math.floor((into + i) * this.#perSample));
      for (let c = 0; c < this.channels; c++) {
        const sample = lanes[c][at + i];
        this.#energy += sample * sample;
        const loud = sample < 0 ? -sample : sample;
        if (loud > this.peaks[slice]) this.peaks[slice] = loud;

        const held = sample < -1 ? -1 : sample > 1 ? 1 : sample;
        const value = Math.round(held < 0 ? held * FLOOR : held * CEILING);
        // No setInt24, so the three bytes go out smallest first by hand.
        bytes[offset] = value & 0xff;
        bytes[offset + 1] = (value >> 8) & 0xff;
        bytes[offset + 2] = (value >> 16) & 0xff;
        offset += BYTES;
      }
    }
  }

  /**
   * The part as a file.
   *
   * The bytes are handed over rather than copied alongside, and {@link samples}
   * stops working once they have been. That is deliberate: holding the part as
   * bytes and again as a Blob is exactly the doubling this file exists to
   * remove, and nothing needs both — the screen wants a file, and going deeper
   * into a part reads it back from the one it was registered as.
   */
  wav(): Blob {
    if (!this.#file) {
      const bytes = this.#bytes;
      if (!bytes) throw new Error('this part has already been written out');
      this.#file = new Blob([bytes], { type: 'audio/wav' });
      this.#bytes = null;
    }
    return this.#file;
  }

  /**
   * The samples, read back out of the bytes.
   *
   * Allocates the whole part, which is why it is a method and why nothing on the
   * screen calls it. Only {@link wav} having not been called yet.
   */
  samples(): AudioBuffer {
    const bytes = this.#bytes;
    if (!bytes) throw new Error('this part was handed over as a file, and its samples with it');

    const out = new AudioBuffer({
      numberOfChannels: this.channels,
      length: Math.max(1, this.length),
      sampleRate: this.rate,
    });
    const lanes: Float32Array[] = [];
    for (let c = 0; c < this.channels; c++) lanes.push(out.getChannelData(c));

    let offset = HEADER;
    for (let i = 0; i < this.length; i++) {
      for (let c = 0; c < this.channels; c++) {
        const raw = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
        // The top bit of a 24-bit value is its sign, and this is a 32-bit number.
        const value = raw & 0x800000 ? raw - 0x1000000 : raw;
        lanes[c][i] = value / (value < 0 ? FLOOR : CEILING);
        offset += BYTES;
      }
    }
    return out;
  }
}

/** Put a WAV header on the front of a part, so the bytes are already a file. */
function describe(bytes: Uint8Array<ArrayBuffer>, frames: number, channels: number, rate: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, what: string): void => {
    for (let i = 0; i < what.length; i++) view.setUint8(offset + i, what.charCodeAt(i));
  };
  const dataBytes = frames * channels * BYTES;

  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');

  // fmt chunk — 16 bytes, format 1 (uncompressed PCM)
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * BYTES, true); // byte rate
  view.setUint16(32, channels * BYTES, true); // block align
  view.setUint16(34, BYTES * 8, true);

  text(36, 'data');
  view.setUint32(40, dataBytes, true);
}

/**
 * Wrap samples that already exist as a part.
 *
 * Here so that what {@link PartAudio} says is true rather than aspirational: a
 * separator that hands back whole buffers — a trained model, or a test — meets
 * the seam with this, and gives up nothing except the memory it was already
 * using. The one in `dsp.ts` does not need it, because it never has a whole
 * part in floating point to wrap.
 */
export function fromBuffer(
  buffer: AudioBuffer,
  channels = Math.min(2, buffer.numberOfChannels),
): Written {
  const out = new Written(buffer.length, channels, buffer.sampleRate);
  const lanes: Float32Array[] = [];
  for (let c = 0; c < channels; c++) lanes.push(buffer.getChannelData(c));
  out.write(0, lanes, 0, buffer.length);
  return out;
}
