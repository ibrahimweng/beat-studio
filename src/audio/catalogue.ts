import { DESIGN_DEFAULT_LENGTH, DESIGN_CHARACTER, DESIGN_GROUPS } from '../timeline/types.ts';
import type { CuePreset, DesignName } from '../timeline/types.ts';

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

/**
 * How big the thing is.
 *
 * Pitch and length together, because that is what size actually is: a large
 * object is lower and rings for longer, and moving only one of the two gives
 * the same object played wrong rather than a different object.
 */
const SIZES: readonly { word: string; tune: number; length: number }[] = [
  { word: 'tiny', tune: 19, length: 0.45 },
  { word: 'small', tune: 11, length: 0.7 },
  { word: '', tune: 0, length: 1 },
  { word: 'large', tune: -7, length: 1.45 },
  { word: 'huge', tune: -14, length: 2.1 },
];

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
 * Words that describe a voice but are not in its name.
 *
 * Searching a library is guessing at what someone else called things, so the
 * things nobody would think to type the exact name of carry the words they
 * would type instead.
 */
const ALSO: Partial<Record<DesignName, readonly string[]>> = {
  impact: ['hit', 'boom', 'punch'],
  thud: ['hit', 'body', 'dull'],
  slam: ['door', 'hit', 'heavy'],
  metal: ['clang', 'steel', 'ring'],
  clank: ['metal', 'knock'],
  whoosh: ['swish', 'pass', 'air'],
  swipe: ['swish', 'fast', 'air'],
  flutter: ['wings', 'flap', 'air'],
  wobble: ['warp', 'bend'],
  riser: ['build', 'lead in', 'tension'],
  swell: ['build', 'lead in'],
  reverse: ['backwards', 'suck', 'lead in'],
  sub: ['bass', 'low', 'drop'],
  rumble: ['low', 'earth', 'thunder'],
  drone: ['hum', 'low', 'bed'],
  click: ['tick', 'ui', 'button'],
  tick: ['click', 'ui'],
  pop: ['blip', 'ui', 'bubble'],
  beep: ['tone', 'ui', 'alert'],
  chirp: ['blip', 'ui', 'bird'],
  zap: ['laser', 'electric', 'sci fi'],
  glitch: ['digital', 'error', 'broken'],
  shimmer: ['sparkle', 'magic', 'bright'],
  static: ['noise', 'hiss', 'radio'],
  bell: ['chime', 'ring', 'church'],
  glass: ['crystal', 'ring', 'ping'],
  wood: ['block', 'knock', 'dry'],
  pipe: ['tube', 'hollow', 'organ'],
  string: ['pluck', 'guitar', 'harp'],
  thunk: ['knock', 'dull', 'hollow'],
  wire: ['twang', 'cable', 'tension'],
  rain: ['water', 'weather', 'drops'],
  fire: ['crackle', 'burn', 'flames'],
  gravel: ['stones', 'scrape', 'dirt'],
  swarm: ['insects', 'bees', 'sci fi'],
  pour: ['water', 'bubbles', 'liquid'],
  ratchet: ['clatter', 'gear', 'wind up'],
  clockwork: ['ticking', 'clock', 'gears'],
  zip: ['zipper', 'fast', 'lead in'],
  motor: ['engine', 'machine', 'idle'],
};

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

    for (const size of SIZES) {
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
          tags: [
            voice,
            family,
            size.word,
            place.word,
            ...(ALSO[voice] ?? []),
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
