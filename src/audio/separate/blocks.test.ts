import { describe, expect, it } from 'vitest';
import { inBlocks, type Divide } from './blocks.ts';

/**
 * Joining the blocks back into one recording.
 *
 * A recording is taken apart sixteen seconds at a time, and every test beside
 * this one is shorter than that — so they all run in a single block and none of
 * them says anything about the join. This is the file that does.
 *
 * The join is where two separate things have to be true at once. The two blocks
 * either side of it are faded into each other by ramps that add to one, so the
 * overlap is the sum of two half-strength copies and not a seam. And a part is
 * written out as each stretch of it becomes final rather than kept whole, so the
 * sliding window has to hand over exactly the samples nothing can still add to —
 * one sample early and the crossfade is written half-finished, one sample late
 * and it is written twice.
 *
 * Eight kilohertz, which is not a rate anybody would use for music. It is here
 * because a block is sixteen seconds of whatever rate it is given, so this gets
 * three real blocks out of a hundred and twenty thousand samples instead of the
 * two million the same test would need at forty eight. The arithmetic being
 * checked counts samples and does not know the difference.
 */
const RATE = 8000;
const SECONDS = 40;

/** A signal with something going on at every moment, so a gap would show. */
function material(): AudioBuffer {
  const length = RATE * SECONDS;
  const out = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: RATE });
  const left = out.getChannelData(0);
  const right = out.getChannelData(1);
  for (let i = 0; i < length; i++) {
    const at = i / RATE;
    // A held tone, a slower one under it, and a click every half second.
    const tone = Math.sin(2 * Math.PI * 440 * at) * 0.3 + Math.sin(2 * Math.PI * 110 * at) * 0.2;
    const since = i % (RATE / 2);
    const click = since < 40 ? Math.exp(-since / 8) * 0.4 : 0;
    left[i] = tone + click;
    right[i] = tone * 0.8 - click;
  }
  return out;
}

/**
 * Divide every cell in a fixed ratio.
 *
 * Three tenths and seven tenths rather than half and half, so a part written
 * into the wrong lane, or a fade applied to one side and not the other, comes
 * out as a difference rather than cancelling.
 */
const inThirds: Divide = (block) => {
  const cells = block.frames * block.bins;
  return [new Float32Array(cells).fill(0.3), new Float32Array(cells).fill(0.7)];
};

describe('taking a recording in blocks', () => {
  it('needs more than one block for this to be worth asking', async () => {
    const seen: number[] = [];
    await inBlocks(material(), 2, 2, inThirds, (_done, of) => seen.push(of));
    expect(Math.max(...seen)).toBeGreaterThan(2);
  }, 60_000);

  /*
   * The parts add back up across the joins, not only within a block.
   *
   * Shares that add to one at every cell, a transform that gives back what it
   * was given, and two ramps that add to one — the same three things `dsp.ts`
   * relies on, asked here over a recording long enough to have joins in it.
   */
  it('joins its blocks back into the recording it was given', async () => {
    const input = material();
    const parts = await inBlocks(input, 2, 2, inThirds);
    // Read back once and held, since `getChannelData` is a view onto memory the
    // audio implementation owns and only valid while its buffer is alive.
    const read = parts.map((part) => part.samples());

    for (let c = 0; c < 2; c++) {
      const was = input.getChannelData(c);
      const lanes = read.map((one) => one.getChannelData(c));
      let worst = 0;
      let where = 0;
      for (let i = 0; i < was.length; i++) {
        const off = Math.abs(was[i] - (lanes[0][i] + lanes[1][i]));
        if (off > worst) {
          worst = off;
          where = i;
        }
      }
      expect(worst, `channel ${c} is out by ${worst} at ${(where / RATE).toFixed(2)}s`).toBeLessThan(
        1e-4,
      );
    }
  }, 60_000);

  /*
   * Nothing is dropped at the very end.
   *
   * The last block has no neighbour to hand over to, so it is the one stretch
   * the sliding window flushes for a different reason. A window that only ever
   * released what the next block could not reach would leave the tail of a
   * recording silent, and only a test that looks at the tail would notice.
   */
  it('writes the last stretch out as well as the joins', async () => {
    const input = material();
    const [first] = await inBlocks(input, 2, 2, inThirds);
    const read = first.samples();
    const lane = read.getChannelData(0);

    let sum = 0;
    for (let i = lane.length - RATE; i < lane.length; i++) sum += lane[i] * lane[i];
    expect(sum, 'the last second of the first part is silent').toBeGreaterThan(0);
  }, 60_000);

  it('gives every part the length, the rate and the channels it was given', async () => {
    const input = material();
    const parts = await inBlocks(input, 2, 3, inThirds3);
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part.length).toBe(input.length);
      expect(part.rate).toBe(RATE);
      expect(part.channels).toBe(2);
    }
  }, 60_000);

  it('asks for no parts and gives none back', async () => {
    expect(await inBlocks(material(), 2, 0, inThirds)).toEqual([]);
  });
});

/** Three shares that still add to one, for the test that counts parts. */
const inThirds3: Divide = (block) => {
  const cells = block.frames * block.bins;
  return [
    new Float32Array(cells).fill(0.2),
    new Float32Array(cells).fill(0.3),
    new Float32Array(cells).fill(0.5),
  ];
};
