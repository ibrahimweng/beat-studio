import { expect, test, type Page } from '@playwright/test';
import { loadClip, open } from './app.ts';

/**
 * Waiting for the video to be read, which is the longest wait in the app.
 *
 * Reading runs at about half the length of the clip — measured at 0.53 to
 * 0.58 times realtime across several clips — so a three minute video is a
 * minute and a half and a ten minute one is five. That rate is not a
 * carelessness: sampling half as often halves the wait and finds nine fewer
 * of forty moments on a dense clip, which was measured before touching it and
 * is why the rate is left alone.
 *
 * What was wrong was everything around the wait. The button that starts the
 * read showed a percentage and greyed itself out, so there was no way to know
 * how much longer and no way to stop — loading the wrong file meant waiting it
 * out or reloading the page.
 */

const findButton = (page: Page) => page.locator('.tl__detect button').first();

test.describe('reading the video', () => {
  /*
   * Longer than the default, because these wait for real work.
   *
   * Reading a twenty second clip is about eleven seconds on top of making and
   * loading it, and two of these read it twice.
   */
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await open(page);
    await loadClip(page, { seconds: 20 });
  });

  /*
   * How long is left, not how far through.
   *
   * A percentage answers a question nobody has. The one somebody does have is
   * whether to wait or go and do something else.
   */
  test('says how long is left', async ({ page }) => {
    await findButton(page).click();

    await expect
      .poll(async () => (await findButton(page).innerText()).trim(), {
        message: 'it started saying how long is left',
      })
      .toMatch(/Reading · \d+s left/);

    // And it counts down rather than sitting on one number.
    const first = Number((await findButton(page).innerText()).match(/(\d+)s/)![1]);
    await expect
      .poll(async () => {
        const now = (await findButton(page).innerText()).match(/(\d+)s/);
        return now ? Number(now[1]) : 0;
      })
      .toBeLessThan(first);
  });

  /* The way out, which is the button already under the pointer. */
  test('can be stopped, and keeps nothing', async ({ page }) => {
    await findButton(page).click();
    await expect(findButton(page), 'live while it works, because it is the way out')
      .toBeEnabled();
    await expect.poll(async () => (await findButton(page).innerText()).trim()).toContain('Reading');

    await findButton(page).click();
    await expect(findButton(page)).toHaveText('Find hits');
    await expect(page.locator('.tl__status')).toContainText('stopped reading');
    // Nothing half-offered: a pass over part of a clip would suggest sounds
    // for that part and say nothing about the rest, which reads as the app
    // having found nothing there.
    await expect(page.locator('.dock--right .dock__body')).toContainText('Nothing found yet');

    /*
     * And it stays stopped.
     *
     * Resetting what is on screen is not stopping. A read that was only
     * forgotten about carries on in the background and hands its results in
     * half a minute later, so moments appear out of nowhere long after
     * somebody pressed stop — which is worse than not having stopped at all.
     * Waited out past the point the whole clip would have been read.
     */
    await page.waitForTimeout(15_000);
    await expect(findButton(page), 'nothing came back').toHaveText('Find hits');
    await expect(page.locator('.dock--right .dock__body')).toContainText('Nothing found yet');
    await expect(page.locator('.tl__status')).not.toContainText('moments found');
  });

  test('and can be started again afterwards', async ({ page }) => {
    await findButton(page).click();
    await expect.poll(async () => (await findButton(page).innerText()).trim()).toContain('Reading');
    await findButton(page).click();
    await expect(findButton(page)).toHaveText('Find hits');

    await findButton(page).click();
    await expect(findButton(page), 'it read the whole clip the second time')
      .toHaveText('Find hits', { timeout: 120_000 });
    await expect(page.locator('.tl__status')).toContainText('moments found');
  });

  test('finds the moments when it is left to finish', async ({ page }) => {
    await findButton(page).click();
    await expect(findButton(page)).toHaveText('Find hits', { timeout: 120_000 });
    await expect(page.locator('.tl__status')).toContainText('moments found');
    await expect(page.locator('.dock--right .dock__body')).toContainText('waiting on you');
  });
});
