import { describe, expect, it } from 'vitest';
import { DESIGN_NAMES } from '../timeline/types.ts';
import { APPROXIMATE, buildPatch, patchJson, toPatchSound } from './patch.ts';
import { DESIGN_SPECS } from '../audio/design-voices.ts';
import { DESIGN_DEFAULT_LENGTH } from '../timeline/types.ts';

/**
 * The library, written out for somebody else's engine.
 *
 * A patch file is the one thing the app produces that it never reads back, so
 * nothing it does wrong ever shows up here: it is opened somewhere else,
 * weeks later, by somebody who has no way to tell a voice that failed to
 * convert from a voice that was never in the palette.
 *
 * That is the whole reason to check it. A dropped voice, a layer that came
 * out empty, a number written as 1399.9999999999998 -- all of them are
 * invisible from this side, and all of them are somebody else's afternoon.
 */

describe('the patch file', () => {
  const patch = buildPatch();

  it('carries every voice in the palette', () => {
    const missing = DESIGN_NAMES.filter((name) => !(name in patch.sounds));
    expect(missing, `${missing.length} voices did not make it into the file`).toEqual([]);
  });

  it('carries the drum kit as well as the design voices', () => {
    expect(Object.keys(patch.sounds).length, 'more than the design voices alone')
      .toBeGreaterThan(DESIGN_NAMES.length);
  });

  it('gives every sound something to play', () => {
    const empty: string[] = [];
    for (const [name, sound] of Object.entries(patch.sounds)) {
      const layers = 'layers' in sound ? sound.layers : [sound];
      if (!layers.length) empty.push(name);
      for (const layer of layers) {
        if (!layer || typeof layer !== 'object') empty.push(`${name} (a layer that is not one)`);
      }
    }
    expect(empty, `${empty.length} sounds would play nothing`).toEqual([]);
  });

  /*
   * A patch is read by people as well as by machines, and
   * 1399.9999999999998 helps nobody.
   */
  it('writes numbers somebody can read', () => {
    const ugly: string[] = [];
    const look = (where: string, value: unknown): void => {
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) ugly.push(`${where} is ${value}`);
        // More than four places past the point is a number nobody rounded.
        else if (String(value).replace(/^-?\d*\.?/, '').length > 4) {
          ugly.push(`${where} is ${value}`);
        }
      } else if (Array.isArray(value)) value.forEach((one, at) => look(`${where}[${at}]`, one));
      else if (value && typeof value === 'object') {
        for (const [key, one] of Object.entries(value)) look(`${where}.${key}`, one);
      }
    };
    look('sounds', patch.sounds);
    expect(ugly.slice(0, 8), `${ugly.length} numbers were written unrounded`).toEqual([]);
  });

  it('is valid JSON, and says what it is', () => {
    const text = patchJson();
    const parsed = JSON.parse(text) as typeof patch;
    expect(parsed.name).toBe('Beat Studio');
    expect(parsed.$schema, 'it names the shape it is written to').toBeTruthy();
    expect(parsed.version, 'and the version of it').toBeTruthy();
    expect(text.endsWith('\n'), 'and ends with a newline, like a file should').toBe(true);
  });

  /*
   * The same file every time.
   *
   * `glitch` scatters its bursts at random, so this failed when it was
   * written: two exports of one palette gave two different files, and
   * anybody keeping one under version control got a diff for having pressed
   * the button twice. The voices are built from a fixed draw now.
   */
  it('is the same file every time it is written', () => {
    expect(patchJson()).toBe(patchJson());
  });
});

describe('converting one voice', () => {
  it('keeps a single-layer voice as one layer, not a list of one', () => {
    const single = DESIGN_NAMES.map((name) => ({
      name,
      spec: DESIGN_SPECS[name]({ length: DESIGN_DEFAULT_LENGTH[name], tune: 0, gain: 1 }),
    })).find((one) => one.spec.layers.length === 1);
    expect(single, 'the palette has a one-layer voice to check').toBeTruthy();
    const converted = toPatchSound(single!.spec);
    expect('layers' in converted, `${single!.name} was wrapped in a list`).toBe(false);
  });

  it('keeps every layer of a voice made of several', () => {
    const many = DESIGN_NAMES.map((name) => ({
      name,
      spec: DESIGN_SPECS[name]({ length: DESIGN_DEFAULT_LENGTH[name], tune: 0, gain: 1 }),
    })).filter((one) => one.spec.layers.length > 1);
    expect(many.length, 'the palette has voices in layers').toBeGreaterThan(0);

    const lost: string[] = [];
    for (const { name, spec } of many) {
      const converted = toPatchSound(spec);
      const out = 'layers' in converted ? converted.layers.length : 1;
      // A layer this format cannot express is dropped rather than faked, so
      // what is asked is that something survived, not that everything did.
      if (out === 0) lost.push(`${name} lost all ${spec.layers.length} of its layers`);
    }
    expect(lost, `${lost.length} voices came out empty`).toEqual([]);
  });
});

/*
 * The honesty table.
 *
 * Some voices do not survive the conversion cleanly, and the file says which
 * and why rather than leaving somebody to find out. What is checked here is
 * that the list stays true to itself: a score is a fraction, every entry
 * names a voice that exists, and each one gives a reason rather than a
 * number on its own.
 */
describe('what the file admits it approximates', () => {
  it('names voices that are actually in the palette', () => {
    const strangers = Object.keys(APPROXIMATE)
      .filter((name) => !(name in buildPatch().sounds));
    expect(strangers, `${strangers.length} entries name nothing`).toEqual([]);
  });

  it('scores each one as a fraction, and says what is lost', () => {
    for (const [name, { match, why }] of Object.entries(APPROXIMATE)) {
      expect(match, `${name} scores within range`).toBeGreaterThan(0);
      expect(match, `${name} scores within range`).toBeLessThanOrEqual(1);
      expect(why.length, `${name} explains itself in words`).toBeGreaterThan(20);
    }
  });

  /*
   * Everything under 0.93 is listed, and one thing above it is.
   *
   * `reverse` scores 0.973 and is here anyway, because what it does there is
   * not what it does here: a buffer read backwards has no expression in that
   * format, so it is rewritten rather than approximated. Named rather than
   * left as an exception the next reader has to work out, and anything else
   * scoring well is a voice that was fixed and never taken off the list.
   */
  it('lists everything that scores badly, and nothing else but reverse', () => {
    const REWRITTEN = new Set(['reverse']);
    const stale = Object.entries(APPROXIMATE)
      .filter(([name, one]) => one.match > 0.93 && !REWRITTEN.has(name))
      .map(([name, one]) => `${name} scores ${one.match}`);
    expect(stale, `${stale.length} no longer need the caveat`).toEqual([]);
  });
});
