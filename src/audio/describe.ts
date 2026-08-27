import { MAX_LENGTH, MIN_LENGTH } from '../timeline/project.ts';
import { DESIGN_CHARACTER, DESIGN_DEFAULT_LENGTH, DESIGN_NAMES } from '../timeline/types.ts';
import type { CuePreset, DesignName } from '../timeline/types.ts';
import {
  AMOUNT,
  FILLER,
  JOINERS,
  LENGTH,
  LOUD,
  meaning,
  NEGATORS,
  PLACE,
  PUSH,
  SIZE,
  SYNONYMS,
  TONE,
} from './vocabulary.ts';

/**
 * Making a sound out of a sentence.
 *
 * There is no model here and nothing is sent anywhere. A description is read
 * as a set of claims about seven things — what the thing is, how big, how
 * long, where it is, how pushed, how bright, how loud — and each of those is a
 * number the app already has a control for. That is the whole trick, and it
 * is only possible because a voice is a description rather than a recording:
 * there is somewhere for the words to land.
 *
 * What it cannot do is worth saying plainly. It knows the words in
 * `vocabulary.ts` and no others, so "menacing" and "eerie" mean nothing to it
 * however much they mean to you — and rather than quietly ignoring them it
 * hands them back, which is how anybody finds out what it does know. It reads
 * one sound at a time, so "a boom with a metallic ring over it" is read as
 * two candidates to choose between rather than as one sound with two parts.
 * And it has no idea what anything is for: it can build you a huge dull thud
 * in a cavern, and whether that is the sound of a vault door closing is
 * entirely your call.
 */

/** How much of a second voice a joining word asks for, in order. */
const STACKED_MIX: readonly number[] = [0.6, 0.45];

/** One sound the description could mean, ready to arm. */
export interface Suggestion extends CuePreset {
  name: string;
  voice: DesignName;
  /** Voices played as part of this one, when the description asked for it. */
  over?: readonly { voice: DesignName; mix: number }[];
  /** What in the description led here, in the order it was read. */
  why: readonly string[];
  /** How strongly the description named this voice. */
  score: number;
}

/** Everything a description was found to say. */
export interface Reading {
  suggestions: Suggestion[];
  /** Words that meant nothing, worth handing back rather than swallowing. */
  unknown: readonly string[];
  /** Words that meant something. */
  known: readonly string[];
  /** Whether any word asked for something other than a voice. */
  shaped: boolean;
}

/** A size word is a pitch and a length together. See {@link SIZE}. */
const SIZE_BEND = 0.8;
const UP_SEMITONES = 19;
const DOWN_SEMITONES = 14;

/** Names for the ends of each axis, so a suggestion can be called something. */
const SIZE_NAMES: readonly { at: number; word: string }[] = [
  { at: 0.85, word: 'tiny' },
  { at: 0.5, word: 'small' },
  { at: -0.35, word: '' },
  { at: -0.75, word: 'large' },
  { at: -1, word: 'huge' },
];
const PLACE_NAMES: readonly { at: number; word: string }[] = [
  { at: 0.08, word: 'dry' },
  { at: 0.3, word: 'close' },
  { at: 0.6, word: 'room' },
  { at: 0.88, word: 'hall' },
  { at: 1, word: 'cavern' },
];
const LOUD_NAMES: readonly { at: number; word: string }[] = [
  { at: 0.35, word: 'faint' },
  { at: 0.6, word: 'quiet' },
  { at: 1.1, word: '' },
  { at: 1.3, word: 'loud' },
  { at: 1.5, word: 'blaring' },
];

/** Two word entries, matched as a pair before the words are read singly. */
const PHRASES: ReadonlySet<string> = new Set(
  Object.values(SYNONYMS).flat().filter((word) => word.includes(' ')),
);

/**
 * Read a description and offer what it could mean.
 *
 * More than one answer on purpose. "A metal door slamming" names two voices
 * and the honest response is to build both and let them be heard, rather than
 * picking one and hiding the fact that there was a choice.
 */
export function describe(text: string, limit = 6): Reading {
  const words = tokens(text);
  const scores = new Map<DesignName, number>();
  const named = new Map<DesignName, string[]>();
  /** Where each voice was first mentioned, and where the joining word sits. */
  const firstAt = new Map<DesignName, number>();
  let joinAt = -1;
  const known: string[] = [];
  const unknown: string[] = [];

  let size: number | null = null;
  let stretch: number | null = null;
  let space: number | null = null;
  let push: number | null = null;
  let loud: number | null = null;
  let tone = 0;

  /** Scales whatever comes next, and is spent on it. */
  let amount = 1;
  /** Cancels whichever axis the next word belongs to, and is spent on it. */
  let negated = false;
  const why: string[] = [];

  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    // Only between two sounds, so "a big and heavy hit" stays one sound. That
    // is checked once the scores are in, since what is on either side is not
    // known yet.
    if (joinAt < 0 && JOINERS.includes(word)) joinAt = index;

    const said = forms(word);
    const look = (table: Readonly<Record<string, number>>): number | null => {
      for (const form of said) {
        const value = meaning(table, form);
        if (value !== null) return value;
      }
      return null;
    };

    const scale = look(AMOUNT);
    if (scale !== null) {
      amount = scale;
      continue;
    }
    if (NEGATORS.includes(word)) {
      negated = true;
      continue;
    }

    let meant = false;

    // A word can name a voice and shape it at the same time. "Low boom" ought
    // to pick a low voice and pitch it down, not choose between the two.
    for (const voice of DESIGN_NAMES) {
      const hit = said.includes(voice) ? 3 : SYNONYMS[voice].some((w) => said.includes(w)) ? 2 : 0;
      if (!hit) continue;
      meant = true;
      if (negated) {
        // Enough to keep it out however many other words point at it.
        scores.set(voice, (scores.get(voice) ?? 0) - 99);
      } else {
        scores.set(voice, (scores.get(voice) ?? 0) + hit);
        if (!firstAt.has(voice)) firstAt.set(voice, index);
        const list = named.get(voice) ?? [];
        if (!list.includes(word)) list.push(word);
        named.set(voice, list);
      }
    }

    const asSize = look(SIZE);
    if (asSize !== null) {
      meant = true;
      const value = negated ? 0 : asSize * amount;
      if (size === null || Math.abs(value) > Math.abs(size)) size = value;
      why.push(negated ? `not ${word}` : word);
    }

    const asLength = look(LENGTH);
    if (asLength !== null) {
      meant = true;
      const value = negated ? 1 : Math.pow(asLength, amount);
      if (stretch === null || Math.abs(Math.log(value)) > Math.abs(Math.log(stretch))) {
        stretch = value;
      }
      why.push(negated ? `not ${word}` : word);
    }

    const asPlace = look(PLACE);
    if (asPlace !== null) {
      meant = true;
      // Last one wins, because a description refines as it goes: "in a room,
      // quite far off" means far off.
      space = negated ? 0 : Math.min(1, asPlace * amount);
      why.push(negated ? `no ${word}` : `in the ${word}`);
    }

    const asPush = look(PUSH);
    if (asPush !== null) {
      meant = true;
      push = negated ? 0 : Math.min(1, asPush * amount);
      why.push(negated ? `not ${word}` : word);
    }

    const asLoud = look(LOUD);
    if (asLoud !== null) {
      meant = true;
      // Raised to the intensifier rather than multiplied by it, because this
      // one is scaled around one instead of around nothing: "very quiet" has
      // to come out quieter than "quiet" and "very loud" louder than "loud".
      loud = negated ? 1 : Math.pow(asLoud, amount);
      why.push(negated ? `not ${word}` : word);
    }

    const asTone = look(TONE);
    if (asTone !== null) {
      meant = true;
      tone += negated ? 0 : asTone * amount;
      why.push(negated ? `not ${word}` : word);
    }

    if (meant) known.push(word);
    else if (!FILLER.has(word) && !unknown.includes(word)) unknown.push(word);

    amount = 1;
    negated = false;
  }

  const shaped =
    size !== null || stretch !== null || space !== null || push !== null ||
    loud !== null || tone !== 0;

  const shape = { size, stretch, space, push, loud, tone };
  const trimmed = why.filter((reason, at) => why.indexOf(reason) === at);
  const ranked = [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  /** How a voice came to be named, for the line under the button. */
  const because = (voice: DesignName): string => {
    const from = named.get(voice) ?? [];
    // "Slam, from “door” and “slamming”" rather than the same claim twice.
    return from.includes(voice)
      ? voice
      : `${voice}, from ${from.map((w) => `“${w}”`).join(' and ')}`;
  };

  const suggestions = ranked
    .slice(0, limit)
    .map(([voice, score]) => build(voice, score, shape, [because(voice), ...trimmed]));

  /*
   * One sound made of several, when the description asked for one.
   *
   * A joining word on its own is not enough: "a big and heavy hit" has an
   * "and" in it and is one sound described twice. What makes a stack is a
   * voice named on each side of the joining word, which is also what says
   * which of them is the sound and which is the thing on top of it.
   */
  const before = ranked.filter(([voice]) => (firstAt.get(voice) ?? -1) < joinAt);
  const after = ranked.filter(([voice]) => (firstAt.get(voice) ?? -1) > joinAt);
  if (joinAt >= 0 && before.length && after.length) {
    const [head, score] = before[0];
    const over = after
      .slice(0, STACKED_MIX.length)
      .map(([voice], at) => ({ voice, mix: STACKED_MIX[at] }));
    const stack = build(head, score + 1, shape, [
      because(head),
      `with ${over.map((part) => because(part.voice)).join(' and ')} over it`,
      ...trimmed,
    ]);
    // First, because somebody who wrote "with" asked for one sound.
    suggestions.unshift({
      ...stack,
      over,
      id: `${stack.id}+${over.map((p) => `${p.voice}:${p.mix}`).join('+')}`,
      name: stack.name.replace(
        `${head},`,
        `${head} with ${over.map((p) => p.voice).join(' and ')},`,
      ),
    });
    suggestions.length = Math.min(suggestions.length, limit);
  }

  return { suggestions, unknown, known, shaped };
}

interface Shape {
  size: number | null;
  stretch: number | null;
  space: number | null;
  push: number | null;
  loud: number | null;
  tone: number;
}

/** Turn what was understood into settings the app can actually place. */
function build(voice: DesignName, score: number, shape: Shape, why: string[]): Suggestion {
  const size = shape.size ?? 0;
  const character = DESIGN_CHARACTER[voice];

  // A size word is a pitch and a length together, and a length word stretches
  // whatever that came to. Unasked-for axes keep what the voice was born with,
  // so "a bell in a cavern" is still a bell everywhere but the room.
  const length = clamp(
    DESIGN_DEFAULT_LENGTH[voice] * Math.exp(-SIZE_BEND * size) * (shape.stretch ?? 1),
    MIN_LENGTH,
    MAX_LENGTH,
  );
  const tune = Math.round(
    clamp(size * (size > 0 ? UP_SEMITONES : DOWN_SEMITONES) + shape.tone, -24, 24),
  );
  const space = clamp(shape.space ?? character.space, 0, 1);
  const drive = clamp(shape.push ?? character.drive, 0, 1);
  // The same range the Level slider holds, so anything asked for here can
  // also be dragged afterwards.
  const gain = clamp(shape.loud ?? 1, 0, 1.5);

  /*
   * Named after what was asked for, in the order somebody would say it.
   *
   * Only the parts that were asked for: an axis nobody mentioned keeps the
   * voice's own setting and so has nothing to say about it. Without this a
   * description came back called "tick, dry" whether it had asked for a quiet
   * bright one or not, and three suggestions could differ in everything but
   * their labels.
   */
  const name =
    [
      nearest(LOUD_NAMES, gain),
      shape.stretch === null ? '' : shape.stretch < 1 ? 'quick' : 'long',
      shape.tone > 2.5 ? 'bright' : shape.tone < -2.5 ? 'dark' : '',
      nearest(SIZE_NAMES, size),
      voice,
    ]
      .filter(Boolean)
      .join(' ') + `, ${nearest(PLACE_NAMES, space)}`;

  return {
    // Stable for the same description, so re-typing it re-arms the same thing.
    id:
      `say:${voice}:${length.toFixed(2)}:${tune}:` +
      `${space.toFixed(2)}:${drive.toFixed(2)}:${gain.toFixed(2)}`,
    name,
    voice,
    length: Math.round(length * 100) / 100,
    tune,
    space: Math.round(space * 100) / 100,
    drive: Math.round(drive * 100) / 100,
    gain: Math.round(gain * 100) / 100,
    why,
    score,
  };
}

/**
 * Split a description into words, keeping the two word entries whole.
 *
 * Anything that is not a letter or a digit is a gap, so punctuation, hyphens
 * and stray apostrophes all come out as separators rather than as part of a
 * word nobody would think to put in the tables.
 */
function tokens(text: string): string[] {
  const raw = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const pair = `${raw[i]} ${raw[i + 1]}`;
    if (i + 1 < raw.length && PHRASES.has(pair)) {
      out.push(pair);
      i++;
    } else {
      out.push(raw[i]);
    }
  }
  return out;
}

/**
 * A word and the shorter words it might be an inflection of.
 *
 * Written out rather than listed in the vocabulary, because "slam" and
 * "slamming" and "slammed" are one word to anybody typing and three entries
 * to a table, and a table that has to carry every ending of every word will
 * be missing one of them forever. Cheap and deliberately shallow: nothing is
 * used unless it turns out to be a word one of the tables already knows, so a
 * stem that is nonsense costs nothing and a word that stands on its own is
 * always tried first.
 */
function forms(word: string): string[] {
  const out = [word];
  const add = (form: string): void => {
    if (form.length >= 3 && !out.includes(form)) out.push(form);
  };
  const undouble = (stem: string): void => {
    add(stem);
    // "slamming" loses its "ing" as "slamm", and the doubled letter with it.
    if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      add(stem.slice(0, -1));
    }
    // "closing" loses its "ing" as "clos", and wants its "e" back.
    add(`${stem}e`);
  };

  if (word.endsWith('ies') && word.length > 4) add(`${word.slice(0, -3)}y`);
  if (word.endsWith('es') && word.length > 4) add(word.slice(0, -2));
  if (word.endsWith('s') && word.length > 3) add(word.slice(0, -1));
  if (word.endsWith('ing') && word.length > 5) undouble(word.slice(0, -3));
  if (word.endsWith('ed') && word.length > 4) undouble(word.slice(0, -2));
  return out;
}

/** The word for wherever a value landed on an axis. */
function nearest(names: readonly { at: number; word: string }[], value: number): string {
  for (const step of names) {
    if (names[0].at > names[names.length - 1].at ? value >= step.at : value <= step.at) {
      return step.word;
    }
  }
  return names[names.length - 1].word;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
