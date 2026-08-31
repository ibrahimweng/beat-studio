import { expect, test, type Page } from '@playwright/test';
import { loadClip, open } from './app.ts';

/**
 * Pinching, on the two surfaces that have something to zoom.
 *
 * There is no pinch event on a desktop. A trackpad pinch reaches the page as
 * a wheel event with `ctrlKey` set, and that is the only way a browser
 * reports one -- so that is what these send, in the small repeated deltas a
 * trackpad actually produces rather than one large jump.
 *
 * What matters beyond "it zooms" is that it is symmetric and that it leaves
 * the plain two-finger scroll alone. The timeline already scrolls both ways
 * on its own, and a handler that moved it as well would move it twice.
 */

/** A gesture, as the stream of small events a trackpad sends. */
async function pinch(
  page: Page,
  selector: string,
  { x, y, delta, times = 40, ctrl = true, dx = 0 }:
    { x: number; y: number; delta: number; times?: number; ctrl?: boolean; dx?: number },
): Promise<void> {
  await page.evaluate(
    ({ selector, x, y, delta, times, ctrl, dx }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`no ${selector}`);
      const box = el.getBoundingClientRect();
      for (let i = 0; i < times; i += 1) {
        el.dispatchEvent(new WheelEvent('wheel', {
          clientX: box.x + x, clientY: box.y + y, deltaY: delta, deltaX: dx,
          ctrlKey: ctrl, bubbles: true, cancelable: true,
        }));
      }
    },
    { selector, x, y, delta, times, ctrl, dx },
  );
  await page.waitForTimeout(120);
}

/** How many labels the ruler is showing, which is how far in the timeline is. */
const ticks = (page: Page) =>
  page.locator('.tl__tick').filter({ hasText: /\d/ }).count();

const magnification = async (page: Page): Promise<string> =>
  (await page.getByRole('button', { name: /Fit/ }).first().innerText()).trim();

test.describe('pinching the timeline', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await loadClip(page, { seconds: 8 });
  });

  test('zooms in', async ({ page }) => {
    const started = await ticks(page);
    await pinch(page, '.tl__viewport', { x: 400, y: 40, delta: -4 });
    const closer = await ticks(page);
    expect(closer, `${started} labels became ${closer}`).toBeGreaterThan(started);
  });

  /*
   * Measured on the drawn width rather than on the ruler.
   *
   * The first version of this counted ruler labels, and the ruler picks a
   * sensible interval rather than drawing one per unit -- so it is quantised,
   * and a scale that came back two per cent off looked identical. Checked by
   * putting a straight multiplier back in place of the exponential, which
   * drifts by exactly that and which the label count did not notice.
   *
   * The exponential is what makes the gesture symmetric: a tenth up and a
   * tenth down is 0.99 of where it began with a multiplier, and forty of
   * those is a drift you can see.
   */
  test('and back out again to exactly where it started', async ({ page }) => {
    const width = () =>
      page.evaluate(() =>
        (document.querySelector('.tl__content') as HTMLElement).getBoundingClientRect().width);

    /*
     * From part way in, not from Fit.
     *
     * A clip opens fitted, which is as far out as the timeline goes, so a
     * gesture out from there is clamped to the floor -- and lands on exactly
     * where it started whether the arithmetic is symmetric or not. Checked:
     * with a straight multiplier in place of the exponential this passed from
     * Fit and failed from here, which is the difference between a test and a
     * test that means something.
     */
    await pinch(page, '.tl__viewport', { x: 400, y: 40, delta: -4, times: 30 });
    const started = await width();

    await pinch(page, '.tl__viewport', { x: 400, y: 40, delta: -4 });
    expect(await width(), 'it zoomed in').toBeGreaterThan(started * 1.2);

    await pinch(page, '.tl__viewport', { x: 400, y: 40, delta: 4 });
    const back = await width();
    // A thousandth: the arithmetic is exact, the layout rounds to pixels.
    expect(Math.abs(back - started) / started, `${started}px became ${back}px`)
      .toBeLessThan(0.002);
  });

  /*
   * The time under the pointer stays under the pointer, which is the whole
   * reason to zoom with a gesture rather than with the buttons: those zoom
   * around the left edge, and pinching around the left edge would send
   * whatever you were looking at off the side of the screen.
   */
  test('keeps what is under the pointer under the pointer', async ({ page }) => {
    const at = async (): Promise<number> =>
      page.evaluate(() => {
        const v = document.querySelector('.tl__viewport') as HTMLElement;
        const content = document.querySelector('.tl__content') as HTMLElement;
        // Seconds under a point 400px into the viewport, from the drawn width.
        const perSecond = content.getBoundingClientRect().width / 30;
        return (v.scrollLeft + 400) / perSecond;
      });
    const before = await at();
    await pinch(page, '.tl__viewport', { x: 400, y: 40, delta: -4, times: 25 });
    const after = await at();
    // Within a tenth of a second: the arithmetic is exact, the ruler is not.
    expect(Math.abs(after - before), `${before.toFixed(2)}s became ${after.toFixed(2)}s`)
      .toBeLessThan(0.6);
  });

  test('leaves a plain two-finger scroll to the browser', async ({ page }) => {
    const scroll = () => page.evaluate(() => document.querySelector('.tl__viewport')!.scrollLeft);
    await pinch(page, '.tl__viewport', { x: 400, y: 40, delta: -4, times: 30 });
    const before = await scroll();
    // No ctrl: this is a scroll, and the viewport already scrolls itself.
    await pinch(page, '.tl__viewport', { x: 400, y: 40, delta: 0, dx: 40, times: 1, ctrl: false });
    expect(await scroll(), 'nothing here moved it').toBe(before);
  });
});

test.describe('pinching the picture', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await loadClip(page, { seconds: 5 });
  });

  test('zooms it, whatever tool is held', async ({ page }) => {
    // The Move tool, which has no business zooming anything.
    await page.keyboard.press('v');
    expect(await magnification(page), 'it starts whole').toBe('Fit');
    await pinch(page, '.vstage', { x: 300, y: 200, delta: -4 });
    expect(await magnification(page), 'a gesture is not a tool').toMatch(/^\d+% · Fit$/);
  });

  test('and two fingers move it once there is somewhere to move it', async ({ page }) => {
    const where = () =>
      page.evaluate(() => (document.querySelector('.vstage__video') as HTMLElement).style.transform);

    // Nothing to move while the whole picture is showing.
    await pinch(page, '.vstage', { x: 300, y: 200, delta: 0, dx: 20, times: 5, ctrl: false });
    expect(await where(), 'nothing to pan at Fit').toBe('');

    await pinch(page, '.vstage', { x: 300, y: 200, delta: -4 });
    const zoomed = await where();
    await pinch(page, '.vstage', { x: 300, y: 200, delta: 4, dx: 20, times: 8, ctrl: false });
    expect(await where(), 'and it moved once there was room').not.toBe(zoomed);
  });
});
