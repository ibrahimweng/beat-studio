import { MAX_LENGTH, MIN_LENGTH, makeCue } from '../timeline/project.ts';
import { DESIGN_CHARACTER, DESIGN_NAMES } from '../timeline/types.ts';
import type { Cue, CuePreset, CueSource, DesignName } from '../timeline/types.ts';
import { alike, measure, ordinary, print, type Heard } from './listen.ts';
import { playCue } from './sources.ts';
import { nearest, PLACE_NAMES, SIZE_NAMES } from './vocabulary.ts';

/**
 * Making the nearest thing this app can make to a sound it heard.
 *
 * The honest statement of what this is: a search of the palette, not a
 * transcription. Forty synthesised voices cannot reproduce an arbitrary
 * recording, and nothing here pretends otherwise — what comes back is the
 * closest few things the app can build, and a number saying how alike each
 * one is. That number is not a verdict, and the note further down says why
 * there is no verdict to give.
 *
 * What you get is editable in a way a sample never is. A rebuilt hit is a
 * voice and five numbers, so it can be lengthened, tuned, put in a different
 * room and stacked, none of which a recording of it would allow.
 */

/** One way of making a sound that was heard. */
export interface Made {
  source: CueSource;
  preset: CuePreset;
  /**
   * How alike the rebuild and the recording are, from nothing at zero to the
   * same sound at one. Not a confidence: see the note in {@link rebuild}.
   */
  match: number;
  name: string;
}

/**
 * One sound out of a recording, and the ways of making it, closest first.
 *
 * Several rather than one, and that is not hedging. Measured against
 * recordings this app made itself — where the right answer is known — the
 * closest voice is the one that made it about a quarter of the time, and one
 * of the three closest about three quarters of the time. A search that is
 * right a quarter of the time and useful three quarters of the time should
 * hand you three and let you listen, not pick one and call it the answer.
 */
export interface Rebuilt extends Made {
  heard: Heard;
  /** The next best ways of making it, after this one. */
  also: readonly Made[];
}

/**
 * Candidates are rendered at the rate the app exports at.
 *
 * Half rate was tried, on the reasoning that fingerprints stop at ten
 * kilohertz so nothing either side of the comparison would notice. It is
 * three times faster and it recovers the right voice less often, because
 * several of the voices are built from filters that do not behave the same
 * way with the top of the band moved. Choosing correctly is worth more here
 * than choosing quickly.
 */
const RATE = 48000;

/** How many voices survive the first pass into the second. */
const SHORTLIST = 5;

/** How many ways of making it are offered in the end. */
const OFFERED = 3;

/** Semitones tried either side of what the brightness suggested. */
const TUNE_STEPS = [-4, 0, 4];

/** Rooms tried, on top of whatever the voice was born with. */
const SPACES = [0, 0.35, 0.7];

/**
 * How much better a stack has to be before it is worth having.
 *
 * A second voice can nearly always improve a fingerprint slightly, in the way
 * that any extra parameter can. It has to earn its place by a margin, or
 * every rebuild comes back as a stack of whatever the runners-up were.
 */
const STACK_GAIN = 0.02;

/** Told how far along it is, since this takes tens of seconds on a long file. */
export type Progress = (done: number, of: number) => void;

/**
 * Rebuild everything heard, closest first inside each sound.
 *
 * Two passes. The first asks which of the forty voices is even the right
 * shape, at the length that was measured and nothing else changed. The second
 * takes the few that came closest and looks around them — brighter, duller,
 * drier, wetter — which is worth doing for five voices and not for forty.
 */
export async function rebuild(
  heard: readonly Heard[],
  onStep?: Progress,
): Promise<Rebuilt[]> {
  const out: Rebuilt[] = [];
  for (let i = 0; i < heard.length; i++) {
    out.push(await one(heard[i]));
    onStep?.(i + 1, heard.length);
    // Back to the browser between sounds, so a long file does not lock the
    // page for the minute it takes.
    await new Promise((wake) => setTimeout(wake, 0));
  }
  return out;
}

async function one(heard: Heard): Promise<Rebuilt> {
  const length = Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, heard.length));

  // ---------- which voice is even the right shape ----------
  const first: { voice: DesignName; print: Float64Array; centroid: number }[] = [];
  for (const voice of DESIGN_NAMES) {
    const character = DESIGN_CHARACTER[voice];
    const made = await render({ voice, length, tune: 0, ...character, gain: 1 });
    first.push({ voice, print: made.print, centroid: made.centroid });
  }

  /*
   * What the whole palette has in common at this length, taken out of every
   * comparison from here on. Free, because these are the renders the coarse
   * pass had to do anyway, and without it the search is close to blind: every
   * voice scores about ninety per cent against every other one, because they
   * are all sounds. See `alike` in `listen.ts`.
   */
  const usual = ordinary(first.map((made) => made.print));
  const coarse = first
    .map((made) => ({ ...made, match: alike(heard.print, made.print, usual) }))
    .sort((a, b) => b.match - a.match);

  /*
   * There is no honest way to turn this into a confidence, and three were
   * tried.
   *
   * The similarity itself barely separates: a recording of a sound this app
   * made scores a middle of eighty four, and a sound it has no way of making
   * scores seventy two, with the ranges overlapping. Rescaling that between a
   * typical voice and a perfect one put the impossible sounds at seventy per
   * cent. Scoring how far the winner stood above the other thirty nine put
   * them at seventy two, the same as everything else.
   *
   * So the number stays what it is — a similarity, with the two ends of the
   * scale written down in `tools/README.md` — and the feature rests on
   * offering three and letting you listen, rather than on a percentage
   * pretending to have judged them.
   */

  // ---------- and then, for the few that were, what settings ----------
  /** The best this voice managed, whatever settings it took. */
  const bestOf = new Map<DesignName, Settings & { match: number }>();
  for (const near of coarse.slice(0, SHORTLIST)) {
    bestOf.set(near.voice, { ...asSettings(near.voice, length), match: near.match });

    /*
     * Where to look first, rather than searching the whole two octaves. A
     * voice's pitch and its brightness move together, so the ratio between
     * where this voice's weight sits and where the recording's sits is a
     * reasonable guess at the interval between them.
     */
    const guess =
      near.centroid > 0 && heard.centroid > 0
        ? Math.round(12 * Math.log2(heard.centroid / near.centroid))
        : 0;

    for (const step of TUNE_STEPS) {
      const tune = Math.max(-24, Math.min(24, guess + step));
      for (const space of SPACES) {
        const settings = {
          voice: near.voice,
          length,
          tune,
          space,
          drive: DESIGN_CHARACTER[near.voice].drive,
          gain: 1,
        };
        const made = await render(settings);
        const match = alike(heard.print, made.print, usual);
        if (match > (bestOf.get(near.voice)?.match ?? 0)) {
          bestOf.set(near.voice, { ...settings, match });
        }
      }
    }
  }

  const ranked = [...bestOf.values()].sort((a, b) => b.match - a.match);

  // ---------- would a second voice under the best one help ----------
  let best: (Settings & { match: number }) = ranked[0];
  let over: DesignName | null = null;
  for (const other of ranked.slice(1, SHORTLIST)) {
    const made = await render({ ...best, with: [other.voice] });
    const match = alike(heard.print, made.print, usual);
    if (match > best.match + STACK_GAIN) {
      best = { ...best, match };
      over = other.voice;
    }
  }

  const closest = await made(heard, best, over);
  const also: Made[] = [];
  for (const other of ranked.slice(1, OFFERED)) also.push(await made(heard, other, null));
  return { ...closest, heard, also };
}

/** One way of making it, at the level that matches what was heard. */
async function made(
  heard: Heard,
  settings: Settings & { match: number },
  over: DesignName | null,
): Promise<Made> {
  const built = await render({ ...settings, ...(over ? { with: [over] } : {}) });
  // Rendered at one and then scaled, rather than searched for: level is the
  // one setting with an exact answer, so there is no sense guessing at it.
  const gain = built.peak > 1e-6 ? clamp(heard.peak / built.peak, 0, 1.5) : 1;

  return {
    source: {
      kind: 'design',
      name: settings.voice,
      ...(over ? { with: [{ kind: 'design' as const, name: over, mix: 0.6 }] } : {}),
    },
    preset: {
      id: `heard:${heard.at.toFixed(3)}:${settings.voice}${over ? `+${over}` : ''}`,
      length: round(settings.length),
      tune: settings.tune,
      space: round(settings.space),
      drive: round(settings.drive),
      gain: round(gain),
    },
    match: settings.match,
    name: nameFor(settings.voice, over, settings.tune, settings.space),
  };
}

interface Settings {
  voice: DesignName;
  length: number;
  tune: number;
  space: number;
  drive: number;
  gain: number;
  with?: readonly DesignName[];
}

/** The voice's own settings, for when nothing better was found. */
function asSettings(voice: DesignName, length: number): Settings {
  return { voice, length, tune: 0, ...DESIGN_CHARACTER[voice], gain: 1 };
}

/** Render a candidate and measure it the same way the recording was measured. */
async function render(settings: Settings): Promise<{
  print: Float64Array;
  peak: number;
  centroid: number;
}> {
  const source: CueSource = {
    kind: 'design',
    name: settings.voice,
    ...(settings.with?.length
      ? { with: settings.with.map((name) => ({ kind: 'design' as const, name, mix: 0.6 })) }
      : {}),
  };
  const cue: Cue = {
    ...makeCue(0, 'rebuild', source),
    // Fixed, so the same recording rebuilds to the same sound every time it
    // is read. Two runs that disagree would make the match score noise.
    id: `rebuild:${settings.voice}:${settings.tune}:${settings.space}`,
    length: settings.length,
    tune: settings.tune,
    space: settings.space,
    drive: settings.drive,
    gain: 1,
  };

  // The room is added after the sound, so the window has to hold both.
  const seconds = Math.min(7, settings.length + 0.4 + settings.space * 2.6);
  const ctx = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  playCue(ctx, ctx.destination, cue, 0, 1);
  const data = (await ctx.startRendering()).getChannelData(0);

  // Measured exactly as a recording is, so the two prints cover the same
  // part of their sounds. See `measure` in `listen.ts`.
  const { peak, ends, centroid } = measure(data, RATE, 0, data.length);

  return {
    print: print(data, RATE, 0, Math.min(data.length, ends)),
    peak,
    centroid,
  };
}

/**
 * What to call a rebuilt sound.
 *
 * Named the same way the library and the describer name things, from the
 * shared tables, so a sound pulled out of a recording sits in the same
 * vocabulary as everything else rather than in one of its own.
 */
function nameFor(voice: DesignName, over: DesignName | null, tune: number, space: number): string {
  // Back from semitones to the size the library would have called it.
  const size = tune > 0 ? tune / 19 : tune / 14;
  const parts = [nearest(SIZE_NAMES, size), voice, ...(over ? ['with', over] : [])];
  return `${parts.filter(Boolean).join(' ')}, ${nearest(PLACE_NAMES, space)}`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
