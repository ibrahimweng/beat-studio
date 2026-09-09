import { describe, expect, it } from 'vitest';
import { mix, RATE } from '../../../test/mixes.ts';
import { KIT_SOUNDS } from '../../constants.ts';
import { renderVoice, seedFrom } from '../voice-spec.ts';
import { kitSpec } from '../voices.ts';
import { drumHits, type DrumKind } from './hits.ts';

/**
 * Finding the hits in a drum part.
 *
 * Measured against this app's own drum kit, which is the closest thing to ground
 * truth available without a labelled recording: the app knows exactly what it made
 * and when. What that does not tell anybody is how this does on a recorded kit, and
 * the note in `kindOf` is straight about the two places it will go wrong there.
 *
 * The two tests worth having are the last two. One hit reported as one hit is what
 * a cymbal broke — eleven hits for one crash, all of them its own tail. And a kick
 * and a hat together reported as two hits is the whole reason this file exists
 * rather than `listen.ts` being called with different numbers.
 */

const SECONDS = 4;

/** One kit voice at a list of times. */
async function played(pad: string, at: readonly number[]): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(RATE * SECONDS), RATE);
  for (const time of at) {
    // A seed per voice rather than per hit, so every kick is the same kick, which
    // is what a programmed pattern is.
    renderVoice(ctx, ctx.destination, kitSpec(pad as never, 1), time, seedFrom(pad));
  }
  /*
   * Copied out of the buffer, which is not tidiness.
   *
   * `getChannelData` here is a view onto memory the Rust binding owns, and it
   * stays valid only while its AudioBuffer is alive. Written as one expression
   * the buffer is unreachable the moment the view exists, so a later render is
   * free to take its allocation — and the view then reads whatever is in that
   * memory now. Measured: the reference signals came back holding 3.3e+63,
   * which is uninitialised bytes read as floats, but only when this file ran
   * alongside another that also renders. `render.test.ts` has the long version
   * of this note and the same trap.
   */
  return Float32Array.from((await ctx.startRendering()).getChannelData(0));
}

/** Which family each voice of the kit belongs to. */
const FAMILY: Record<string, DrumKind> = {
  kick: 'kick',
  kick2: 'kick',
  snare: 'snare',
  hhc: 'hat',
  hho: 'hat',
  tom1: 'tom',
  tom2: 'tom',
  tom3: 'tom',
  floor: 'tom',
  crash1: 'cymbal',
  crash2: 'cymbal',
  splash: 'cymbal',
  ride: 'cymbal',
};

describe('finding one hit', () => {
  /*
   * One strike is one hit, and it is named right.
   *
   * Both halves of that were broken at once and for different reasons, which is
   * why they are checked together. A crash came back as eleven hits, because the
   * noise in its own decay rises again and again; a kick came back as a snare,
   * because the shares of the spectrum were read over the first forty
   * milliseconds and the front of a kick is a beater click.
   */
  it('reports one hit per strike, in the right family', async () => {
    for (const { pad } of KIT_SOUNDS) {
      // Half a second in, so there is something before the hit for the finder to
      // compare it against.
      const hits = drumHits(await played(pad, [0.5]), RATE);
      expect(hits.length, `${pad} came back as ${hits.length} hits`).toBe(1);
      expect(hits[0].kind, `${pad} was called a ${hits[0].kind}`).toBe(FAMILY[pad]);
      expect(hits[0].at).toBeCloseTo(0.5, 1);
    }
  }, 120_000);
});

describe('finding hits in a pattern', () => {
  /*
   * A hat shortly after a snare is a hat.
   *
   * `listen.ts` treats a rise soon after a bigger one as part of that one, which
   * is right for a recording of a single sound and wrong for a beat: it found ten
   * of these fourteen, and every one it missed was a hat a quarter of a second
   * after a snare. Looking in three bands separately is what recovers them, since
   * a hat is a large rise in the top of the spectrum whatever the snare did in the
   * middle.
   */
  it('finds every hit in a plain beat', async () => {
    const both = mix(
      await played('kick', [0.25, 1.25, 2.25, 3.25]),
      await played('snare', [0.75, 1.75, 2.75]),
      await played('hhc', [0.5, 1, 1.5, 2, 2.5, 3, 3.5]),
    );
    const hits = drumHits(both, RATE);
    expect(hits).toHaveLength(14);

    const counted = (kind: DrumKind): number => hits.filter((hit) => hit.kind === kind).length;
    expect(counted('kick')).toBe(4);
    expect(counted('snare')).toBe(3);
    expect(counted('hat')).toBe(7);
  }, 120_000);

  /*
   * A kick and a hat on the same eighth are two hits.
   *
   * The most common thing in a beat, and the thing a finder working on the whole
   * spectrum cannot see: one rise, one hit, one file, both drums in it. Two bands
   * rising at one moment is two hits, and the shares of the spectrum are what stop
   * that turning a snare — loud in the middle and loud in the top at the same
   * instant — into a snare and a hat as well.
   */
  it('finds a kick and a hat played together as two hits', async () => {
    const both = mix(await played('kick', [0.5, 1.5]), await played('hhc', [0.5, 1.5]));
    const hits = drumHits(both, RATE);
    expect(hits).toHaveLength(4);
    expect(hits.filter((hit) => hit.kind === 'kick')).toHaveLength(2);
    expect(hits.filter((hit) => hit.kind === 'hat')).toHaveLength(2);
    // At the same moment, which is the part that matters.
    expect(hits[0].at).toBeCloseTo(hits[1].at, 2);
  }, 120_000);

  it('finds nothing in silence', () => {
    expect(drumHits(new Float32Array(RATE), RATE)).toEqual([]);
  });

  it('finds nothing in a signal too short to measure', () => {
    expect(drumHits(new Float32Array(100), RATE)).toEqual([]);
  });
});
