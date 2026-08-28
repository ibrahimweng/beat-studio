import { DESIGN_DEFAULT_LENGTH, DESIGN_CHARACTER, DESIGN_GROUPS } from '../timeline/types.ts';
import type { CuePreset, DesignName } from '../timeline/types.ts';
import { SYNONYMS } from './vocabulary.ts';

/**
 * A browsable library, generated rather than stored.
 *
 * Every entry is a name and a handful of numbers pointing at one of the
 * voices, so a thousand of them cost nothing to keep and nothing to load:
 * the sound is worked out at the moment you ask for it. That is the whole
 * return on describing a voice as data rather than as code.
 *
 * Being honest about what this is: it is an index over the settings of forty
 * mechanisms, not a thousand unrelated sounds. A huge bell in a hall and a
 * small bell in a room are two different sounds to anyone using them, and
 * they are also the same mechanism twice. What the library buys is finding
 * one by name instead of dialling for it, which is what a sound library has
 * always actually been.
 */
export interface Entry extends CuePreset {
  name: string;
  voice: DesignName;
  /** Everything the search matches against, lower case. */
  tags: readonly string[];
}

/** The five sizes, smallest first. The middle one is the voice as written. */
const SIZE_WORDS = ['tiny', 'small', '', 'large', 'huge'] as const;

/**
 * How big the thing is.
 *
 * Pitch and length together, because that is what size actually is: a large
 * object is lower and rings for longer, and moving only one of the two gives
 * the same object played wrong rather than a different object.
 *
 * `tune` is where the smallest and the largest sit, in semitones, and `length`
 * the same as a multiple of the voice's own. The middle size is always the
 * voice exactly as written — nought and one — and the two either side are
 * halfway there, so a named size is always a step off the plain sound rather
 * than something unrelated to it.
 */
interface SizeAxis {
  /** Semitones at the smallest size, and at the largest. */
  tune: readonly [number, number];
  /** Length as a multiple of the voice's own, smallest and largest. */
  length: readonly [number, number];
}

/**
 * What size does to most voices: mostly length, with pitch alongside.
 *
 * A hit that lasts twice as long and sits a full tone lower is a bigger
 * version of the same hit, and for the twenty-nine voices that are shaped like
 * that this is right.
 */
const SIZE: SizeAxis = { tune: [19, -14], length: [0.45, 2.1] };

/**
 * The voices that need something else, and why.
 *
 * One grid over forty mechanisms does not fit all of them, and measuring which
 * steps did nothing — `tools/size-check.html` — found two shapes it fitted
 * badly. Both were producing names for nothing.
 *
 * **Voices already at the floor.** A click is twenty milliseconds long and
 * clamps itself at sixty, so five lengths of it are one length: measured, a
 * tiny click and a huge one were 97.6% the same sound. What size means for a
 * transient is where its corner sits anyway — a small one is a thin tick, a
 * big one is a dull thud — so the pitch carries it and the length barely
 * moves. The pitch range is pulled *down* rather than widened, because these
 * voices' corners run into the top of hearing at the small end and were
 * capped there, which is what made tiny and small identical.
 *
 * **Voices that are a long slow sweep.** A riser twice as long is the same
 * riser: measured, large against huge was 99% and the three of them together
 * made a cluster of twenty-one entries. What tells a big sweep from a small
 * one is how low it goes, so again the pitch does the work and the length is
 * compressed to about what the ear can still hear as a difference.
 */
const SIZE_BY_VOICE: Partial<Record<DesignName, SizeAxis>> = {
  // At the floor: the corner does the work.
  click: { tune: [12, -19], length: [0.7, 2.6] },
  tick: { tune: [15, -19], length: [0.7, 2.5] },
  thunk: { tune: [16, -18], length: [0.6, 2.6] },
  pop: { tune: [15, -18], length: [0.7, 2.4] },
  /*
   * Long slow sweeps, and three of them that used to land on top of each
   * other.
   *
   * Taken down the full two octaves, all three put everything they had below
   * two kilohertz at the big end — 99%, 100% and 95% — and a riser, a swell
   * and a reverse became one low roar under three names, twenty-one entries
   * in one cluster. They are different mechanisms and they scale differently,
   * so they are given different axes rather than one.
   *
   * A riser leads with a tone, so pitch is what its size is. A swell is pure
   * noise with no pitch to follow, so a bigger one is a longer one and the
   * pitch moves less. A reverse carries its own filter now, which does the
   * work the pitch was being asked to do.
   */
  riser: { tune: [24, -18], length: [0.6, 1.5] },
  swell: { tune: [18, -10], length: [0.5, 2.4] },
  reverse: { tune: [22, -14], length: [0.6, 1.6] },
  // A run of hits that clamps its own length at just over a second, so the
  // top half of the axis was doing nothing: mid against large was 100%.
  zip: { tune: [22, -20], length: [0.5, 1.6] },
};

/** The five steps for one voice, from its axis. */
function sizesFor(voice: DesignName): { word: string; tune: number; length: number }[] {
  const axis = SIZE_BY_VOICE[voice] ?? SIZE;
  return SIZE_WORDS.map((word, i) => {
    // −1 at the smallest, 0 in the middle, +1 at the largest.
    const away = (i - 2) / 2;
    const [up, down] = axis.tune;
    const [short, long] = axis.length;
    return {
      word,
      tune: Math.round(away < 0 ? up * -away : down * away),
      length: away < 0 ? 1 + (short - 1) * -away : 1 + (long - 1) * away,
    };
  });
}

/**
 * Where it is. The room around a sound is most of what says where it is.
 *
 * Evenly spread across the whole of what the app can do, rather than bunched
 * at the quiet end. The first attempt put "close" at 0.12, which works out as
 * five per cent of a room added to a sound that is already at full level:
 * measured, two hundred entries labelled "close" were indistinguishable from
 * the dry ones beside them, which is two hundred names for nothing. Dry is
 * dry, a cavern is everything the space control has, and the three between
 * are equal steps.
 */
const PLACES: readonly { word: string; space: number }[] = [
  { word: 'dry', space: 0 },
  { word: 'close', space: 0.28 },
  { word: 'room', space: 0.52 },
  { word: 'hall', space: 0.76 },
  { word: 'cavern', space: 1 },
];

/** Which family a voice belongs to, for searching by what a sound is for. */
const FAMILY = new Map<DesignName, string>(
  DESIGN_GROUPS.flatMap((group) => group.names.map((name) => [name, group.title.toLowerCase()] as const)),
);

/**
 * Every entry, worked out once.
 *
 * Built at module load rather than on demand: a thousand small objects is
 * nothing to hold, and building them once means an entry keeps the same
 * identity for as long as the app is open, which is what lets a session
 * point at one.
 */
export const CATALOGUE: readonly Entry[] = build();

function build(): Entry[] {
  const out: Entry[] = [];

  for (const [voice, family] of FAMILY) {
    const base = DESIGN_DEFAULT_LENGTH[voice];
    const character = DESIGN_CHARACTER[voice];

    for (const size of sizesFor(voice)) {
      for (const place of PLACES) {
        const name = [size.word, voice].filter(Boolean).join(' ');
        out.push({
          id: `cat:${voice}:${size.word || 'mid'}:${place.word}`,
          name: `${name}, ${place.word}`,
          voice,
          length: round(base * size.length),
          tune: size.tune,
          space: place.space,
          // The push a voice was born with, left alone. What size and place
          // change is how big it is and where it is, not what it is made of.
          drive: character.drive,
          // The library varies size and place and nothing else, so every
          // entry arrives at the level any sound arrives at.
          gain: 1,
          tags: [
            voice,
            family,
            size.word,
            place.word,
            ...SYNONYMS[voice],
          ].filter(Boolean).map((t) => t.toLowerCase()),
        });
      }
    }
  }

  return out;
}

/** Two decimal places, so a length reads as a number rather than a fraction. */
function round(seconds: number): number {
  return Math.max(0.02, Math.min(4, Math.round(seconds * 100) / 100));
}

/**
 * Find entries by what someone typed.
 *
 * Every word has to match something, but any of the words in a name or a tag
 * will do, so "small metal hall" finds what it should and the order does not
 * matter. Ranked so that a match on the name itself comes before a match on
 * one of the words a voice merely reminds people of.
 */
export function search(query: string, limit = 60): Entry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return CATALOGUE.slice(0, limit);

  const found: { entry: Entry; score: number }[] = [];
  for (const entry of CATALOGUE) {
    const name = entry.name.toLowerCase();
    let score = 0;
    let all = true;

    for (const word of words) {
      if (name.includes(word)) score += 3;
      else if (entry.tags.some((tag) => tag.includes(word))) score += 1;
      else {
        all = false;
        break;
      }
    }
    if (all) found.push({ entry, score });
  }

  /*
   * Best match first, then the plainest.
   *
   * Typing one word like "cavern" matches two hundred entries equally well,
   * and sorting those by name alone answered with whatever happened to start
   * with an early letter — a screen of huge things, because "huge" sorts
   * before "small". Fewer words in the name means fewer things assumed about
   * what was wanted, so a plain bell comes before a huge one and the sizes
   * are there once the size is what is being asked for.
   */
  found.sort(
    (a, b) =>
      b.score - a.score ||
      nameWords(a.entry.name) - nameWords(b.entry.name) ||
      a.entry.name.localeCompare(b.entry.name),
  );
  return found.slice(0, limit).map((f) => f.entry);
}

const nameWords = (name: string): number => name.split(/[\s,]+/).filter(Boolean).length;

/** One entry by id, for a session pointing at something chosen earlier. */
export function entryById(id: string): Entry | null {
  return CATALOGUE.find((entry) => entry.id === id) ?? null;
}
