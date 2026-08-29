import { describe, expect, it } from 'vitest';
import {
  DESIGN_GROUPS,
  DESIGN_NAMES,
  MOMENT_GROUPS,
  DESIGN_DEFAULT_LENGTH,
} from './types.ts';
import type { DesignName } from './types.ts';
import { MOMENT_TITLES } from '../audio/suggest.ts';

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
