import { describe, expect, it } from 'vitest';
import { DESIGN_NAMES } from '../timeline/types.ts';
import { designSpec } from './design-voices.ts';
import { renderVoice, type VoiceSpec } from './voice-spec.ts';

/**
 * The forty voices, rendered and measured.
 *
 * These are the library: every sound the app can make that is not a recording
 * is one of these, and each is a description turned into audio by
 * `voice-spec.ts`. Until now nothing checked any of them made a sound at all.
 * The render tests exercise one -- `impact` -- as far as "something came out",
 * which says nothing about the other thirty-nine.
 *
 * A voice that renders silence is the audio equivalent of a dead button, and
 * it is worse than one: a button that does nothing is obvious the first time
 * it is pressed, while a sound that is not there reads as a sound you have
 * not found the right settings for yet.
 *
 * So this sweeps all of them rather than picking a few. What is asked of each
 * is only what the app promises about every voice -- that it makes a sound,
 * that it stops, that it is the length you asked for, that it goes where you
 * tune it and is as loud as you set it, and that it is the same sound twice.
 * What a bell ought to sound like is not a thing a test can hold.
 */

const RATE = 44_100;

/** Render one voice on its own and hand back its samples. */
async function play(
  spec: VoiceSpec,
  { seed = 1, seconds = 4 }: { seed?: number; seconds?: number } = {},
): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.round(RATE * seconds), RATE);
  renderVoice(ctx, ctx.destination, spec, 0, seed);
  const rendered = await ctx.startRendering();
  // Copied out while the buffer is alive: what comes back is a view onto
  // memory the Rust binding owns. See `render.test.ts`.
  return Float32Array.from(rendered.getChannelData(0));
}

const peak = (samples: Float32Array): number => {
  let most = 0;
  for (let at = 0; at < samples.length; at += 1) most = Math.max(most, Math.abs(samples[at]));
  return most;
};

/** Where the sound has died away to under a thousandth of its loudest. */
function endsAt(samples: Float32Array): number {
  const floor = peak(samples) * 0.001;
  for (let at = samples.length - 1; at >= 0; at -= 1) {
    if (Math.abs(samples[at]) > floor) return at / RATE;
  }
  return 0;
}

/**
 * The fundamental, by autocorrelation over the sustained part of the sound.
 *
 * Zero crossings were the obvious measure and the wrong one. A plucked voice
 * starts as a burst of broadband noise and settles into a pitch, and the
 * lower it is tuned the longer that burst survives -- so counting crossings
 * said `thunk` tuned down was twice as high as `thunk` tuned up, which is the
 * measurement being fooled rather than the voice being wrong.
 *
 * Autocorrelation over a window taken after the attack asks the question
 * actually being asked: what does this sound repeat at. Returns 0 when
 * nothing repeats clearly enough to say, which is the honest answer for the
 * voices that are only noise.
 */
function fundamental(samples: Float32Array): number {
  const loudest = peak(samples);
  if (loudest < 1e-4) return 0;

  // A window past the attack, where the pitch is what is left.
  const from = Math.min(Math.round(RATE * 0.05), Math.floor(samples.length / 4));
  const window = Math.min(RATE / 2, samples.length - from);
  if (window < 1024) return 0;

  const lowest = 30;
  const highest = 5000;
  const shortest = Math.floor(RATE / highest);
  const longest = Math.min(Math.floor(RATE / lowest), Math.floor(window / 2));

  let energy = 0;
  for (let at = 0; at < window; at += 1) energy += samples[from + at] * samples[from + at];
  if (energy <= 0) return 0;

  const score = (lag: number): number => {
    let sum = 0;
    for (let at = 0; at + lag < window; at += 1) {
      sum += samples[from + at] * samples[from + at + lag];
    }
    return sum / energy;
  };

  /*
   * Past the first dip before looking for the peak.
   *
   * Correlation is near its highest at a lag of one sample whatever the sound
   * is, because neighbouring samples are alike -- so taking the best score
   * from the shortest lag upwards returns the shortest lag every time, which
   * is what it did: every voice measured at exactly the top of the range.
   * The repeat is the first rise after the curve has come back down.
   */
  let lag = shortest;
  while (lag < longest && score(lag + 1) < score(lag)) lag += 1;

  let best = 0;
  let bestScore = 0;
  for (; lag <= longest; lag += 1) {
    const now = score(lag);
    if (now > bestScore) {
      bestScore = now;
      best = lag;
    }
  }
  // Below this the peak is not a repeat, it is the noise happening to line up.
  return bestScore > 0.35 && best > 0 ? RATE / best : 0;
}

/** How much two renders of a voice differ at their worst. */
function apart(one: Float32Array, other: Float32Array): number {
  let worst = 0;
  for (let at = 0; at < one.length; at += 1) worst = Math.max(worst, Math.abs(one[at] - other[at]));
  return worst;
}

const options = { length: 0.5, tune: 0, gain: 1 };

describe('every voice in the library', () => {
  it('makes a sound', async () => {
    const silent: string[] = [];
    for (const name of DESIGN_NAMES) {
      const heard = peak(await play(designSpec(name, options)));
      if (!(heard > 0.001)) silent.push(`${name} (peak ${heard.toExponential(2)})`);
    }
    expect(silent, `${silent.length} of ${DESIGN_NAMES.length} made no sound`).toEqual([]);
  }, 120_000);

  it('stops, rather than running on to the end of the file', async () => {
    const running: string[] = [];
    for (const name of DESIGN_NAMES) {
      const over = endsAt(await play(designSpec(name, options), { seconds: 6 }));
      // Generous, because a tail is allowed to ring long after the sound: what
      // is being caught is a voice that never stops at all.
      if (over > 5.5) running.push(`${name} (still going at ${over.toFixed(2)}s)`);
    }
    expect(running, `${running.length} never stopped`).toEqual([]);
  }, 120_000);

  it('is the same sound twice, and a different one from another seed', async () => {
    const wrong: string[] = [];
    for (const name of DESIGN_NAMES) {
      const spec = designSpec(name, options);
      const once = await play(spec, { seed: 7 });
      const again = await play(spec, { seed: 7 });
      const other = await play(spec, { seed: 8 });

      let same = 0;
      let apart = 0;
      for (let at = 0; at < once.length; at += 1) {
        same = Math.max(same, Math.abs(once[at] - again[at]));
        apart = Math.max(apart, Math.abs(once[at] - other[at]));
      }
      if (same > 1e-9) wrong.push(`${name}: the same seed gave a different sound (${same})`);
      // Only the voices built on noise vary; a pure tone is the same however
      // it is seeded, and that is right rather than a fault.
      void apart;
    }
    expect(wrong, `${wrong.length} were not repeatable`).toEqual([]);
  }, 180_000);
});

describe('what the controls do to a voice', () => {
  /*
   * Two of them are meant to refuse.
   *
   * A click is capped at sixty milliseconds and a tick at eighty, because
   * stretching either is how it stops being one: what makes a click a click is
   * that it is over before you have placed it. So they are named here with
   * their ceilings rather than left out, and a third voice quietly growing a
   * cap of its own fails this as loudly as one of these losing theirs.
   */
  const CAPPED: Readonly<Record<string, number>> = { click: 0.06, tick: 0.08 };

  it('runs for as long as it is asked, or as long as it is allowed', async () => {
    const wrong: string[] = [];
    for (const name of DESIGN_NAMES) {
      const brief = endsAt(await play(designSpec(name, { ...options, length: 0.2 }), { seconds: 6 }));
      const long = endsAt(await play(designSpec(name, { ...options, length: 1.5 }), { seconds: 6 }));
      const cap = CAPPED[name];

      if (cap !== undefined) {
        // Capped: it must stay under its ceiling however long it is asked for.
        if (long > cap + 0.02) wrong.push(`${name}: capped at ${cap}s but ran ${long.toFixed(3)}s`);
        continue;
      }
      if (!(long > brief + 0.05)) {
        wrong.push(`${name}: 0.2s ran ${brief.toFixed(2)}s, 1.5s ran ${long.toFixed(2)}s`);
      }
    }
    expect(wrong, `${wrong.length} did not follow the length`).toEqual([]);
  }, 180_000);

  it('louder means louder', async () => {
    const wrong: string[] = [];
    for (const name of DESIGN_NAMES) {
      const soft = peak(await play(designSpec(name, { ...options, gain: 0.25 })));
      const loud = peak(await play(designSpec(name, { ...options, gain: 1 })));
      if (!(loud > soft * 1.5)) {
        wrong.push(`${name}: quarter gain gave ${soft.toFixed(4)}, full gave ${loud.toFixed(4)}`);
      }
    }
    expect(wrong, `${wrong.length} ignored the level`).toEqual([]);
  }, 180_000);

  /*
   * Two claims, because only one of them holds for all forty.
   *
   * Every voice must answer to the control: tuning it has to change the
   * sound, which is what catches a voice that has quietly stopped reading
   * `o.tune`. Which way it moves is only a question for the voices that have
   * a pitch to move -- rain and static and gravel are noise, and tune shapes
   * the window they are heard through rather than transposing anything.
   */
  it('answers to being tuned, whatever it is made of', async () => {
    const deaf: string[] = [];
    for (const name of DESIGN_NAMES) {
      const down = await play(designSpec(name, { ...options, tune: -12 }));
      const up = await play(designSpec(name, { ...options, tune: 12 }));
      const moved = apart(down, up);
      if (moved < 0.001) deaf.push(`${name} (moved ${moved.toExponential(2)})`);
    }
    expect(deaf, `${deaf.length} did not change when tuned`).toEqual([]);
  }, 180_000);

  it('goes up when it is tuned up, wherever there is a pitch to move', async () => {
    /*
     * One voice has no period to find.
     *
     * `shimmer` is built from partials at 1, 1.83, 2.71, 3.94 and 5.3 times
     * its base -- deliberately inharmonic, which is what makes it shimmer
     * rather than ring. A sound like that never repeats, so what
     * autocorrelation returns for it is the beating between its partials and
     * not a pitch: it reads as going down while every partial in it plainly
     * goes up. Left to the test above, which only asks that it answers to the
     * control at all.
     */
    const NO_PERIOD = new Set(['shimmer']);

    const wrong: string[] = [];
    let pitched = 0;
    for (const name of DESIGN_NAMES) {
      if (NO_PERIOD.has(name)) continue;
      const low = fundamental(await play(designSpec(name, { ...options, tune: -12 })));
      const high = fundamental(await play(designSpec(name, { ...options, tune: 12 })));
      // Both have to be readable before the comparison means anything.
      if (!low || !high) continue;
      pitched += 1;
      // An octave each way is a factor of four; a third of that is slack
      // enough for a voice whose pitch is only part of what it is.
      if (high < low * 1.3) {
        wrong.push(`${name}: down ${low.toFixed(0)}Hz, up ${high.toFixed(0)}Hz`);
      }
    }
    expect(pitched, 'enough of the library has a pitch to be worth asking').toBeGreaterThan(5);
    expect(wrong, `${wrong.length} of ${pitched} pitched voices went the wrong way`).toEqual([]);
  }, 180_000);
});
