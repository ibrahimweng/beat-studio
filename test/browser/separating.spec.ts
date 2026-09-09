import { expect, test } from '@playwright/test';
import { open } from './app.ts';

/**
 * Taking a beat apart, in a real browser.
 *
 * What only a browser can answer here is not the arithmetic — that is measured in
 * Node, in `src/audio/separate/` — but whether the screen exists, whether it can
 * be reached, and whether the parts actually arrive on the timeline. Those are
 * layout, wiring and one file input, and every one of them is a thing that has
 * shipped broken in this app before.
 *
 * The beat is built here rather than committed, for the same reason the clip in
 * `app.ts` is recorded in the page: no binary in the repository that somebody has
 * to take on trust. A kick, a hat on every half beat and a held tone, in stereo so
 * that where things sit can be read.
 */

const RATE = 44_100;

/** A kick: a low sine falling in pitch, under a short burst of noise. */
function kick(into: Float32Array, at: number): void {
  const start = Math.round(at * RATE);
  const length = Math.round(0.3 * RATE);
  let phase = 0;
  let noise = 12345;
  for (let i = 0; i < length && start + i < into.length; i++) {
    const along = i / length;
    const hz = 110 * Math.exp(-4 * along) + 45;
    phase += (2 * Math.PI * hz) / RATE;
    noise = (noise * 1103515245 + 12345) & 0x7fffffff;
    const click = i < RATE * 0.004 ? (noise / 0x3fffffff - 1) * 0.25 : 0;
    into[start + i] += (Math.sin(phase) * 0.8 + click) * Math.exp(-5 * along);
  }
}

/** A hat: a very short burst of high noise. */
function hat(into: Float32Array, at: number): void {
  const start = Math.round(at * RATE);
  const length = Math.round(0.05 * RATE);
  let noise = 777;
  let last = 0;
  for (let i = 0; i < length && start + i < into.length; i++) {
    noise = (noise * 1103515245 + 12345) & 0x7fffffff;
    const white = noise / 0x3fffffff - 1;
    // A crude difference, which is a high pass: a hat is all top.
    const bright = white - last;
    last = white;
    into[start + i] += bright * 0.35 * Math.exp((-12 * i) / length);
  }
}

/** A held tone, for the parts that are not drums. */
function held(into: Float32Array, hz: number, gain: number): void {
  for (let i = 0; i < into.length; i++) into[i] += Math.sin((2 * Math.PI * hz * i) / RATE) * gain;
}

/** A beat as a 16-bit stereo WAV, as long as it is asked for. */
function beatWav(seconds = 4): Buffer {
  const frames = RATE * seconds;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);

  for (const [into, other] of [[left, right] as const]) {
    for (let beat = 0; beat * 0.5 < seconds - 0.5; beat++) {
      // Kick on every beat, hat on every half beat, both dead centre.
      if (beat % 2 === 0) {
        kick(into, 0.25 + beat * 0.5);
        kick(other, 0.25 + beat * 0.5);
      }
      hat(into, 0.5 + beat * 0.5);
      hat(other, 0.5 + beat * 0.5);
    }
  }
  // Centred, so it reads as the thing in front. And one pushed to the left, so
  // there is something for the rest.
  held(left, 330, 0.12);
  held(right, 330, 0.12);
  held(left, 520, 0.12);

  const bytes = 2;
  const data = frames * 2 * bytes;
  const view = new DataView(new ArrayBuffer(44 + data));
  const text = (at: number, what: string): void => {
    for (let i = 0; i < what.length; i++) view.setUint8(at + i, what.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2 * bytes, true);
  view.setUint16(32, 2 * bytes, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, data, true);

  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (const lane of [left, right]) {
      const value = Math.max(-1, Math.min(1, lane[i]));
      view.setInt16(at, Math.round(value * (value < 0 ? 0x8000 : 0x7fff)), true);
      at += 2;
    }
  }
  return Buffer.from(view.buffer);
}

/** Open the app on the screen that takes recordings apart, with a beat in it. */
async function takeApart(
  page: import('@playwright/test').Page,
  seconds = 4,
): Promise<void> {
  await open(page);
  await page.locator('.rail__screen[data-screen="separate"]').click();
  await expect(page.locator('.sep')).toBeVisible();

  await page.setInputFiles('.sep input[type=file]', {
    name: 'beat.wav',
    mimeType: 'audio/wav',
    buffer: beatWav(seconds),
  });
  // The rows are the app itself saying it is done, rather than a guess at how
  // long the work takes.
  await expect(page.locator('.sep__row')).toHaveCount(4, { timeout: 60_000 });
}

/**
 * Wait for the app to be back after a reload.
 *
 * The walkthrough is marked as seen by the first visit, so it does not come back.
 * The tools appearing is the app saying it is up, which is the same thing `open`
 * waits for on a first visit.
 */
async function settled(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('.rail__tool').first()).toBeVisible();
}

/**
 * One row's button, by the word on it.
 *
 * Matched exactly. Asking for the button whose text contains "S" also finds
 * "Hits", which is the kind of thing that makes a test click the wrong control
 * and then fail somewhere else entirely.
 */
function rowButton(
  page: import('@playwright/test').Page,
  part: string,
  name: string,
): import('@playwright/test').Locator {
  return page
    .locator(`.sep__row[data-part="${part}"]`)
    .getByRole('button', { name, exact: true });
}

/**
 * The names on the rows.
 *
 * A part's name is a box you can type in rather than a line of text, because it
 * is the person's to give — so what is on screen is its value and not its
 * contents, and `allInnerTexts` comes back with a row of empty strings.
 */
async function namesShown(
  page: import('@playwright/test').Page,
  where: string,
): Promise<string[]> {
  return page.locator(where).evaluateAll((boxes) =>
    boxes.map((box) => (box as HTMLInputElement).value),
  );
}

/** How many recordings the picker is showing, or null when it shows none. */
async function recordingsShown(page: import('@playwright/test').Page): Promise<number | null> {
  await page.locator('.rail__screen[data-screen="design"]').click();
  await page.locator('.dock__tab', { hasText: 'Sounds' }).first().click();
  const group = page.locator('.pick-group__title', { hasText: 'Recordings' });
  if (!(await group.count())) return null;
  const said = await group.first().innerText();
  return Number(/Recordings · (\d+)/.exec(said)?.[1] ?? '0');
}

test.describe('naming a part', () => {
  /*
   * The name is the person's to give, because the measurements cannot give it.
   *
   * They can say a line is bright and steady between G4 and D5. They cannot say
   * it is a viola, and no arithmetic here ever will — that needs a model trained
   * on instruments, which is the one thing this is built not to need. Somebody
   * listening knows in a second, so the row lets them write it down.
   */
  test('takes a name of your own, and the recording takes it too', async ({ page }) => {
    await takeApart(page);
    const name = page.locator('.sep__row[data-part="tonal"] .sep__title');
    await expect(name).toHaveValue('Tonal');

    // Typed rather than filled, one key at a time, because the space bar is the
    // point: this screen has no transport and used to swallow it.
    await name.fill('');
    await name.pressSequentially('Second violins');
    await name.press('Enter');
    await expect(name).toHaveValue('Second violins');

    /*
     * And the recording is called that too.
     *
     * A part and the recording it was registered as are the same thing under two
     * names, so placing it puts this name on a layer — and a layer called
     * "Tonal" helps nobody. Only the part of the name is renamed; where it came
     * from stays on the end.
     */
    await page.locator('.rail__screen[data-screen="design"]').click();
    await page.locator('.dock__tab', { hasText: 'Sounds' }).first().click();
    await page.locator('.pick-find--held').fill('Second violins');
    await expect(page.locator('.pick-group__title', { hasText: 'Recordings' })).toContainText(
      '1 of 4',
    );
  });

  test('puts the old name back on Escape', async ({ page }) => {
    await takeApart(page);
    const name = page.locator('.sep__row[data-part="drums"] .sep__title');
    await name.fill('Kit');
    await name.press('Escape');
    await expect(name).toHaveValue('Drums');
  });

  test('says what each line sounds like, so there is something to name it from', async ({
    page,
  }) => {
    await takeApart(page);
    await page.locator('.sep__row[data-part="tonal"] button', { hasText: 'Open' }).click();
    // The lines inside come back described: how bright, and whether the pitch
    // holds still. Both are measured; neither is a guess at an instrument.
    await expect(
      page.locator('.sep__row.is-inside .sep__about').filter({ hasText: /pure tone|warm|bright/ }).first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});

test.describe('taking apart a stretch of it', () => {
  /*
   * The stretch appears after the first separation, not before it.
   *
   * Dropping a file in and getting the parts back is what the screen is for, so
   * the stretch is the second question rather than a form in front of the first.
   * By the time it is asked there is a length to choose from and a file still in
   * hand, which is why the boxes can be filled in with the whole recording.
   */
  test('offers the whole recording once there is one', async ({ page }) => {
    await takeApart(page, 8);
    await expect(page.locator('.sep__span')).toBeVisible();
    await expect(page.locator('.sep__time').first()).toHaveValue('0:00');
    await expect(page.locator('.sep__time').nth(1)).toHaveValue('0:08');
    await expect(page.locator('.sep__of')).toHaveText('of 0:08');
    // Nothing to go back to yet, so there is nothing offering to.
    await expect(page.getByRole('button', { name: 'All of it' })).toBeDisabled();
  });

  test('takes apart only the stretch it is given', async ({ page }) => {
    await takeApart(page, 8);
    await page.locator('.sep__time').first().fill('0:02');
    await page.locator('.sep__time').nth(1).fill('0:06');
    await page.getByRole('button', { name: 'Take apart this stretch' }).click();

    await expect(page.locator('.sep__row')).toHaveCount(4, { timeout: 60_000 });
    await expect(page.locator('.sep .appbar__title')).toHaveText('beat.wav · 0:02–0:06');
  });

  /*
   * The parts say which stretch they came out of.
   *
   * They are registered as recordings the moment they exist, and a library with
   * two separations of the same track in it is unreadable if every part is
   * called "Drums · beat.wav". The stretch is the only thing that tells them
   * apart, so it goes in the name.
   */
  test('names the parts after the stretch they came from', async ({ page }) => {
    await takeApart(page, 8);
    await page.locator('.sep__time').first().fill('0:02');
    await page.locator('.sep__time').nth(1).fill('0:06');
    await page.getByRole('button', { name: 'Take apart this stretch' }).click();
    await expect(page.locator('.sep__row')).toHaveCount(4, { timeout: 60_000 });

    /*
     * Found by searching for the stretch, which is the way somebody would.
     *
     * The picker only draws the first dozen of a library, so looking for a name
     * among the buttons finds whichever twelve happened to be drawn. The search
     * counts all of them, and the count in the group's title is the answer.
     */
    await page.locator('.rail__screen[data-screen="design"]').click();
    await page.locator('.dock__tab', { hasText: 'Sounds' }).first().click();

    const recordings = page.locator('.pick-group__title', { hasText: 'Recordings' });
    await page.locator('.pick-find--held').fill('0:02–0:06');
    await expect(recordings).toContainText('Recordings · 4');
    // And a stretch that was never taken apart finds none of them, which is
    // what makes the first half of this a claim rather than a coincidence.
    await page.locator('.pick-find--held').fill('7:31–9:02');
    await expect(recordings).toContainText('0 of 4');
  });

  test('goes back to all of it', async ({ page }) => {
    await takeApart(page, 8);
    await page.locator('.sep__time').first().fill('0:02');
    await page.locator('.sep__time').nth(1).fill('0:06');
    await page.getByRole('button', { name: 'Take apart this stretch' }).click();
    await expect(page.locator('.sep .appbar__title')).toHaveText('beat.wav · 0:02–0:06', {
      timeout: 60_000,
    });

    await page.getByRole('button', { name: 'All of it' }).click();
    await expect(page.locator('.sep .appbar__title')).toHaveText('beat.wav · 0:08', {
      timeout: 60_000,
    });
    await expect(page.locator('.sep__time').first()).toHaveValue('0:00');
    await expect(page.locator('.sep__time').nth(1)).toHaveValue('0:08');
  });

  /*
   * A stretch too short to mean anything is refused rather than attempted.
   *
   * Half a second is very nearly all edge — the widest median reaches a fifth of
   * a second either way — so it would come back looking broken rather than
   * looking short, and nobody asks for it on purpose.
   */
  test('refuses a stretch that is only edges', async ({ page }) => {
    await takeApart(page, 8);
    await page.locator('.sep__time').first().fill('0:02');
    await page.locator('.sep__time').nth(1).fill('0:02');
    await page.getByRole('button', { name: 'Take apart this stretch' }).click();

    await expect(page.locator('.sep__said')).toContainText('at least 1 seconds');
    // And the parts that were already there are still there.
    await expect(page.locator('.sep__row')).toHaveCount(4);
  });
});

test.describe('taking a beat apart', () => {
  test('comes back as four parts, and says what it found', async ({ page }) => {
    await takeApart(page);

    const names = await namesShown(page, '.sep__title');
    expect(names).toEqual(['Drums', 'Bass', 'Lead', 'Tonal']);

    /*
     * Every part says how much of the recording it holds.
     *
     * With a decimal place under ten per cent, because everything in the tree is a
     * share of the same thing and a hi-hat file is a couple of per cent of a track
     * however much of the drums it is. Rounded to whole numbers, four rows inside
     * the drums all read "0%" and the list says nothing.
     */
    const shares = await page.locator('.sep__share').allInnerTexts();
    expect(shares).toHaveLength(4);
    for (const share of shares) expect(share).toMatch(/^\d+(\.\d)?%$/);

    /*
     * The evidence, not a score.
     *
     * Whether a loop was found and whether there were two channels to read a
     * position from are what decide how much of the work each measurement did.
     * Somebody looking at four parts has no other way to know.
     */
    await expect(page.locator('.sep__notes')).toContainText('two channels');
  });

  /*
   * A waveform that is actually drawn.
   *
   * The kind of thing that ships broken: an SVG made in the wrong namespace looks
   * right in the document and draws nothing at all, and this app has that fault
   * on record — which is why `dom.ts` has a separate helper for SVG.
   */
  test('draws a waveform for every part', async ({ page }) => {
    await takeApart(page);
    const paths = page.locator('.sep__path');
    await expect(paths).toHaveCount(4);
    for (let at = 0; at < 4; at++) {
      const box = await paths.nth(at).boundingBox();
      expect(box, `part ${at} drew nothing`).not.toBeNull();
      expect((box as { width: number }).width).toBeGreaterThan(100);
    }
  });

  test('opens the drums into the drums', async ({ page }) => {
    await takeApart(page);
    await page.locator('.sep__row[data-part="drums"] button', { hasText: 'Open' }).click();

    // More rows than the four, and the new ones sit in from their parent.
    await expect(page.locator('.sep__row')).not.toHaveCount(4, { timeout: 60_000 });
    await expect(page.locator('.sep__row.is-inside').first()).toBeVisible();
    const inside = await namesShown(page, '.sep__row.is-inside .sep__title');
    expect(inside).toContain('Kick');
    // What no hit accounted for is a part like the others, because the parts have
    // to add up.
    expect(inside).toContain('Rest');

    // And folds back up again.
    await page.locator('.sep__row[data-part="drums"] button', { hasText: 'Fold up' }).click();
    await expect(page.locator('.sep__row')).toHaveCount(4);
  });

  /*
   * The whole point of the screen: the parts reach the piece.
   *
   * A layer each, at the start, and the app goes back to the timeline — because
   * having taken a beat apart, what somebody wants next is to work with it.
   */
  test('places the parts on the timeline, one layer each', async ({ page }) => {
    await takeApart(page);
    const layersBefore = await page.locator('.tl__layer-name, .tl__layer').count();

    await page.getByRole('button', { name: 'Place on the timeline' }).click();

    // Back on the timeline, with a sound per part.
    await expect(page.locator('.sep')).toBeHidden();
    await expect(page.locator('.cue')).toHaveCount(4);
    expect(await page.locator('.tl__layer-name, .tl__layer').count()).toBeGreaterThan(
      layersBefore,
    );
  });

  /*
   * The tools belong to the timeline, and there is no timeline here.
   *
   * Out of reach rather than gone: a strip that changes length when you change
   * screen makes the whole window shift, and a tool that has quietly disappeared
   * is worse to come back to than one that is plainly not available yet.
   */
  test('puts the timeline tools out of reach', async ({ page }) => {
    await open(page);
    await expect(page.locator('.rail__tool').first()).toBeEnabled();
    await page.locator('.rail__screen[data-screen="separate"]').click();
    await expect(page.locator('.rail__tool').first()).toBeDisabled();
    await page.locator('.rail__screen[data-screen="design"]').click();
    await expect(page.locator('.rail__tool').first()).toBeEnabled();
  });

  /*
   * Hearing one part against the others, which is what the screen is for.
   *
   * Its own playback path rather than the timeline's, because these are not on
   * the timeline. What is checked is the state the screen reports, not the sound:
   * a headless browser has no speakers, and whether a buffer source was started
   * is not something a test can hear.
   */
  test('plays one part on its own, and stops', async ({ page }) => {
    await takeApart(page);
    const play = rowButton(page, 'drums', '▶');
    await play.click();
    await expect(rowButton(page, 'drums', '■')).toBeVisible();

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(rowButton(page, 'drums', '▶')).toBeVisible();
  });

  /*
   * Holding a part down, and hearing one on its own.
   *
   * Solo has to quieten the others rather than only mark itself, or the screen
   * says one thing and the playback does another.
   */
  test('holds a part down and hears one on its own', async ({ page }) => {
    await takeApart(page);
    const drums = page.locator('.sep__row[data-part="drums"]');
    const bass = page.locator('.sep__row[data-part="bass"]');

    await rowButton(page, 'drums', 'M').click();
    await expect(drums).toHaveClass(/is-quiet/);
    await expect(bass).not.toHaveClass(/is-quiet/);
    await rowButton(page, 'drums', 'M').click();
    await expect(drums).not.toHaveClass(/is-quiet/);

    await rowButton(page, 'bass', 'S').click();
    await expect(bass).toHaveClass(/is-solo/);
    await expect(drums).toHaveClass(/is-quiet/);
  });

  /*
   * Reading a part back into the palette.
   *
   * The hand-off this feature exists for, and the one that never worked on a
   * whole mix: the finder hears one sound where a kick and a hat played together,
   * and the rebuild then searches for a single voice that is both. A short beat
   * is used because rebuilding is a search of forty voices per sound found, and
   * this is checking the wiring rather than the search.
   */
  test('reads a part back into the palette', async ({ page }) => {
    await takeApart(page, 2);
    await rowButton(page, 'drums', 'Rebuild').click();

    // It goes back to the timeline, because that is where the rebuilt sounds
    // are of any use.
    await expect(page.locator('.sep')).toBeHidden();
    await expect(page.locator('.heard-row').first()).toBeVisible({ timeout: 120_000 });
    // Every one offers ways of making it rather than one answer, because the app
    // cannot tell which is right.
    await expect(page.locator('.heard-row').first().locator('.heard-way__match').first())
      .toBeVisible();
  });

  /*
   * Putting the chosen sound on every hit in a part.
   *
   * The same idea as reading the hits out of a picture, with a beat instead. The
   * sound placed is whatever is armed in the library, which is why this does not
   * click a row first: clicking one would arm that part and place the recording
   * on top of itself.
   */
  test('puts the chosen sound on every hit in a part', async ({ page }) => {
    await takeApart(page, 2);
    expect(await page.locator('.cue').count()).toBe(0);

    await rowButton(page, 'drums', 'Hits').click();
    await expect(page.locator('.sep')).toBeHidden();
    await expect(page.locator('.cue').first()).toBeVisible({ timeout: 120_000 });
    expect(await page.locator('.cue').count()).toBeGreaterThan(1);
  });

  /*
   * Writing the parts out.
   *
   * One file per part, and the names carry the part they came from so a folder of
   * them can be read without opening any.
   */
  test('writes every part out as a file', async ({ page }) => {
    await takeApart(page);
    const saved: string[] = [];
    page.on('download', (file) => saved.push(file.suggestedFilename()));

    await page.getByRole('button', { name: 'Write the files' }).click();
    await expect.poll(() => saved.length, { timeout: 30_000 }).toBe(4);
    expect(saved.every((name) => name.endsWith('.wav'))).toBe(true);
    expect(saved.some((name) => name.includes('drums'))).toBe(true);
  });
});

/*
 * What is kept, and what is not.
 *
 * A separated part is registered as a recording straight away, so it is in the
 * picker and can be placed. It is not written into the browser's own store until
 * one is used. Four parts of a three minute track is a couple of hundred
 * megabytes, and putting all of that away before anybody has said they want any
 * of it would be slow and mostly wasted.
 *
 * Both halves of that fail silently, which is why they are tested. If the first
 * broke, a part somebody placed would be gone after a reload. If the second
 * broke, every track ever separated would stay in storage forever. Only a browser
 * can answer either, because both are about what a reload finds.
 */
test.describe('keeping the parts', () => {
  test('shows the parts in the picker as soon as they exist', async ({ page }) => {
    await takeApart(page);
    expect(await recordingsShown(page)).toBe(4);
  });

  test('forgets the parts nobody used', async ({ page }) => {
    await takeApart(page);
    expect(await recordingsShown(page)).toBe(4);

    await page.locator('.rail__screen[data-screen="separate"]').click();
    await page.getByRole('button', { name: 'Forget' }).click();
    await expect(page.locator('.sep__row')).toHaveCount(0);

    expect(await recordingsShown(page)).toBeNull();
  });

  test('does not write down a part nobody used', async ({ page }) => {
    await takeApart(page);
    expect(await recordingsShown(page)).toBe(4);

    await page.reload();
    await settled(page);
    expect(await recordingsShown(page)).toBeNull();
  });

  /*
   * And keeps the ones that were used.
   *
   * Placing a part on the timeline is what says you want it. From then on it is a
   * recording like any other, so it survives a reload along with the piece that
   * uses it.
   */
  test('keeps a part once it is placed', async ({ page }) => {
    await takeApart(page);
    await page.getByRole('button', { name: 'Place on the timeline' }).click();
    await expect(page.locator('.cue')).toHaveCount(4);

    await page.reload();
    await settled(page);
    // The piece comes back with its sounds on it, and the recordings they name
    // come back with it.
    await expect(page.locator('.cue')).toHaveCount(4);
    expect(await recordingsShown(page)).toBe(4);
  });
});

