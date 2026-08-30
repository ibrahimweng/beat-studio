import { expect, test, type Page } from '@playwright/test';
import { loadClip, open } from './app.ts';

/**
 * How far the timeline can be zoomed, which was decided by a constant.
 *
 * Eight pixels a second was the floor for every piece, and a fixed number
 * cannot know how long a piece is. It was wrong at both ends. A ten minute
 * piece could not be fitted at all: Fit works out the scale that would show
 * the whole thing, the floor clamped it, and you were left looking at a fifth
 * of your work with a button that had promised the whole of it and said
 * nothing about failing. A five second piece had the opposite problem —
 * zooming out squeezed all five seconds into the leftmost forty pixels of an
 * eight hundred pixel timeline, and kept offering to go further.
 *
 * The bound comes from the piece now: as far out as the whole of it and no
 * further, since there is nothing past the end of a piece to look at.
 */

/** How much of the piece is on screen, and where its end falls. */
async function view(page: Page) {
  return page.evaluate(() => {
    const content = document.querySelector('.tl__content') as HTMLElement;
    const frame = document.querySelector('.tl__viewport') as HTMLElement;
    return {
      content: content.getBoundingClientRect().width,
      frame: frame.clientWidth,
    };
  });
}

const fit = (page: Page) => page.getByRole('button', { name: 'Fit', exact: true }).click();
const zoomOut = (page: Page) => page.getByRole('button', { name: '−', exact: true });

/** Set the length of the piece through the transport, as a person would. */
async function setLength(page: Page, seconds: string) {
  await page.locator('.transport__total').click();
  const box = page.getByLabel('Length of the piece');
  await box.fill(seconds);
  await box.press('Enter');
  await expect(page.locator('.transport__total')).not.toHaveText('00:00:00:00');
}

test.describe('fitting the piece', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await loadClip(page, { seconds: 5 });
  });

  /*
   * The one that shipped broken, at the three lengths that show it.
   *
   * A clip long enough to matter is the ordinary case for this app, and the
   * old floor stopped fitting anything past about a minute and three
   * quarters — so nearly every real video.
   */
  for (const [label, seconds] of [['a minute', '60'], ['three minutes', '180'], ['ten minutes', '600']] as const) {
    test(`Fit shows the whole of ${label}`, async ({ page }) => {
      await setLength(page, seconds);
      await fit(page);

      const seen = await view(page);
      // Within a pixel, since the content carries a little padding past the
      // end and the frame is measured to the whole pixel.
      expect(seen.content, `${label} did not fit`).toBeLessThanOrEqual(seen.frame + 1);
    });
  }

  test('and a short piece is fitted the moment it loads', async ({ page }) => {
    const seen = await view(page);
    expect(seen.content).toBeLessThanOrEqual(seen.frame + 1);
  });

  /*
   * Zooming out stops at the whole piece rather than carrying on past it.
   *
   * Left unbounded it went to the same fixed floor whatever the piece was, so
   * on a short one the work ended up crammed into the left of an otherwise
   * empty timeline.
   */
  test('zooming out stops when the whole piece is showing', async ({ page }) => {
    await setLength(page, '120');
    let guard = 0;
    while (await zoomOut(page).isEnabled()) {
      await zoomOut(page).click();
      guard += 1;
      expect(guard, 'zooming out never stopped').toBeLessThan(30);
    }

    const seen = await view(page);
    expect(seen.content, 'it went no further than the whole piece')
      .toBeLessThanOrEqual(seen.frame + 1);
    expect(seen.content, 'and no further than that').toBeGreaterThan(seen.frame * 0.6);
  });

  /*
   * And the buttons say which way is still open.
   *
   * The state has to be refreshed when the bounds move rather than only when
   * the scale does: making the piece longer opens up room to zoom out that
   * was not there a moment before, and a button still greyed out from the
   * shorter piece is a button that lies.
   */
  test('the zoom buttons say which way is still open', async ({ page }) => {
    await fit(page);
    await expect(zoomOut(page), 'nothing further out to go').toBeDisabled();

    await setLength(page, '300');
    await expect(zoomOut(page), 'a longer piece opens the way out again').toBeEnabled();

    await fit(page);
    await expect(zoomOut(page), 'and fitting closes it again').toBeDisabled();
  });

  /*
   * A window with more room in it needs more pixels a second to hold the same
   * piece, so a fitted view would otherwise sit in the left of the window
   * with a margin beside it.
   */
  test('a fitted view stays fitted when the window grows', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await setLength(page, '240');
    await fit(page);
    const before = await view(page);
    expect(before.content).toBeLessThanOrEqual(before.frame + 1);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect
      .poll(async () => {
        const seen = await view(page);
        return seen.content <= seen.frame + 1 && seen.content > seen.frame * 0.9;
      }, { message: 'it refitted to the wider window' })
      .toBe(true);
  });
});
