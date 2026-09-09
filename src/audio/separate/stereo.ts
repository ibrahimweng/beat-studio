/**
 * Where a sound sits between the speakers, cell by cell.
 *
 * A mix is not only a pile of sounds, it is a pile of sounds in places. The
 * lead vocal is in the middle, the kick and the bass are in the middle, and
 * almost everything else has been moved off to one side or spread out. That
 * is a decision somebody made at the desk, and it is the second thing after
 * hit-or-note that can be read straight off a recording without knowing
 * anything about what is playing.
 *
 * So each cell is asked how centred it is. Two channels that agree in level
 * and in phase are one source in the middle. Two that disagree are either two
 * different sources or one source pushed to a side, and either way it is not
 * the thing in the middle.
 *
 * What this buys, honestly stated. On a stereo mix it pulls the centre out
 * well enough to be worth having, which usually means the lead — the vocal,
 * or whatever is carrying the tune. What it does not do is separate two
 * sources that happen to sit in the same place, and the kick and the bass and
 * the vocal are all in the same place, which is why this is one of four
 * measurements rather than the whole answer.
 *
 * On a mono file it says nothing at all, and says so rather than returning a
 * confident number: two identical channels are perfectly centred everywhere,
 * which is true and useless. {@link centreMask} reports that, and the caller
 * leans on the repeating-pattern measurement instead.
 */

/**
 * How sharply centre is distinguished from nearly-centre.
 *
 * The raw measurement is a proportion and it is generous: a source panned
 * three quarters of the way to one side still reads about seven tenths
 * centred, because most of its energy is still shared. Raising it to a power
 * is what turns "mostly shared" into "not the thing in the middle", and three
 * was chosen by ear against real mixes — at one the whole mix reads as
 * centre, at six a vocal that is not perfectly placed falls out of it.
 */
const SHARPNESS = 3;

/** Two channels are called one channel below this much difference. */
const MONO_AT = 1e-4;

export interface CentreResult {
  /**
   * How much of each cell is the thing in the middle, nought to one.
   *
   * All ones when there is nothing to measure, which is what a mono file
   * gives — see `centred` below before using it.
   */
  mask: Float32Array;
  /**
   * Whether the recording had two different channels to compare at all.
   *
   * False for a mono file, and for a stereo file whose two channels are the
   * same recording twice, which is common and looks like stereo from outside.
   */
  centred: boolean;
  /** How far apart the two channels are overall, nought to one. */
  width: number;
}

/**
 * Read how centred every cell is.
 *
 * The measurement is twice the real part of one channel against the other's
 * conjugate, over the power in both. Written out: two channels carrying the
 * same thing at the same level and the same phase give one; a cell with
 * energy in only one channel gives nought; two unrelated things give about
 * nought, since their phases wander; and something in the middle but with its
 * phase flipped between the sides gives less than nought, which is clamped
 * away, because whatever that is it is not a source in the middle.
 *
 * Taking the real part rather than the size of the product is the whole of
 * that last case. Using the size was tried and it calls a phase-inverted
 * centre perfectly centred, which is exactly wrong: an inverted channel is
 * the one thing in a mix that has no place at all.
 */
export function centreMask(
  left: { re: Float32Array; im: Float32Array },
  right: { re: Float32Array; im: Float32Array },
  cells: number,
): CentreResult {
  const mask = new Float32Array(cells);

  let apart = 0;
  let together = 0;
  for (let i = 0; i < cells; i++) {
    const lr = left.re[i];
    const li = left.im[i];
    const rr = right.re[i];
    const ri = right.im[i];

    const power = lr * lr + li * li + rr * rr + ri * ri;
    // The real part of left times the conjugate of right.
    const agreeing = lr * rr + li * ri;
    const share = power > 1e-20 ? (2 * agreeing) / power : 0;
    mask[i] = Math.pow(Math.min(1, Math.max(0, share)), SHARPNESS);

    apart += (lr - rr) * (lr - rr) + (li - ri) * (li - ri);
    together += power;
  }

  const width = together > 1e-20 ? Math.min(1, Math.sqrt(apart / together)) : 0;
  if (width < MONO_AT) {
    // Nothing to say. All ones is the truthful answer to the question asked
    // and the wrong thing to divide a mix with, so it is flagged rather than
    // quietly used.
    mask.fill(1);
    return { mask, centred: false, width: 0 };
  }
  return { mask, centred: true, width };
}
