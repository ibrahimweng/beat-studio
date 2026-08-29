import { describe, expect, it } from 'vitest';
import {
  DESIGN_GROUPS,
  DESIGN_NAMES,
  INSTRUMENT_PICKS,
  MOMENT_GROUPS,
  DESIGN_DEFAULT_LENGTH,
} from './types.ts';
import type { DesignName } from './types.ts';
import { KIT_SOUNDS } from '../constants.ts';
import { MOMENT_GROUP_FOR, MOMENT_TITLES } from '../audio/suggest.ts';

const indexed = MOMENT_GROUPS.flatMap((group) => group.names);

describe('the library indexed by moment', () => {
  it('holds every voice the app has', () => {
    /*
     * This is a second index over the same forty voices, not a selection from
     * them. A voice left out is a voice that cannot be found by anybody
     * browsing this way, and nothing on screen would say so.
     */
    expect([...indexed].sort()).toEqual([...DESIGN_NAMES].sort());
  });

  it('puts each voice in one group only', () => {
    // Two homes for one sound is two places to look and two places to keep
    // right, and the second one is always the one that goes stale.
    expect(new Set(indexed).size).toBe(indexed.length);
  });

  it('covers exactly what the other index covers', () => {
    const byKind = DESIGN_GROUPS.flatMap((group) => group.names);
    expect([...indexed].sort()).toEqual([...byKind].sort());
  });

  it('names a voice that has a length, which is to say a real one', () => {
    for (const name of indexed) {
      expect(DESIGN_DEFAULT_LENGTH[name as DesignName]).toBeGreaterThan(0);
    }
  });
});

describe('how the groups read', () => {
  it('gives each one a title and a line saying when to reach for it', () => {
    for (const group of MOMENT_GROUPS) {
      expect(group.title.trim()).not.toBe('');
      expect(group.when.trim()).not.toBe('');
      // A sentence about the picture, not a restatement of the title.
      expect(group.when.length).toBeGreaterThan(20);
      expect(group.when).not.toBe(group.title);
    }
  });

  it('gives each one an id of its own', () => {
    const ids = MOMENT_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves no group empty, and none so large it is a wall', () => {
    for (const group of MOMENT_GROUPS) {
      expect(group.names.length).toBeGreaterThan(2);
      expect(group.names.length).toBeLessThan(12);
    }
  });

  it('shares its words with what the Moments panel calls a moment', () => {
    /*
     * The point of naming the groups this way. Reading "Something builds"
     * beside a moment in a video and then finding "Something builds" in the
     * library is the whole return on the rename, and it only holds while the
     * two lists say the same words.
     */
    const titles = new Set(MOMENT_GROUPS.map((group) => group.title));
    for (const kind of ['appears', 'builds', 'moves', 'lands'] as const) {
      expect(titles).toContain(MOMENT_TITLES[kind]);
    }
  });

  it('opens on what happens most often in a piece of motion graphics', () => {
    // Something arriving on screen is the commonest thing there is, and a
    // list is read from the top.
    expect(MOMENT_GROUPS[0].title).toBe('Something appears');
  });
});

describe('the way from a moment to the sounds that suit it', () => {
  const KINDS = ['appears', 'builds', 'moves', 'lands', 'sequence', 'quiet'] as const;

  it('sends every kind of moment to a group that exists', () => {
    /*
     * A group id that does not exist makes the button do nothing at all, with
     * nothing on screen to say why. This is the check that catches that.
     */
    const ids = new Set(MOMENT_GROUPS.map((group) => group.id));
    for (const kind of KINDS) {
      expect(ids, `${kind} points at a group that is not there`).toContain(MOMENT_GROUP_FOR[kind]);
    }
  });

  it('sends a moment to the group named after it, wherever there is one', () => {
    // The four where the picture and the shelf say the same words.
    for (const kind of ['appears', 'builds', 'moves', 'lands'] as const) {
      const group = MOMENT_GROUPS.find((one) => one.id === MOMENT_GROUP_FOR[kind])!;
      expect(group.title).toBe(MOMENT_TITLES[kind]);
    }
  });

  it('sends the other two somewhere that makes sense for them', () => {
    /*
     * The two where what the picture did and what you reach for are different
     * things. A flurry of cuts wants the small detail sounds, and a still
     * passage wants something to sit underneath it.
     */
    const group = (kind: 'sequence' | 'quiet'): readonly string[] =>
      MOMENT_GROUPS.find((one) => one.id === MOMENT_GROUP_FOR[kind])!.names;

    expect(group('sequence')).toContain('tick');
    expect(group('quiet')).toContain('drone');
  });

  it('lands somebody among sounds worth choosing between', () => {
    // Arriving at a group of one is arriving at the same suggestion again.
    for (const kind of KINDS) {
      const group = MOMENT_GROUPS.find((one) => one.id === MOMENT_GROUP_FOR[kind])!;
      expect(group.names.length).toBeGreaterThan(2);
    }
  });
});

describe('the kit and the two instruments, folded into the library', () => {
  it('files every one under a group that exists', () => {
    const ids = new Set(MOMENT_GROUPS.map((group) => group.id));
    for (const pick of INSTRUMENT_PICKS) {
      expect(ids, `${pick.label} is filed under a group that is not there`).toContain(pick.group);
    }
  });

  it('keeps every drum in the kit, exactly once', () => {
    /*
     * There is no screen with the pads on it any more, so this list is the
     * only way to reach one. A pad missing from here is a pad that has left
     * the app, and nothing would say so.
     */
    const pads = INSTRUMENT_PICKS.filter((pick) => pick.source.kind === 'kit').map(
      (pick) => pick.source.name,
    );
    expect([...pads].sort()).toEqual(KIT_SOUNDS.map((sound) => sound.pad).sort());
  });

  it('gives each one a name and a line saying what it is for', () => {
    for (const pick of INSTRUMENT_PICKS) {
      expect(pick.label.trim()).not.toBe('');
      // The about line is why these are worth having as buttons rather than as
      // a keyboard: it says what the sound does, which the pitch never will.
      expect(pick.about.length).toBeGreaterThan(20);
    }
  });

  it('calls no two of them the same thing', () => {
    const labels = INSTRUMENT_PICKS.map((pick) => pick.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives every pitched gesture a note a piano has', () => {
    const pitched = INSTRUMENT_PICKS.filter((pick) => pick.source.kind === 'pitched');
    expect(pitched.length).toBeGreaterThan(2);
    for (const pick of pitched) {
      const notes = [pick.source.midi, ...(pick.source.with ?? []).map((part) => part.midi)];
      for (const note of notes) {
        expect(note).toBeDefined();
        // An 88 key piano runs from 21 to 108.
        expect(note!).toBeGreaterThanOrEqual(21);
        expect(note!).toBeLessThanOrEqual(108);
      }
    }
  });

  it('builds a chord out of notes rather than out of something else', () => {
    /*
     * A stack is one sound played at one moment, which is what makes a chord
     * possible here and a rising figure not: three notes in a row is three
     * sounds, and belongs on the timeline.
     */
    const chord = INSTRUMENT_PICKS.find((pick) => (pick.source.with ?? []).length > 0);
    expect(chord).toBeDefined();
    for (const part of chord!.source.with!) {
      expect(part.kind).toBe('pitched');
    }
  });

  it('spreads them across the moments rather than piling them into one', () => {
    const used = new Set(INSTRUMENT_PICKS.map((pick) => pick.group));
    expect(used.size).toBeGreaterThan(3);
  });
});
