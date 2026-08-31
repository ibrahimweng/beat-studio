import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { loadClip, open, placeSound, pointOn } from './app.ts';

/**
 * Whether the work is still there after a reload.
 *
 * This is the one failure in the app that cannot be undone. A bad export can
 * be exported again; a piece that came back wrong, or came back empty, is an
 * afternoon. And every way it can go wrong is quiet — a dropped field looks
 * like a piece you misremembered, a lost write looks like you never made the
 * edit.
 *
 * So these reload the page rather than reading the store, because what
 * matters is what comes back, and what comes back is read through the same
 * checks a session file goes through.
 */

const cues = (page: Page) => page.locator('.cue');

/**
 * A piece with something in it, and nothing left at its default.
 *
 * The defaults are the trap. A sound placed and left alone comes back
 * correctly even from a reader that has stopped reading its length, because
 * the value it falls back to is the value the sound already had. A restored
 * piece only says something when the piece had something of its own to say.
 *
 * So it is built the way somebody actually builds one: read the clip, take
 * what it suggests, and add a couple by hand. What comes back from that is
 * sounds across more than one layer, at lengths of their own, some set to
 * land on the moment and some to finish on it -- which is every field the
 * marker list writes out, none of them left where they started.
 */
async function makeAPiece(page: Page): Promise<void> {
  await open(page);
  await loadClip(page, { seconds: 5 });

  const find = page.locator('.tl__detect button').first();
  await find.click();
  await expect(find, 'the read finished').toHaveText('Find hits', { timeout: 90_000 });
  await page.getByRole('button', { name: /Accept all/ }).click();

  await placeSound(page, 0.8);
  await expect(cues(page), 'a piece with sounds in it').not.toHaveCount(0);
  // Past the settling delay, so what is on screen is what is written down.
  await page.waitForTimeout(1200);
}

test.describe('what is still there after a reload', () => {
  test.describe.configure({ timeout: 120_000 });

  test('the sounds, and the clip they were placed against', async ({ page }) => {
    await makeAPiece(page);
    const made = await cues(page).count();
    const before = await page.locator('.transport__total').innerText();

    await page.reload();
    await expect(page.locator('.rail__tool').first()).toBeVisible();

    await expect(cues(page), 'the sounds came back').toHaveCount(made);
    await expect(page.locator('.transport__total'), 'and the length with them')
      .toHaveText(before);
    // The picture is kept separately, in a store that has to be waited for.
    await expect(page.locator('video'), 'and the picture itself')
      .toHaveJSProperty('readyState', 4, { timeout: 20_000 });
  });

  /*
   * The last edit, which is the one the wait would lose.
   *
   * Writing is held back until the edits stop, because dragging a sound
   * writes a new project on every movement of the pointer. That wait is
   * exactly as long as the window in which a reload loses your last change,
   * so the page being hidden has to write what is waiting.
   */
  test('an edit made a moment before the reload', async ({ page }) => {
    await makeAPiece(page);
    const made = await cues(page).count();

    /*
     * Taking one away rather than adding one, because the piece already has
     * sounds along it and a click meant to place a new one lands on whatever
     * is already there.
     */
    const spot = await pointOn(page, cues(page).first(), 0.5, { need: 4 });
    await page.mouse.click(spot.x, spot.y);
    await page.keyboard.press('Delete');
    await expect(cues(page)).toHaveCount(made - 1);

    // No pause: straight from the edit into the reload.
    await page.reload();
    await expect(page.locator('.rail__tool').first()).toBeVisible();
    await expect(cues(page), 'the removal was not lost to the wait'
      ).toHaveCount(made - 1);
  });

  /*
   * The one thing that is meant to clear it, and the way out of it.
   *
   * The help says so in as many words -- "New project" is the only thing that
   * gets rid of the kept piece -- which makes it the one place in the app
   * that can lose work nobody meant to lose. So the button asks first, and
   * the answer that matters is the one where somebody changes their mind:
   * a dialog that clears anyway is the whole fault, and unlike the clearing
   * itself, nothing else in the app is quietly guarding against it.
   */
  test('everything, after changing your mind about starting again', async ({ page }) => {
    await makeAPiece(page);
    const made = await cues(page).count();
    await page.locator('.dock__tab', { hasText: 'Session' }).first().click();
    await page.getByRole('button', { name: 'New project', exact: true }).click();

    // It says what it is about to throw away before it does it.
    await expect(page.locator('.ask'), 'it says what it would throw away'
      ).toContainText(/\d+ sounds/);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(cues(page), 'the piece is still on screen').toHaveCount(made);
    await page.reload();
    await expect(page.locator('.rail__tool').first()).toBeVisible();
    await expect(cues(page), 'and still kept').toHaveCount(made);
  });

  test('nothing, after starting again', async ({ page }) => {
    await makeAPiece(page);
    await page.locator('.dock__tab', { hasText: 'Session' }).first().click();
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    await page.getByRole('button', { name: 'Start again', exact: true }).click();

    await expect(cues(page)).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.rail__tool').first()).toBeVisible();
    await expect(cues(page), 'the cleared piece stayed cleared').toHaveCount(0);
  });
});

/*
 * Two tabs, which is the case that used to lose work silently.
 *
 * Both writing to one key means the last to save wins and the other's work
 * disappears with nothing on screen changing. So one tab keeps the piece and
 * the others say so rather than fighting over it.
 */
/*
 * Every field, not just the count.
 *
 * Counting the sounds that came back says nothing about whether they came
 * back as themselves. A piece restored with every sound on the wrong layer,
 * at the wrong level, the wrong length or the wrong anchor has the right
 * number of them, and that is the shape this fault takes: `fromSession`
 * quietly dropping a field looks like a piece you misremembered rather than
 * like anything broken.
 *
 * The marker list is used as the fingerprint because it already writes out
 * everything that decides what a sound is and where it lands -- time, frame,
 * which sound, which layer, whether it starts or ends on the moment, how long
 * it runs and how loud -- as a row per sound. Two exports either side of a
 * reload are as strict a comparison as the app can make of itself.
 */
test('every sound comes back as itself, not just in the right number', async ({ page }) => {
  test.setTimeout(180_000);
  await makeAPiece(page);
  const made = await cues(page).count();

  const fingerprint = async (): Promise<string> => {
    await page.locator('.dock__tab', { hasText: 'Export' }).first().click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Marker list', exact: true }).click(),
    ]);
    return readFileSync(await download.path(), 'utf8');
  };

  const before = await fingerprint();
  expect(before.split('\n').length, 'the piece has sounds in it to compare').toBeGreaterThan(3);

  await page.reload();
  await expect(page.locator('.rail__tool').first()).toBeVisible();
  await expect(cues(page)).toHaveCount(made);

  expect(await fingerprint(), 'the piece came back exactly as it went in').toBe(before);
});

test.describe('a second tab', () => {
  test.describe.configure({ timeout: 120_000 });

  test('says it is not keeping, and does not clobber the first', async ({ context }) => {
    const first = await context.newPage();
    await makeAPiece(first);
    const made = await cues(first).count();

    const second = await context.newPage();
    await open(second);
    await expect(
      second.locator('.keep-notice'),
      'the second tab says it is not the one keeping',
    ).toBeVisible({ timeout: 20_000 });

    // Work in the tab that is not keeping. It must not reach the store.
    await loadClip(second, { seconds: 3 });
    await placeSound(second, 0.5);
    await second.waitForTimeout(2000);

    await first.reload();
    await expect(first.locator('.rail__tool').first()).toBeVisible();
    await expect(cues(first), "the first tab's piece is untouched").toHaveCount(made);
  });
});
