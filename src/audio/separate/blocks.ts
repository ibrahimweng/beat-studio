/**
 * Working a recording a piece at a time, and joining the pieces back up.
 *
 * The whole of a recording cannot be held in one spectrogram. Three minutes of
 * stereo at these settings is three hundred megabytes of complex numbers before
 * anything is separated out of it, and the parts coming out are that size
 * again. So everything in this folder works in blocks, and this is the one place
 * that knows it — a caller says how many parts it wants and, for each block,
 * what share of every cell goes to each of them.
 *
 * The joining is the part worth reading. Blocks overlap, and each one fades in
 * across the overlap while the one before it fades out, on two straight ramps
 * that add to exactly one. Two consequences follow, and both matter. The seam
 * cannot be heard, because nothing is cut. And the parts still add back up to
 * the recording sample for sample, because a cell divided by shares that add to
 * one, reconstructed by a transform that loses nothing, and assembled by weights
 * that add to one, has been divided and not damaged.
 *
 * Why there is an overlap at all: the medians in `hpss.ts` and the loop in
 * `repeat.ts` look a little way either side of where they are, and near the edge
 * of a block there is nothing to look at. So each block is weakest exactly where
 * its neighbour is strongest, and the crossfade puts one over the other.
 */

import type { Progress } from './types.ts';
import { analyse, HOP, like, magnitudes, maskInto, SIZE, synthesise, type Spectra } from './stft.ts';

/**
 * How much is worked on at a time, and how much of it two blocks share.
 *
 * Sixteen seconds is chosen by what the measurements need rather than by what
 * fits. The loop finder wants several turns of the loop inside one block to take
 * a median across, and four bars at ninety beats a minute is ten seconds — so
 * sixteen holds a couple of them, and thirty two would only cost memory. The
 * half second of overlap is a little over twice the reach of the widest median,
 * which is what the crossfade has to cover.
 */
const BLOCK_SECONDS = 16;
const OVERLAP_SECONDS = 0.5;

/** One block of a recording, measured and ready to be divided. */
export interface Block {
  /** Which block this is, and how many there are, for reporting progress. */
  index: number;
  of: number;
  /** The samples it covers. */
  from: number;
  to: number;
  /** One spectrogram per channel. */
  specs: Spectra[];
  /**
   * How loud each cell is, averaged over the channels.
   *
   * One magnitude for the block rather than one per channel, so the three
   * measurements agree with each other and one mask goes onto both sides. A mask
   * applied unequally to two channels moves a sound rather than quietening it.
   */
  mag: Float32Array;
  frames: number;
  bins: number;
  rate: number;
}

/** Given a block, what share of each cell goes to each part. */
export type Divide = (block: Block) => Float32Array[];

/**
 * How finely to look, when the default is the wrong answer.
 *
 * The default is a window of forty three milliseconds, which is the usual
 * compromise for music and is what the four-way split wants: long enough to tell
 * two notes a semitone apart, short enough that a snare is an event rather than a
 * smear.
 *
 * Following a held line wants the other trade. At forty three milliseconds the
 * bins are twenty three hertz apart, which around a hundred and fifty hertz is
 * nearly two semitones — so every pitch across two semitones lands in the same
 * bins, the evidence for all of them is identical, and which one is picked is
 * decided by noise. Measured, a steady tone at 150 hertz came back as a line
 * wandering between 82 and 175. A window four times longer puts the bins six
 * hertz apart, and the line holds.
 */
export interface HowFinely {
  size: number;
  hop: number;
}

/**
 * Take a recording apart in blocks, into as many parts as `divide` returns.
 *
 * Yields to the browser between blocks, which is what stops a minute of work
 * from freezing the page for a minute.
 */
export async function inBlocks(
  input: AudioBuffer,
  channels: number,
  parts: number,
  divide: Divide,
  onStep?: Progress,
  what = 'separating',
  finely: HowFinely = { size: SIZE, hop: HOP },
): Promise<AudioBuffer[]> {
  const rate = input.sampleRate;
  const length = input.length;
  const source: Float32Array[] = [];
  for (let c = 0; c < channels; c++) source.push(input.getChannelData(c));

  const outs: AudioBuffer[] = [];
  const lanes: Float32Array[][] = [];
  for (let p = 0; p < parts; p++) {
    const buffer = new AudioBuffer({ numberOfChannels: channels, length, sampleRate: rate });
    outs.push(buffer);
    const own: Float32Array[] = [];
    for (let c = 0; c < channels; c++) own.push(buffer.getChannelData(c));
    lanes.push(own);
  }
  if (!parts) return outs;

  /*
   * Whole windows, so every block's frames land on the same grid.
   *
   * A block is analysed from its own first sample, so frame f of a block that
   * starts partway through a window covers a different stretch of time from
   * frame f of the one before it. Rounding the block and the overlap to whole
   * hops makes the grids line up, which is what lets a caller talk about "frame
   * 400 of the recording" and mean the same thing in every block. `refine.ts`
   * relies on it.
   */
  const hop = finely.hop;
  const blockLength = Math.min(length, Math.round((BLOCK_SECONDS * rate) / hop) * hop);
  const fade = Math.max(
    hop,
    Math.min(Math.round((OVERLAP_SECONDS * rate) / hop) * hop, Math.floor(blockLength / 4 / hop) * hop),
  );
  const stride = Math.max(hop, blockLength - fade);

  /*
   * Where each block starts, worked out in one go.
   *
   * Counted up to the block that reaches the end rather than stepping until the
   * recording runs out. Stepping leaves a last block half a second long, whose
   * spectrogram is one window and whose medians see nothing either side — and it
   * lands on the fade, where a weak answer does the most harm.
   */
  const starts = [0];
  while (starts[starts.length - 1] + blockLength < length) {
    starts.push(starts[starts.length - 1] + stride);
  }

  for (const [index, from] of starts.entries()) {
    onStep?.(index, starts.length, what);
    const to = Math.min(length, from + blockLength);

    const specs = source.map((lane) => analyse(lane.subarray(from, to), finely.size, finely.hop));
    const { frames, bins } = specs[0];
    const cells = frames * bins;

    const mag = new Float32Array(cells);
    for (const spec of specs) {
      const one = magnitudes(spec);
      for (let i = 0; i < cells; i++) mag[i] += one[i];
    }
    if (channels > 1) for (let i = 0; i < cells; i++) mag[i] /= channels;

    const masks = divide({ index, of: starts.length, from, to, specs, mag, frames, bins, rate });

    const scratch = like(specs[0]);
    const risesFor = index > 0 ? fade : 0;
    const fallsFrom = index < starts.length - 1 ? stride : -1;
    for (let p = 0; p < parts; p++) {
      const mask = masks[p];
      for (let c = 0; c < channels; c++) {
        maskInto(specs[c], mask, scratch);
        addRamped(lanes[p][c], synthesise(scratch), from, risesFor, fallsFrom, fade);
      }
    }

    await new Promise((wake) => setTimeout(wake, 0));
  }

  onStep?.(starts.length, starts.length, what);
  return outs;
}

/**
 * Add a block's audio in, faded in and out where it meets its neighbours.
 *
 * `risesFor` is nought on the first block and `fallsFrom` is negative on the
 * last, since neither of those has a neighbour on that side to hand over to.
 */
function addRamped(
  into: Float32Array,
  block: Float32Array,
  start: number,
  risesFor: number,
  fallsFrom: number,
  fallsFor: number,
): void {
  for (let i = 0; i < block.length; i++) {
    const at = start + i;
    if (at >= into.length) break;
    let weight = 1;
    if (risesFor > 0 && i < risesFor) weight = i / risesFor;
    if (fallsFrom >= 0 && i >= fallsFrom) weight = Math.max(0, 1 - (i - fallsFrom) / fallsFor);
    into[at] += block[i] * weight;
  }
}

/** Total energy, which is what every share a part reports is a share of. */
export function energyOf(buffer: AudioBuffer, channels = buffer.numberOfChannels): number {
  let sum = 0;
  for (let c = 0; c < Math.min(channels, buffer.numberOfChannels); c++) {
    const lane = buffer.getChannelData(c);
    for (let i = 0; i < lane.length; i++) sum += lane[i] * lane[i];
  }
  return sum;
}
