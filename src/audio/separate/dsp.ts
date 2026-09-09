/**
 * Taking a mix apart with measurements rather than with a model.
 *
 * Four parts — the drums, the bass, whatever is in front, and the rest — out of
 * three readings of the same spectrogram. `hpss.ts` says whether each cell is a
 * hit or a note. `stereo.ts` says how centred it is. `repeat.ts` says whether it
 * is part of the loop. Between them those three answer the question this file
 * asks of every cell: which of the four does this belong to, and how much of it.
 *
 * Being straight about what this is.
 *
 * It is not a trained model and it will not do what one does. Demucs and its
 * relatives learned what a snare and a violin sound like from thousands of hours
 * of music, and they are better at this than arithmetic is — but they are tens of
 * millions of numbers that have to be fetched, and everything else in this app is
 * a promise that nothing is uploaded and nothing is downloaded. So this is the
 * honest version of the feature: measurements anybody can read, running on the
 * machine, on material they have never seen, with no weights and no network.
 *
 * What that buys is genuinely useful and genuinely limited. The drums come out
 * well, because a hit and a note look nothing like each other and a median knows
 * it. The bass comes out well enough, because it is mostly the low end of what is
 * left. A centred lead comes out usable on a stereo mix. What does not happen is
 * two instruments sitting in the same place and the same register coming apart —
 * a violin out from under a viola is not something this can do, and no amount of
 * tuning will make it. `tools/separate-check.html` measures all of it and the
 * README says the numbers.
 *
 * The one property that is exact: the four parts add back up to the recording,
 * sample for sample. Every cell is divided between them by four shares that add
 * to one, the round trip in `stft.ts` loses nothing, and the blocks are joined by
 * weights that add to one. There is no residue and nothing is counted twice.
 */

import { energyOf, inBlocks, type Block } from './blocks.ts';
import { percussiveMask } from './hpss.ts';
import { refineDrums, refineTonal } from './refine.ts';
import { repeatingMask } from './repeat.ts';
import { centreMask } from './stereo.ts';
import { binHz } from './stft.ts';
import {
  PARTS,
  type PartId,
  type Progress,
  type SeparateOptions,
  type Separation,
  type Refinable,
  type Separator,
  type StemPart,
} from './types.ts';

/**
 * The longest recording this will take on.
 *
 * Not arbitrary, and it moved, and the ceiling did not — what moved is what a
 * minute costs to reach it.
 *
 * Measured, by separating thirty seconds and ninety and taking the difference,
 * so that the part which grows is separated from the part which does not:
 *
 *   peak = 111 MB, plus 90 MB for every minute of forty eight kilohertz stereo
 *
 * The fixed 111 megabytes is one block's spectrograms and masks, which is the
 * same whether the recording is a minute or an hour. The 90 is 15.6 bytes for
 * every sample of every channel, and it is exactly what the arithmetic says it
 * should be: four bytes for the recording itself, and twelve for the four parts
 * at twenty four bits.
 *
 * It used to be 180 a minute, because the parts were built as whole lanes of
 * floating point — sixteen bytes rather than twelve — and then encoded, so both
 * existed at once for another twelve. Eight minutes came to about 1.5 gigabytes,
 * which is where a browser tab stops allocating rather than getting slower, and
 * failing halfway through loses the work. Parts are now written as they are
 * made, one block at a time: see `written.ts`. The same wall at half the cost a
 * minute is twice as far away, so eight minutes becomes sixteen.
 *
 * Refusing up front and saying why is still better than failing halfway.
 */
const LONGEST_SECONDS = 16 * 60;

/** Above this it is worth saying how long it will take before starting. */
export const LONG_SECONDS = 45;

/**
 * Roughly how long separating will take, in seconds.
 *
 * The work is a fixed number of medians and transforms per second of audio, so
 * it runs at a steady rate and a real answer is available before it starts.
 * Measured at about a fifth of the length of the recording. Worth saying out
 * loud, because a percentage on its own does not answer the question somebody
 * actually has, which is whether to wait or go and do something else.
 */
export function expectedSeconds(duration: number): number {
  return Math.max(1, duration * 0.2);
}

/** Where the bass gives way to everything else, and how wide the handover is. */
const BASS_TO = 220;
const BASS_SPAN = 2.2;

/** What each of the four is, said once. */
const ABOUT: Record<PartId, string> = {
  drums: 'Everything that arrives and stops: the kit, and anything struck',
  bass: 'The low end of what is left once the drums are out of it',
  lead: 'What is in front — centred in the mix, and not part of the loop',
  tonal: 'Everything else that is held rather than struck',
};

const NAMES: Record<PartId, string> = {
  drums: 'Drums',
  bass: 'Bass',
  lead: 'Lead',
  tonal: 'Tonal',
};

/**
 * The separator this app ships with.
 *
 * Exported as one object satisfying {@link Separator} so that the screen and the
 * session never name this file. That is the seam: a different way of separating a
 * recording is a different object here, and nothing above changes.
 */
export const measured: Separator = {
  id: 'measured',
  name: 'Measured',
  about:
    'Reads the recording and divides it, rather than recognising instruments. ' +
    'Nothing is uploaded, nothing is downloaded, and it works offline. Drums ' +
    'come out well; a centred lead comes out usable on a stereo mix; two ' +
    'instruments in the same place and the same register do not come apart.',
  separate,
  refine,
};

async function separate(
  input: AudioBuffer,
  options: SeparateOptions = {},
  onStep?: Progress,
): Promise<Separation> {
  const started = Date.now();
  if (input.duration > LONGEST_SECONDS) {
    throw new Error(
      `that recording is ${Math.round(input.duration / 60)} minutes long, and ` +
        `${LONGEST_SECONDS / 60} is as much as this can hold at once`,
    );
  }

  const rate = input.sampleRate;
  // Two channels at most, which is what everything downstream writes.
  const channels = Math.min(2, input.numberOfChannels);

  /*
   * What the measurements found, kept as the strongest reading across the
   * blocks.
   *
   * One number is wanted for the recording, and a block that happens to fall on
   * a quiet passage has no loop in it and nothing to read a position from. So
   * the block that had the most to say is the one that gets reported, rather
   * than an average over blocks that were not all looking at music.
   */
  let loop: number | null = null;
  let loopStrength = 0;
  let stereo = false;
  let width = 0;

  const audio = await inBlocks(
    input,
    channels,
    PARTS.length,
    (block) => {
      const read = divide(block, channels, options);
      if (read.loop !== null && read.loopStrength > loopStrength) {
        loop = read.loop;
        loopStrength = read.loopStrength;
      }
      if (read.stereo) {
        stereo = true;
        width = Math.max(width, read.width);
      }
      return read.masks;
    },
    onStep,
  );

  const total = energyOf(input, channels);
  const parts: StemPart[] = PARTS.map((id, at) => ({
    id,
    name: NAMES[id],
    about: ABOUT[id],
    under: null,
    audio: audio[at],
    share: total > 0 ? audio[at].energy / total : 0,
  }));

  return {
    by: measured.id,
    rate,
    length: input.length,
    channels,
    parts,
    notes: { loop, loopStrength, stereo, width, took: (Date.now() - started) / 1000 },
  };
}

/**
 * One block, read three ways and turned into four shares of every cell.
 *
 * The four shares add to one at every cell by construction rather than by being
 * normalised afterwards: the hits take a share, the notes take the rest, and the
 * notes' share is then divided by frequency and by what is in front. Written
 * out, with P for the hits' share of a cell and H for the notes':
 *
 *     drums = P
 *     bass  = H × low
 *     lead  = H × (1 − low) × front
 *     tonal = H × (1 − low) × (1 − front)
 *
 * P + H is one, low + (1 − low) is one, and front + (1 − front) is one. There is
 * nowhere for a residue to hide.
 */
function divide(
  block: Block,
  channels: number,
  options: SeparateOptions,
): {
  masks: Float32Array[];
  loop: number | null;
  loopStrength: number;
  stereo: boolean;
  width: number;
} {
  const { specs, mag, frames, bins, rate } = block;
  const cells = frames * bins;

  const hits = percussiveMask(mag, frames, bins, { lean: options.lean ?? 0.5 });
  const loop =
    options.useLoop === false
      ? { mask: new Float32Array(cells), period: null, strength: 0 }
      : repeatingMask(mag, frames, bins, specs[0].hop / rate);
  const place =
    channels > 1
      ? centreMask(specs[0], specs[1], cells)
      : { mask: new Float32Array(cells), centred: false, width: 0 };

  const low = lowWeights(bins, specs[0].size, rate, options.bassTo ?? BASS_TO);
  const haveLoop = loop.period !== null;
  const havePlace = place.centred;

  const masks = PARTS.map(() => new Float32Array(cells));
  for (let f = 0; f < frames; f++) {
    const row = f * bins;
    for (let k = 0; k < bins; k++) {
      const i = row + k;
      const p = hits[i];
      const h = 1 - p;
      const lo = low[k];

      /*
       * How much of this cell is the thing in front, from whichever readings
       * there were.
       *
       * With both, it has to be centred and not part of the loop. With only one,
       * that one decides. With neither — a mono recording of music that never
       * repeats — there is no basis at all for telling a lead from the rest, so
       * nothing is claimed: the lead comes out empty and the notes go to the
       * tonal part whole. The alternative is to split them on something
       * invented, which would look like separation and be nothing of the kind.
       * The notes carry both facts so the screen can say which happened.
       */
      const front = havePlace
        ? haveLoop
          ? place.mask[i] * (1 - loop.mask[i])
          : place.mask[i]
        : haveLoop
          ? 1 - loop.mask[i]
          : 0;

      masks[0][i] = p;
      masks[1][i] = h * lo;
      masks[2][i] = h * (1 - lo) * front;
      masks[3][i] = h * (1 - lo) * (1 - front);
    }
  }

  return {
    masks,
    loop: loop.period,
    loopStrength: loop.strength,
    stereo: place.centred,
    width: place.width,
  };
}

/**
 * How much of each bin counts as the bass, on a raised cosine.
 *
 * A crossover rather than a line, and in octaves rather than in hertz, because
 * an octave is what a step in pitch is: spacing the handover evenly in hertz
 * puts nearly all of it in the top half of the range. All of a bin below the low
 * edge, none of it above the high edge, and a smooth handover between — a hard
 * line leaves an audible seam in both parts at exactly the frequency it was
 * drawn.
 */
export function lowWeights(bins: number, size: number, rate: number, to: number): Float32Array {
  const out = new Float32Array(bins);
  const from = to / BASS_SPAN;
  const until = to * BASS_SPAN;
  for (let k = 0; k < bins; k++) {
    const hz = binHz(k, size, rate);
    if (hz <= from) {
      out[k] = 1;
    } else if (hz >= until) {
      out[k] = 0;
    } else {
      const along = Math.log2(hz / from) / Math.log2(until / from);
      out[k] = 0.5 + 0.5 * Math.cos(Math.PI * along);
    }
  }
  return out;
}

/** Take one of the four further, or give back nothing when it cannot be. */
async function refine(
  part: Refinable,
  audio: AudioBuffer,
  _options: SeparateOptions = {},
  onStep?: Progress,
): Promise<StemPart[]> {
  if (part.id === 'drums') return refineDrums(part, audio, onStep);
  if (part.id === 'tonal' || part.id === 'lead') return refineTonal(part, audio, onStep);
  return [];
}
