import { expect, test } from '@playwright/test';
import { loadClip, open, placeSound, pointOn } from './app.ts';

/**
 * Right-clicking, and whether the answer is about what was clicked.
 *
 * There is one listener for the whole timeline rather than one per drawn
 * thing, and it works out what you meant from where the press landed. That is
 * the right way round -- the lanes are rebuilt constantly and per-element
 * menus would be rebuilt with them -- but it means the menu being correct
 * depends entirely on a chain of `closest` calls against class names, which
 * is the exact shape of thing that has already been wrong once here: the
 * blade looked for `.tl__cue`, which has never existed.
 *
 * A menu is also the only place in the app that can be positioned off screen,
 * so that is checked too.
 */
test.describe('the context menus', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await loadClip(page);
  });

  test('a sound offers what you can do with a sound', async ({ page }) => {
    await placeSound(page);
    await page.locator('.cue__head').first().click({ button: 'right' });

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    for (const label of ['Hear it', 'Cut it short here', 'Delete sound']) {
      await expect(menu.getByRole('menuitem', { name: label })).toBeVisible();
    }
    // And not the ones that belong to something else, which is what makes it
    // a menu about this sound rather than a menu about the timeline.
    await expect(menu.getByRole('menuitem', { name: 'Place a sound here' })).toHaveCount(0);
  });

  test('an empty lane offers what can arrive on it', async ({ page }) => {
    const lane = page.locator('.tl__lane').first();
    const at = await pointOn(page, lane, 0.4);
    await page.mouse.click(at.x, at.y, { button: 'right' });

    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Place a sound here' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Play from here' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Hear it' })).toHaveCount(0);
  });

  test('a layer offers what you can do to a layer', async ({ page }) => {
    await page.locator('[data-gutter-layer]').first().click({ button: 'right' });

    const menu = page.getByRole('menu');
    for (const label of ['Rename…', 'Solo', 'Add a layer below']) {
      await expect(menu.getByRole('menuitem', { name: label })).toBeVisible();
    }
  });

  /*
   * And it does the thing it says.
   *
   * A menu that opens correctly and then acts on the wrong sound, or on
   * nothing, looks identical in a screenshot.
   */
  test('choosing from the menu acts on what was clicked', async ({ page }) => {
    await placeSound(page, 0.2);
    await placeSound(page, 0.6);
    await expect(page.locator('.cue')).toHaveCount(2);

    await page.locator('.cue__head').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete sound' }).click();

    await expect(page.locator('.cue')).toHaveCount(1);
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('Escape closes it, and so does a press elsewhere', async ({ page }) => {
    await placeSound(page);

    await page.locator('.cue__head').first().click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    await page.locator('.cue__head').first().click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await page.locator('.appbar').click({ position: { x: 4, y: 4 } });
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  /*
   * The browser's own menu does not also appear.
   *
   * Two menus at once is the state this replaced, and the only thing stopping
   * it is one `preventDefault` that runs after the items have been worked
   * out -- so a menu that comes up empty for any reason silently goes back to
   * offering to reload the page.
   */
  test('the browser keeps its own menu to itself', async ({ page }) => {
    await placeSound(page);
    const stopped = page.evaluate(
      () =>
        new Promise<boolean>((done) => {
          window.addEventListener('contextmenu', (event) => done(event.defaultPrevented), {
            once: true,
          });
        }),
    );
    await page.locator('.cue__head').first().click({ button: 'right' });
    expect(await stopped, 'the default menu was not stopped').toBe(true);
  });

  /*
   * A menu near the bottom right of the window opens back towards the middle.
   *
   * Placed after it is in the document, because until then it has no size,
   * and flipped rather than clamped -- a menu shoved up against the bottom
   * edge covers the thing it is about.
   */
  test('a menu at the edge stays on screen', async ({ page }) => {
    const window = page.viewportSize()!;
    const lane = page.locator('.tl__lane').last();
    const box = (await lane.boundingBox())!;
    const frame = (await page.locator('.tl__viewport').boundingBox())!;
    // As near the bottom right of the timeline as there is a lane to click.
    const x = Math.min(box.x + box.width, frame.x + frame.width) - 6;
    await page.mouse.click(x, box.y + box.height - 4, { button: 'right' });

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const at = (await menu.boundingBox())!;
    expect(at.x, 'off the left').toBeGreaterThanOrEqual(0);
    expect(at.y, 'off the top').toBeGreaterThanOrEqual(0);
    expect(at.x + at.width, 'off the right').toBeLessThanOrEqual(window.width);
    expect(at.y + at.height, 'off the bottom').toBeLessThanOrEqual(window.height);
  });
});
