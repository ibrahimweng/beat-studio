import { afterEach, describe, expect, it } from 'vitest';
import { packSpec, readPack, registerSounds, toSpec, unregisterPack } from './pack.ts';

/**
 * Sound packs, which arrive as a file somebody else wrote.
 *
 * Every other sound in the app is one it makes from a description it wrote
 * itself. A pack is a description written elsewhere, so nothing about it can
 * be assumed: a field may be missing, the wrong type, or a shape this app has
 * no way to make.
 *
 * What the reader promises is that it never hands back something that would
 * play nothing. A sound it cannot make is left out and named in `skipped`,
 * because a pack that quietly loads with three of its forty sounds silent is
 * worse than one that refuses -- you would go looking at your mixer.
 */

const TEST_PACK = 'test-pack';
afterEach(() => unregisterPack(TEST_PACK));

/** The smallest thing that is a sound this app can make. */
const aSound = {
  source: { type: 'noise' },
  envelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.1 },
  gain: 0.8,
};

describe('reading a pack file', () => {
  it('takes one that is well formed', () => {
    const pack = readPack({ name: 'Kit', author: 'someone', sounds: { tap: aSound } }, TEST_PACK);
    expect(pack, 'a good pack was read').not.toBeNull();
    expect(pack?.name).toBe('Kit');
    expect(pack?.author).toBe('someone');
    expect(pack?.sounds.map((one) => one.name)).toEqual(['tap']);
    expect(pack?.skipped, 'nothing was left out').toEqual([]);
  });

  it('refuses one that is not a pack at all', () => {
    for (const raw of [null, undefined, 42, 'a pack', [], {}]) {
      expect(readPack(raw, TEST_PACK), `${JSON.stringify(raw) ?? 'undefined'}`).toBeNull();
    }
  });

  it('refuses one with no name, or no sounds', () => {
    expect(readPack({ sounds: { tap: aSound } }, TEST_PACK), 'no name').toBeNull();
    expect(readPack({ name: '', sounds: { tap: aSound } }, TEST_PACK), 'an empty name').toBeNull();
    expect(readPack({ name: 'Kit' }, TEST_PACK), 'no sounds at all').toBeNull();
    expect(readPack({ name: 'Kit', sounds: 'lots' }, TEST_PACK), 'sounds of the wrong type')
      .toBeNull();
  });

  /*
   * The one that matters. A sound that cannot be made must be named, not
   * loaded as something that plays nothing.
   */
  it('leaves out a sound it cannot make, and says which', () => {
    const pack = readPack(
      { name: 'Kit', sounds: { good: aSound, broken: { source: { type: 'unicorn' } }, alsoBad: 7 } },
      TEST_PACK,
    );
    expect(pack?.sounds.map((one) => one.name), 'only the one it can make').toEqual(['good']);
    expect(pack?.skipped.length, 'and both of the others are named').toBe(2);
    expect(pack?.skipped.join(' '), 'by name, with a reason').toMatch(/broken/);
    expect(pack?.skipped.join(' ')).toMatch(/alsoBad/);
  });

  it('refuses a pack where nothing at all can be made', () => {
    expect(readPack({ name: 'Kit', sounds: { a: 7, b: null } }, TEST_PACK)).toBeNull();
  });
});

describe('turning one sound into something playable', () => {
  it('says why, whenever it cannot', () => {
    for (const raw of [null, 7, 'noise', {}, { source: { type: 'unicorn' } }]) {
      const { spec, why } = toSpec(raw);
      expect(spec, `${JSON.stringify(raw) ?? 'undefined'} is not a sound`).toBeNull();
      expect(why, 'and it says so in words').not.toBe('');
    }
  });

  it('runs for as long as its envelope, not longer', () => {
    const { spec } = toSpec({
      source: { type: 'noise' },
      envelope: { attack: 0.05, decay: 0.3, sustain: 0.5, release: 0.2 },
    });
    // Attack, decay and release are the length of a sound; sustain is a level.
    expect(spec?.duration).toBeCloseTo(0.05 + 0.3 + 0.2 + 0.1, 6);
  });

  it('takes a sound in layers as readily as one on its own', () => {
    const single = toSpec(aSound).spec;
    const layered = toSpec({ layers: [aSound, aSound] }).spec;
    expect(single?.layers).toHaveLength(1);
    expect(layered?.layers, 'both layers were read').toHaveLength(2);
    expect(layered?.duration, 'and it is as long as the longest of them')
      .toBeCloseTo(single?.duration ?? 0, 6);
  });

  it('keeps the layers it can make and drops the ones it cannot', () => {
    const { spec } = toSpec({ layers: [aSound, { source: { type: 'unicorn' } }, aSound] });
    expect(spec?.layers, 'the two good ones survived').toHaveLength(2);
  });
});

describe('a loaded pack', () => {
  it('is playable by name, and gone when it is unloaded', () => {
    const pack = readPack({ name: 'Kit', sounds: { tap: aSound } }, TEST_PACK);
    expect(packSpec(TEST_PACK, 'tap'), 'nothing before it is loaded').toBeNull();

    registerSounds(TEST_PACK, pack?.sounds ?? []);
    expect(packSpec(TEST_PACK, 'tap'), 'found once loaded').not.toBeNull();
    expect(packSpec(TEST_PACK, 'nothing-called-this'), 'and only what is in it').toBeNull();
    expect(packSpec('another-pack', 'tap'), 'and only under its own id').toBeNull();

    unregisterPack(TEST_PACK);
    expect(packSpec(TEST_PACK, 'tap'), 'gone again').toBeNull();
  });

  it('replaces rather than merges when one is loaded over another', () => {
    registerSounds(TEST_PACK, [{ name: 'first', spec: toSpec(aSound).spec! }]);
    registerSounds(TEST_PACK, [{ name: 'second', spec: toSpec(aSound).spec! }]);
    expect(packSpec(TEST_PACK, 'first'), 'the old one did not linger').toBeNull();
    expect(packSpec(TEST_PACK, 'second')).not.toBeNull();
  });
});
