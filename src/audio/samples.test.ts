import { describe, expect, it } from 'vitest';
import { creditFromName, creditLine, tagsFromPath } from './samples.ts';
import type { Sample } from './samples.ts';

/**
 * Who made a recording, and what may be done with it.
 *
 * Not decoration. A library assembled from Freesound is a mix of licences:
 * CC0 asks for nothing, CC-BY requires the author be named wherever the work
 * is used, and some sounds are non-commercial only. Somebody laying four
 * hundred effects against a client's video cannot hold that in their head, so
 * it travels with the sound and gets written out.
 *
 * Which makes both ways of being wrong expensive. A credit that should have
 * been written and was not is an obligation quietly unmet. One written when
 * none was owed pads a credits file until nobody reads it, and the ones that
 * matter go down with it.
 */

const sample = (over: Partial<Sample> = {}): Sample => ({
  id: 's1', name: 'oak slam', duration: 1, blob: new Blob(), ...over,
});

describe('reading a credit off a filename', () => {
  it('takes the author and the link out of a Freesound name', () => {
    const { name, credit } = creditFromName('Foley/Doors/12345__someone__oak-door-slam.wav');
    expect(name).toBe('oak door slam');
    expect(credit?.author).toBe('someone');
    expect(credit?.url).toBe('https://freesound.org/s/12345/');
    expect(credit?.from).toBe('Freesound');
  });

  /*
   * The licence is not in the name, so it stays unset. Freesound is a mix of
   * CC0, CC-BY and non-commercial, and guessing which would be worse than
   * admitting the file did not say.
   */
  it('does not guess at a licence the name does not carry', () => {
    const { credit } = creditFromName('12345__someone__thing.wav');
    expect(credit?.licence, 'nothing was claimed about the licence').toBeUndefined();
  });

  it('leaves an ordinary filename as a name and nothing else', () => {
    for (const path of ['kick.wav', 'Foley/door.aiff', 'no-extension', '12345_only_one_pair.wav']) {
      const { credit } = creditFromName(path);
      expect(credit, `${path} claims no author`).toBeUndefined();
    }
    expect(creditFromName('Foley/door.aiff').name).toBe('door');
  });

  it('keeps a very long name to something that fits', () => {
    const long = `${'a'.repeat(200)}.wav`;
    expect(creditFromName(long).name.length).toBeLessThanOrEqual(60);
  });
});

describe('what a file was filed under', () => {
  it('is the folders it sat in, not the file itself', () => {
    expect(tagsFromPath('Foley/Doors/oak-slam.wav')).toEqual(['foley', 'doors']);
    expect(tagsFromPath('oak-slam.wav'), 'nothing above it').toEqual([]);
  });

  it('drops the parts that are not a category', () => {
    expect(tagsFromPath('./  /Doors/x.wav'), 'blank and dot are not tags').toEqual(['doors']);
    expect(tagsFromPath(`${'z'.repeat(40)}/Doors/x.wav`), 'and nor is a whole sentence')
      .toEqual(['doors']);
  });
});

describe('the line of credit a sound owes', () => {
  /*
   * The fault this was written after. The check tested the start of the
   * string for `cc0`, and Freesound writes it "Creative Commons 0" -- so
   * every public domain sound in the library was about to be listed as owing
   * a credit it does not owe.
   */
  it('asks for nothing where nothing is owed, however it is spelled', () => {
    const free = [
      'CC0', 'cc0', 'Creative Commons 0', 'creative commons 0',
      'Public Domain', 'publicdomain', 'No Rights Reserved',
    ];
    const owing = free.filter((licence) =>
      creditLine(sample({ credit: { author: 'someone', licence } })) !== null);
    expect(owing, `${owing.length} public domain licences were asked to pay`).toEqual([]);
  });

  it('names the author where a credit is owed', () => {
    const line = creditLine(sample({
      credit: { author: 'someone', licence: 'Attribution', from: 'Freesound', url: 'https://x/' },
    }));
    expect(line, 'there is a line at all').not.toBeNull();
    expect(line).toContain('oak slam');
    expect(line).toContain('someone');
    expect(line).toContain('Attribution');
    expect(line).toContain('https://x/');
  });

  it('asks where the licence was never recorded, rather than assuming', () => {
    // An unknown licence is a reason to check, not a reason to assume.
    expect(creditLine(sample({ credit: { author: 'someone' } }))).not.toBeNull();
    expect(creditLine(sample({ credit: { author: 'someone', licence: '  ' } }))).not.toBeNull();
  });

  it('says nothing about a sound that came with no credit at all', () => {
    expect(creditLine(sample()), 'a sound of your own owes nobody').toBeNull();
  });

  it('still names a non-commercial sound, which is the one that matters most', () => {
    const line = creditLine(sample({
      credit: { author: 'someone', licence: 'Attribution NonCommercial' },
    }));
    expect(line).toContain('NonCommercial');
  });
});
