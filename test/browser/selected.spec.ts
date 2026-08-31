import { expect, test } from '@playwright/test';
import { loadClip, open } from './app.ts';

/**
 * The panel for the sound that is selected, when none is.
 *
 * It says "Nothing selected" and shows its controls dimmed, which is the
 * right thing to show: they are what you would reach for the moment you
 * picked something, and hiding them would make the panel jump.
 *
 * Dimmed is not the same as out of reach, though, and it was only half true.
 * Pointer events were turned off, so a click genuinely did not land -- but
 * that does nothing to the keyboard, and sixteen of the controls stayed in
 * the tab order. Tabbing across the panel with nothing selected went through
 * sixteen stops that look available, read as available to anything speaking
 * the page aloud, and do nothing at all.
 */
test.describe('the panel for a sound that is not selected', () => {
  const focusable = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const body = document.querySelector('.dock--right .dock__body');
      if (!body) return -1;
      let took = 0;
      for (const el of body.querySelectorAll('button, input')) {
        (el as HTMLElement).focus();
        if (document.activeElement === el) took += 1;
      }
      (document.activeElement as HTMLElement | null)?.blur?.();
      return took;
    });

  test('cannot be reached by the keyboard either', async ({ page }) => {
    await open(page);
    await loadClip(page, { seconds: 4 });
    await page.locator('.dock__tab', { hasText: 'Selected' }).first().click();

    await expect(page.locator('.dock--right .dock__body')).toContainText('Nothing selected');
    // Only the help button, which sits outside the part that switches off.
    expect(await focusable(page), 'the controls are out of the tab order').toBeLessThanOrEqual(1);
  });

  test('and comes back the moment something is', async ({ page }) => {
    await open(page);
    await loadClip(page, { seconds: 4 });
    await page.locator('.dock__tab', { hasText: 'Selected' }).first().click();

    const lane = page.locator('.tl__lane').first();
    const box = (await lane.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
    await expect(page.locator('.cue')).toHaveCount(1);

    expect(await focusable(page), 'every control is reachable again').toBeGreaterThan(10);
    // And it does what it says, rather than only looking live.
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await expect(page.locator('.cue'), 'Delete removed the sound').toHaveCount(0);
  });
});
