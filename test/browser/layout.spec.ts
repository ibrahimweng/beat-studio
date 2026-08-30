import { expect, test } from '@playwright/test';
import { loadClip, open } from './app.ts';

/**
 * Whether everything on screen is actually reachable.
 *
 * The faults this is for are the quiet kind. Six panel tabs overflowed their
 * column by seventy-five pixels into a hidden scrollbar, so two panels could
 * not be opened by their tab at all and nothing anywhere said so -- no error,
 * no warning, and a screenshot of the top of the column that looks correct.
 * The same shape of fault put controls past the right edge of the app bar.
 *
 * All of it is arithmetic on boxes, which is exactly what a browser is for
 * and exactly what neither a type checker nor a test of a pure function can
 * do.
 */

/** Every window width the layout claims to work at, and why that one. */
const WIDTHS = [
  { width: 1440, height: 900, why: 'a laptop with the browser filling it' },
  { width: 1280, height: 800, why: 'the narrowest the stylesheet has a case for' },
];

for (const { width, height, why } of WIDTHS) {
  test.describe(`at ${width}×${height} — ${why}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height });
      await open(page);
    });

    /*
     * The one that shipped.
     *
     * Measured against the column each tab is in rather than against the
     * window, because that is the box that clips them: the column is a fixed
     * width and the strip inside it was a single row.
     */
    test('every panel tab is inside the column it belongs to', async ({ page }) => {
      const columns = await page.locator('.dock:not(.is-empty)').all();
      expect(columns.length, 'there is a column of panels').toBeGreaterThan(0);

      for (const column of columns) {
        const box = (await column.boundingBox())!;
        const tabs = await column.locator('.dock__tab').all();
        expect(tabs.length, 'the column has tabs').toBeGreaterThan(0);

        for (const tab of tabs) {
          const name = (await tab.textContent())?.trim() ?? '?';
          const at = (await tab.boundingBox())!;
          // A pixel of slack, because a border can land on a half pixel and
          // that is not a tab anybody cannot click.
          expect(at.x + at.width, `“${name}” runs past the right of its column`)
            .toBeLessThanOrEqual(box.x + box.width + 1);
          expect(at.x, `“${name}” starts left of its column`)
            .toBeGreaterThanOrEqual(box.x - 1);
          expect(at.y + at.height, `“${name}” runs past the bottom of its column`)
            .toBeLessThanOrEqual(box.y + box.height + 1);
        }
      }
    });

    /*
     * And each of them opens the panel it names.
     *
     * Being inside the column is necessary and not sufficient: a tab can be
     * drawn in the right place and covered by something, which a click finds
     * out and a measurement does not.
     */
    test('every panel can be opened by its tab', async ({ page }) => {
      const tabs = await page.locator('.dock__tab').all();
      const names = await Promise.all(tabs.map(async (tab) => (await tab.textContent())!.trim()));

      for (const name of names) {
        const tab = page.locator('.dock__tab', { hasText: name }).first();
        await tab.click({ timeout: 5_000 });
        await expect(tab, `“${name}” did not come to the front`).toHaveClass(/is-on/);
      }
      expect(names.length, 'there were panels to check').toBeGreaterThan(0);
    });

    /** Nothing in the app bar runs off the end of it. */
    test('the app bar keeps its controls inside itself', async ({ page }) => {
      const bar = (await page.locator('.appbar').boundingBox())!;
      for (const selector of ['.appbar__export', '.appbar__title']) {
        const at = (await page.locator(selector).boundingBox())!;
        expect(at.x + at.width, `${selector} runs past the end of the bar`)
          .toBeLessThanOrEqual(bar.x + bar.width + 1);
      }
    });

    /*
     * The page itself does not scroll sideways.
     *
     * The timeline scrolls, on purpose, inside its own frame. The document
     * doing it means something is wider than the window, which is the state
     * every one of these faults is a symptom of.
     */
    test('the window does not scroll sideways', async ({ page }) => {
      await loadClip(page);
      const over = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(over.scroll, 'the page is wider than the window').toBeLessThanOrEqual(over.client);
    });

    /*
     * Nothing is parked behind a scrollbar that has been switched off.
     *
     * This is the general form of the fault above, and it is worth stating
     * generally because it has now happened twice in the same codebase: a
     * strip of controls given `overflow: auto` and a hidden scrollbar looks
     * finished at the width it was built at and quietly swallows its right
     * hand end at every other one. A strip that scrolls on purpose says so
     * with a scrollbar; these do not, so they must fit.
     */
    test('no strip of controls hides its end', async ({ page }) => {
      const strips = ['.transport-row', '.appbar', '.dock__tabs', '.rail'];
      for (const selector of strips) {
        const over = await page.locator(selector).first().evaluate((node) => ({
          need: node.scrollWidth,
          have: node.clientWidth,
          tall: node.scrollHeight,
          room: node.clientHeight,
        }));
        expect(over.need, `${selector} is wider than itself`).toBeLessThanOrEqual(over.have);
        expect(over.tall, `${selector} is taller than itself`).toBeLessThanOrEqual(over.room);
      }
    });

    /*
     * The transport went down onto the timeline, and all of it has to fit.
     *
     * That move was the whole point of the rearrangement, and the thing that
     * makes it a bad move is a transport whose right hand end -- the two
     * switches and help -- is off the edge. It was: the strip scrolled
     * sideways with its scrollbar switched off, so at 1280 those three were
     * simply not on screen and nothing said so.
     */
    test('the transport fits on the timeline', async ({ page }) => {
      const row = (await page.locator('.transport-row').boundingBox())!;
      const controls = await page.locator('.transport-row button, .transport-row select').all();
      expect(controls.length, 'the transport has controls').toBeGreaterThan(4);

      for (const control of controls) {
        const at = await control.boundingBox();
        if (!at || at.width === 0) continue; // Deliberately hidden, like the length box.
        const label = (await control.getAttribute('title')) ?? (await control.textContent()) ?? '?';
        expect(at.x + at.width, `“${label.trim()}” runs past the end of the transport`)
          .toBeLessThanOrEqual(row.x + row.width + 1);
      }
    });
  });
}
