import { describe, expect, it } from 'vitest';
import { LICENCES, creditFor, licenceName, searchUrl, soundUrl } from './freesound.ts';
import type { Found } from './freesound.ts';
import { creditLine } from './samples.ts';

/**
 * Sounds from somebody else's library, and the terms they come with.
 *
 * Freesound writes a licence two different ways depending on which direction
 * it is travelling: its search returns a deed URL, and its search filter
 * takes a name. Storing the URL means showing somebody a URL where a licence
 * should be -- and, worse, it made the check for whether a credit is owed
 * pass by accident, because that URL happens to contain the word
 * "publicdomain". A CC-BY URL contains no word that says so, so the next
 * licence along would have been handled by luck running out.
 *
 * That is what most of these are for: the two spellings meeting the one
 * question that matters, which is whether an author has to be named.
 */

const found = (over: Partial<Found> = {}): Found => ({
  id: 1, name: 'a sound', author: 'someone', duration: 2,
  licence: 'Attribution', url: 'https://freesound.org/s/1/',
  preview: 'https://cdn/preview.mp3', ...over,
} as Found);

describe('a licence, however it arrives', () => {
  it('reads a deed URL as the name of the thing', () => {
    expect(licenceName('http://creativecommons.org/publicdomain/zero/1.0/'))
      .toBe('Creative Commons 0');
    expect(licenceName('https://creativecommons.org/licenses/by/4.0/')).toBe('Attribution');
    expect(licenceName('https://creativecommons.org/licenses/by-nc/4.0/'))
      .toBe('Attribution NonCommercial');
    expect(licenceName('https://creativecommons.org/licenses/by-sa/3.0/'))
      .toBe('Attribution ShareAlike');
    expect(licenceName('https://creativecommons.org/licenses/by-nc-nd/4.0/'))
      .toBe('Attribution NonCommercial NoDerivatives');
  });

  it('leaves a name that is already a name', () => {
    for (const name of ['Attribution', 'Creative Commons 0', 'Sampling+']) {
      expect(licenceName(name), name).toBe(name);
    }
  });

  it('says nothing rather than inventing one', () => {
    for (const raw of [null, undefined, 42, '', '   ', {}]) {
      expect(licenceName(raw), `${JSON.stringify(raw) ?? 'undefined'}`).toBe('');
    }
  });

  /*
   * The two halves meeting.
   *
   * A name read off a deed has to answer the credit question the same way the
   * name would, or the archive's own spelling decides whether an author gets
   * named. Checked as the pair rather than as two separate facts, because
   * either alone was already true when the fault was live.
   */
  it('answers the credit question the same from a URL as from a name', () => {
    const cases: readonly [string, boolean][] = [
      ['http://creativecommons.org/publicdomain/zero/1.0/', false],
      ['https://creativecommons.org/licenses/by/4.0/', true],
      ['https://creativecommons.org/licenses/by-nc/4.0/', true],
      ['https://creativecommons.org/licenses/by-nc-nd/4.0/', true],
    ];
    const wrong: string[] = [];
    for (const [deed, owes] of cases) {
      const sound = found({ licence: licenceName(deed) });
      const line = creditLine({
        id: 'x', name: 'a sound', duration: 1, blob: new Blob(), credit: creditFor(sound),
      });
      if ((line !== null) !== owes) {
        wrong.push(`${deed} -> ${licenceName(deed)} ${line ? 'asked for a credit' : 'asked for none'}`);
      }
    }
    expect(wrong, `${wrong.length} licences answered the wrong way`).toEqual([]);
  });
});

describe('the search URL', () => {
  it('goes to the app own origin, not to Freesound', () => {
    expect(searchUrl('door'), 'nothing cross-origin').not.toMatch(/freesound\.org/);
  });

  it('carries what was asked for', () => {
    const url = new URL(searchUrl('oak door', { licence: 'Creative Commons 0' }), 'https://x');
    expect(url.searchParams.get('what')).toBe('search');
    expect(url.searchParams.get('q')).toBe('oak door');
    expect(url.searchParams.get('licence')).toBe('Creative Commons 0');
  });

  it('leaves the licence out when none was chosen', () => {
    const url = new URL(searchUrl('door'), 'https://x');
    expect(url.searchParams.get('licence'), 'everything comes back').toBeNull();
  });

  it('escapes a query rather than letting it become more parameters', () => {
    const url = new URL(searchUrl('a&what=sound&q=other'), 'https://x');
    expect(url.searchParams.get('q'), 'the whole thing is the query')
      .toBe('a&what=sound&q=other');
    expect(url.searchParams.get('what'), 'and it did not become another instruction')
      .toBe('search');
  });

  it('fetches a sound through the same door', () => {
    const url = new URL(soundUrl(found()), 'https://x');
    expect(url.searchParams.get('what')).toBe('sound');
    expect(url.searchParams.get('from')).toBe('https://cdn/preview.mp3');
  });
});

describe('the licences worth offering', () => {
  it('names each one as the filter writes it', () => {
    expect(LICENCES['Creative Commons 0']).toBe('cc0');
    expect(LICENCES.Attribution).toBe('by');
    expect(LICENCES['Attribution NonCommercial']).toBe('by-nc');
  });

  it('offers only licences a credit line can speak about', () => {
    const mute = Object.keys(LICENCES).filter((name) => licenceName(name) !== name);
    expect(mute, 'every offered licence survives being read back').toEqual([]);
  });
});
