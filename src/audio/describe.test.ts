import { describe as group, expect, it } from 'vitest';
import { describe as read } from './describe.ts';
import {
  AMOUNT, FILLER, JOINERS, LENGTH, LOUD, NEGATORS, PLACE, PUSH, SIZE, SYNONYMS, TONE,
} from './vocabulary.ts';

/**
 * The words the app says it knows.
 *
 * Typing what you want and getting a sound is the thing this app does that
 * nothing else does, and every word of it is a promise: `vocabulary.ts` is a
 * list of words with meanings attached, and each entry claims that saying
 * that word changes the sound in a particular direction.
 *
 * Nothing checked any of them. A word in one of these tables that no longer
 * reaches the thing it names is the same failure as the soundfont path that
 * fetched samples nothing played -- a listed capability that quietly does
 * nothing -- except worse, because there is no way to tell from outside. A
 * synonym that has stopped working looks like a synonym the app was never
 * going to know.
 *
 * So these sweep every entry rather than sampling. What is asked is only what
 * the table itself claims: that the word is understood, and that it moves the
 * axis it is filed under in the direction its number says.
 */

/** A voice to hang shaping words on, so there is something to shape. */
const SUBJECT = 'hit';

/** What one description settles on, or nothing if it named no voice. */
function first(text: string): ReturnType<typeof read>['suggestions'][number] | null {
  return read(text).suggestions[0] ?? null;
}

/** The same, but insisting there was an answer. */
function shaped(text: string): ReturnType<typeof read>['suggestions'][number] {
  const one = first(text);
  expect(one, `"${text}" was read as something`).not.toBeNull();
  return one as NonNullable<typeof one>;
}

group('every word the vocabulary lists', () => {
  it('is understood rather than handed back as nonsense', () => {
    const tables = { SIZE, LENGTH, PLACE, PUSH, LOUD, TONE, AMOUNT };
    const lost: string[] = [];
    for (const [table, entries] of Object.entries(tables)) {
      for (const word of Object.keys(entries)) {
        if (read(`${word} ${SUBJECT}`).unknown.includes(word)) lost.push(`${table}.${word}`);
      }
    }
    expect(lost, `${lost.length} listed words were not understood`).toEqual([]);
  });

  /*
   * Spelled out, because the sweep below cannot catch a word being renamed.
   *
   * That sweep reads every entry in `SYNONYMS` and asks the describer to find
   * it -- in the same table. Rename an entry and both sides move together, so
   * it passes while the word somebody would actually type has stopped
   * working. Checked by renaming one and watching the sweep not notice.
   *
   * These are typed out instead. They are ordinary things somebody would say
   * about a sound, and if one stops reaching its voice the description engine
   * has lost a word whatever the table says it knows.
   */
  it('answers the words somebody would actually type', () => {
    const expected: readonly (readonly [string, string])[] = [
      ['door', 'slam'], ['clang', 'metal'], ['explosion', 'impact'],
      ['swish', 'whoosh'], ['build', 'riser'], ['bass', 'sub'],
      ['thunder', 'rumble'], ['backwards', 'reverse'], ['wings', 'flutter'],
    ];
    const lost: string[] = [];
    for (const [word, voice] of expected) {
      if (!read(word).suggestions.some((one) => one.voice === voice)) {
        const got = read(word).suggestions.map((one) => one.voice).join(', ') || 'nothing';
        lost.push(`"${word}" should reach ${voice}, gave ${got}`);
      }
    }
    expect(lost, `${lost.length} everyday words lost their voice`).toEqual([]);
  });

  it('names the voice it is a synonym for', () => {
    const lost: string[] = [];
    let checked = 0;
    for (const [voice, words] of Object.entries(SYNONYMS)) {
      for (const word of words) {
        checked += 1;
        const found = read(word).suggestions.some((one) => one.voice === voice);
        if (!found) lost.push(`"${word}" no longer reaches ${voice}`);
      }
    }
    expect(checked, 'the library has synonyms worth sweeping').toBeGreaterThan(100);
    expect(lost, `${lost.length} of ${checked} synonyms lost their voice`).toEqual([]);
  });
});

group('a word moves the axis it is filed under', () => {
  /*
   * Compared against the same voice with nothing said about it, because these
   * are relative: "long" does not mean a number of seconds, it means longer
   * than this voice would otherwise be.
   */
  const plain = () => shaped(SUBJECT);

  it('size lowers and lengthens as it grows', () => {
    const wrong: string[] = [];
    for (const [word, size] of Object.entries(SIZE)) {
      if (size === 0) continue;
      const one = shaped(`${word} ${SUBJECT}`);
      // Positive is small: higher and shorter. Negative is large.
      const wantedHigher = size > 0;
      if (wantedHigher !== one.tune > plain().tune) {
        wrong.push(`${word} (${size}) tuned to ${one.tune}, plain is ${plain().tune}`);
      }
    }
    expect(wrong, `${wrong.length} size words did not move the pitch`).toEqual([]);
  });

  it('length makes it longer or shorter, as its number says', () => {
    const wrong: string[] = [];
    for (const [word, factor] of Object.entries(LENGTH)) {
      const one = shaped(`${word} ${SUBJECT}`);
      const longer = one.length > plain().length;
      if (longer !== factor > 1) {
        wrong.push(`${word} (x${factor}) ran ${one.length.toFixed(3)}s against ${plain().length.toFixed(3)}s`);
      }
    }
    expect(wrong, `${wrong.length} length words went the wrong way`).toEqual([]);
  });

  it('place puts more or less room around it', () => {
    const wrong: string[] = [];
    const dry = shaped(`dry ${SUBJECT}`).space;
    for (const [word, place] of Object.entries(PLACE)) {
      const one = shaped(`${word} ${SUBJECT}`);
      if (place > 0.5 && !(one.space > dry)) {
        wrong.push(`${word} (${place}) gave ${one.space} against ${dry} for dry`);
      }
    }
    expect(wrong, `${wrong.length} place words did not open the room`).toEqual([]);
  });

  /*
   * Push sets the amount rather than adding to it, which is not what it looks
   * like from the table.
   *
   * The first version of this asked that every push word drove the voice
   * harder than it went on its own, and three of them failed: "smooth",
   * "mellow" and "warm" came out at 0.05, 0.05 and 0.2 against a hit that is
   * already dirtier than that. They were right and the test was wrong.
   * "A smooth hit" is a hit with the dirt taken off it, and a word that could
   * only ever add would have no way to say so.
   */
  it('push sets the dirt to the amount the word names', () => {
    const wrong: string[] = [];
    for (const [word, push] of Object.entries(PUSH)) {
      const one = shaped(`${word} ${SUBJECT}`);
      if (Math.abs(one.drive - push) > 1e-6) {
        wrong.push(`${word} asks for ${push}, gave ${one.drive}`);
      }
    }
    expect(wrong, `${wrong.length} push words did not set the dirt`).toEqual([]);
  });

  it('and a harder word than another gives more of it', () => {
    const order = Object.entries(PUSH).sort((a, b) => a[1] - b[1]);
    const softest = shaped(`${order[0][0]} ${SUBJECT}`).drive;
    const hardest = shaped(`${order[order.length - 1][0]} ${SUBJECT}`).drive;
    expect(hardest, `${order[order.length - 1][0]} against ${order[0][0]}`)
      .toBeGreaterThan(softest);
  });

  it('loud makes it louder or quieter', () => {
    const wrong: string[] = [];
    for (const [word, loud] of Object.entries(LOUD)) {
      const one = shaped(`${word} ${SUBJECT}`);
      const louder = one.gain > plain().gain;
      const quieter = one.gain < plain().gain;
      if (loud > 1 && !louder) wrong.push(`${word} (${loud}) gave gain ${one.gain}`);
      if (loud < 1 && !quieter) wrong.push(`${word} (${loud}) gave gain ${one.gain}`);
    }
    expect(wrong, `${wrong.length} loud words did not change the level`).toEqual([]);
  });
});

group('the words that change other words', () => {
  it('a negator cancels the axis it is put in front of', () => {
    const wet = shaped(`cavernous ${SUBJECT}`).space;
    const undone: string[] = [];
    for (const no of NEGATORS) {
      const one = shaped(`${no} cavernous ${SUBJECT}`);
      if (!(one.space < wet)) undone.push(`"${no}" left the room at ${one.space}, wet is ${wet}`);
    }
    expect(undone, `${undone.length} negators did not cancel`).toEqual([]);
  });

  it('an amount word scales what comes after it', () => {
    const once = shaped(`big ${SUBJECT}`).tune;
    const plain = shaped(SUBJECT).tune;
    const weak: string[] = [];
    for (const [word, amount] of Object.entries(AMOUNT)) {
      const one = shaped(`${word} big ${SUBJECT}`).tune;
      // "big" tunes down; more of it must go further down, less not as far.
      const further = one < once;
      const nearer = one > once;
      if (amount > 1 && !further) weak.push(`"${word}" (x${amount}) gave ${one}, plain big is ${once}`);
      if (amount < 1 && !(nearer || one === plain)) {
        weak.push(`"${word}" (x${amount}) gave ${one}, plain big is ${once}`);
      }
    }
    expect(weak, `${weak.length} amount words did not scale`).toEqual([]);
  });

  it('a joining word asks for both voices at once', () => {
    const joined: string[] = [];
    for (const word of JOINERS) {
      const one = shaped(`metal ${word} bell`);
      if (!one.over?.length) joined.push(`"${word}" gave one voice, not two`);
    }
    expect(joined, `${joined.length} joining words did not stack`).toEqual([]);
  });
});

group('words it does not know', () => {
  it('are handed back rather than swallowed', () => {
    const reading = read(`qwrtzk ${SUBJECT} blorptang`);
    expect(reading.unknown).toContain('qwrtzk');
    expect(reading.unknown).toContain('blorptang');
    expect(reading.known, 'and the one it did know is still known').toContain(SUBJECT);
  });

  it('does not count filler as unknown', () => {
    const filler = [...FILLER].slice(0, 12);
    const complained = filler.filter((word) => read(`${word} ${SUBJECT}`).unknown.includes(word));
    expect(complained, 'filler is passed over, not reported').toEqual([]);
  });

  it('says nothing rather than guessing at nothing', () => {
    expect(read('').suggestions).toEqual([]);
    expect(read('   ').suggestions).toEqual([]);
  });
});
