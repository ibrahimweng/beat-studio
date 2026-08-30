import { expect, test } from '@playwright/test';
import { open } from './app.ts';

/**
 * Moving the panels about, and whether it stays moved.
 *
 * The interesting fault here was invisible in the stylesheet and in the
 * source: dropping a tab into the empty left column did nothing at all,
 * because tearing down the drag collapsed that column back to no width
 * *before* the code worked out which column the pointer was over. The answer
 * was therefore always "neither", the panel snapped back, and the one column
 * that had to be reachable by dragging was the one column you could not drag
 * into.
 *
 * None of that is reachable without a real pointer over a real layout, which
 * is the entire reason this file exists.
 */

/** The tab strip of a column, by the panel name on the tab. */
const tab = (page: import('@playwright/test').Page, name: string) =>
  page.locator('.dock__tab', { hasText: name }).first();

/**
 * Carry a tab into a column and let go.
 *
 * The first small move is not incidental. A press only becomes a drag after
 * five pixels, and until it is a drag the left column is still closed and
 * still has no width to aim at -- so the move that opens it has to happen
 * before the move that aims at it.
 */
async function dragTabTo(
  page: import('@playwright/test').Page,
  name: string,
  side: 'left' | 'right',
): Promise<void> {
  const from = (await tab(page, name).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 4 });

  const target = (await page.locator(`.dock--${side}`).boundingBox())!;
  expect(target.width, `the ${side} column opened to something to aim at`).toBeGreaterThan(1);
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.up();
}

test.describe('the panel columns', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('everything starts in one column, on the right', async ({ page }) => {
    await expect(page.locator('.dock--right .dock__tab')).toHaveCount(6);
    await expect(page.locator('.dock--left .dock__tab')).toHaveCount(0);
    await expect(page.locator('.dock--left')).toHaveClass(/is-empty/);
  });

  /* The one that shipped doing nothing. */
  test('a tab can be dragged into the empty column', async ({ page }) => {
    await dragTabTo(page, 'Moments', 'left');

    await expect(page.locator('.dock--left .dock__tab', { hasText: 'Moments' })).toHaveCount(1);
    await expect(page.locator('.dock--right .dock__tab', { hasText: 'Moments' })).toHaveCount(0);
    await expect(page.locator('.dock--left')).not.toHaveClass(/is-empty/);

    // And it is the panel that is there, not just its name: a tab that moves
    // without its body is the same as a tab that did not move.
    const left = (await page.locator('.dock--left').boundingBox())!;
    const body = (await page.locator('.dock--left .dock__body').boundingBox())!;
    expect(body.width, 'the panel came with it').toBeGreaterThan(0);
    expect(left.width, 'the column took room of its own').toBeGreaterThan(100);
  });

  test('and dragged back again', async ({ page }) => {
    await dragTabTo(page, 'Moments', 'left');
    await dragTabTo(page, 'Moments', 'right');
    await expect(page.locator('.dock--right .dock__tab')).toHaveCount(6);
    await expect(page.locator('.dock--left')).toHaveClass(/is-empty/);
  });

  /*
   * An arrangement nobody can get back to is not an arrangement.
   *
   * Checked through a reload rather than by reading what was stored, because
   * what matters is that it comes back, and a stored layout is read against
   * the panels that exist now -- which is the part with the edge cases.
   */
  test('where the panels were put is where they are next time', async ({ page }) => {
    await dragTabTo(page, 'Sounds', 'left');
    await expect(page.locator('.dock--left .dock__tab', { hasText: 'Sounds' })).toHaveCount(1);

    await page.reload();
    await expect(page.locator('.rail__tool').first()).toBeVisible();

    await expect(page.locator('.dock--left .dock__tab', { hasText: 'Sounds' })).toHaveCount(1);
    await expect(page.locator('.dock--right .dock__tab')).toHaveCount(5);
  });

  /*
   * A closed panel is by definition not somewhere you can click, so the
   * window menu is the only way back to it. If that is wrong the panel is
   * gone for good, which is the worst thing docking can do.
   */
  test('a panel can be put away from the window menu, and got back', async ({ page }) => {
    await page.getByRole('button', { name: 'Window' }).first().click();
    await page.getByRole('menuitem', { name: 'Palette' }).click();
    await expect(page.locator('.dock__tab', { hasText: 'Palette' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Window' }).first().click();
    await page.getByRole('menuitem', { name: 'Palette' }).click();
    await expect(page.locator('.dock__tab', { hasText: 'Palette' })).toHaveCount(1);
  });

  test('and everything can be put back where it started', async ({ page }) => {
    await dragTabTo(page, 'Moments', 'left');
    await dragTabTo(page, 'Selected', 'left');
    await expect(page.locator('.dock--left .dock__tab')).toHaveCount(2);

    await page.getByRole('button', { name: 'Window' }).first().click();
    await page.getByRole('menuitem', { name: 'Put the panels back' }).click();

    await expect(page.locator('.dock--right .dock__tab')).toHaveCount(6);
    await expect(page.locator('.dock--left')).toHaveClass(/is-empty/);
  });
});
