import { expect, test } from '@playwright/test';
import { cursorOver, currentTool, loadClip, open, placeSound, pointOn, zoomIn } from './app.ts';

/**
 * The tools: what they say they are, and what they do.
 *
 * Both halves have been wrong in ways nothing caught. The cursor was set on
 * the timeline viewport, which every surface inside it overrides, so for one
 * release picking up a tool changed nothing you could see. The blade looked
 * for `.tl__cue`, a class that has never existed, so it could not find a
 * sound to cut. Neither is the sort of thing a type checker or a pure
 * function test can reach.
 */
test.describe('the tools', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('the letter keys change tool', async ({ page }) => {
    for (const [key, name] of [
      ['t', 'Range tool'],
      ['c', 'Cut tool'],
      ['h', 'Hand tool'],
      ['z', 'Zoom tool'],
      ['p', 'Pen tool'],
      ['v', 'Move tool'],
    ] as const) {
      await page.keyboard.press(key);
      expect(await currentTool(page), `pressing ${key}`).toBe(name);
    }
  });

  /*
   * The one that shipped broken.
   *
   * Checked over a sound rather than over empty lane, because a sound is what
   * exposed it: `.cue__head` sets `grab` of its own, and a rule on the
   * viewport loses to it. Every tool looked identical there while looking
   * correct in the stylesheet.
   *
   * The expected shapes are named rather than merely compared to each other,
   * because the hand's own cursor is `grab` too. "Not what the surface said"
   * would call the hand a failure for agreeing with it by coincidence, and
   * "all different" alone would not say which one had gone wrong.
   */
  test('the cursor over a sound says which tool is held', async ({ page }) => {
    await loadClip(page);
    await placeSound(page);

    const seen = new Map<string, string>();
    for (const [key, name, want] of [
      ['t', 'Range', 'text'],
      ['c', 'Cut', 'url('],
      ['h', 'Hand', 'grab'],
      ['z', 'Zoom', 'zoom-in'],
      ['p', 'Pen', 'url('],
    ] as const) {
      await page.keyboard.press(key);
      const cursor = await cursorOver(page, '.cue__head');
      expect(cursor, `${name} over a sound`).toContain(want);
      seen.set(name, cursor);
    }

    // And each is its own, which is the whole point: two tools sharing a
    // cursor is the same as neither having one. This is what the fault
    // actually looked like -- five rows all reading `grab`.
    expect(new Set(seen.values()).size, `distinct cursors, got ${JSON.stringify([...seen])}`)
      .toBe(seen.size);
  });

  /*
   * Move is the deliberate exception, and worth pinning as one.
   *
   * It sets no cursor of its own so that every surface keeps saying what it
   * can do -- grab over a sound, an I-beam over a name. That is a decision
   * rather than an omission, and without a test it reads like the fault above
   * to the next person who goes looking.
   */
  test('the move tool leaves each surface saying what it does', async ({ page }) => {
    await loadClip(page);
    await placeSound(page);
    await page.keyboard.press('v');
    expect(await currentTool(page)).toBe('Move tool');
    expect(await cursorOver(page, '.cue__head'), 'a sound offers to be moved').toBe('grab');
    expect(await cursorOver(page, '.tl__ruler'), 'the ruler offers to be scrubbed').toBe('ew-resize');
  });

  /*
   * A cursor drawn from a data URI can be accepted, reported back intact, and
   * still fail to decode, at which point it silently falls through to the
   * plain keyword after the comma. Both of these shipped in that state. The
   * only way to know is to load it as an image.
   */
  test('the drawn cursors are real images', async ({ page }) => {
    for (const [key, name] of [['c', 'Cut'], ['p', 'Pen']] as const) {
      await page.keyboard.press(key);
      const cursor = await cursorOver(page, '.tl__viewport');
      expect(cursor, `${name} should be drawn`).toContain('url(');

      const loaded = await page.evaluate(async (value: string) => {
        const from = value.indexOf('url("');
        const to = value.lastIndexOf('")');
        if (from < 0 || to < 0) return { ok: false, why: 'no url in the value' };
        const src = value.slice(from + 5, to);
        return new Promise<{ ok: boolean; why?: string; w?: number }>((done) => {
          const img = new Image();
          img.onload = () => done({ ok: true, w: img.naturalWidth });
          img.onerror = () => done({ ok: false, why: 'it did not decode' });
          img.src = src;
        });
      }, cursor);

      expect(loaded.ok, `${name} cursor: ${loaded.why ?? ''}`).toBe(true);
      expect(loaded.w).toBeGreaterThan(0);
    }
  });

  test('alt over the zoom tool offers to go the other way', async ({ page }) => {
    await page.keyboard.press('z');
    expect(await cursorOver(page, '.tl__viewport')).toBe('zoom-in');
    await page.keyboard.down('Alt');
    expect(await cursorOver(page, '.tl__viewport')).toBe('zoom-out');
    await page.keyboard.up('Alt');
    expect(await cursorOver(page, '.tl__viewport')).toBe('zoom-in');
  });

  test('the hand drags the view without moving anything on it', async ({ page }) => {
    await loadClip(page);
    await placeSound(page);
    // Zoomed in, so there is somewhere to pan to.
    await zoomIn(page, 3);

    const cues = await page.locator('.cue').count();
    const lane = (await page.locator('.tl__lane').first().boundingBox())!;
    await page.keyboard.press('h');
    await page.mouse.move(lane.x + 400, lane.y + 10);
    await page.mouse.down();
    await page.mouse.move(lane.x + 150, lane.y + 10, { steps: 8 });
    await page.mouse.up();

    const scrolled = await page.locator('.tl__viewport').evaluate((n) => n.scrollLeft);
    expect(scrolled, 'the view moved').toBeGreaterThan(0);
    expect(await page.locator('.cue').count(), 'nothing was added or removed').toBe(cues);
  });

  /*
   * The blade, which spent a release unable to find a sound at all.
   *
   * Zoomed in first because a sound is drawn at a ten pixel minimum, and a
   * cut inside the first frame of one is refused rather than making something
   * of no length: at the default scale the whole sound is inside that. Placed
   * near the start of the piece for the same reason the click is taken from
   * `pointOn` -- zoomed in this far, a sound anywhere else has run off under
   * the panel column, and a click there hits the panel.
   */
  test('the blade cuts a sound short where it is clicked', async ({ page }) => {
    await loadClip(page);
    await placeSound(page, 0.05);
    await zoomIn(page, 4);
    await page.locator('.tl__viewport').evaluate((n) => { n.scrollLeft = 0; });

    const cue = page.locator('.cue').first();
    const before = (await cue.boundingBox())!;
    const at = await pointOn(page, cue, 0.5);

    await page.keyboard.press('c');
    await page.mouse.click(at.x, at.y);

    await expect
      .poll(async () => (await cue.boundingBox())!.width, { message: 'the sound got shorter' })
      .toBeLessThan(before.width);
  });

  test('the range tool draws a stretch, and Delete clears what is inside it', async ({ page }) => {
    await loadClip(page);
    await placeSound(page, 0.2);
    await placeSound(page, 0.5);
    const placed = await page.locator('.cue').count();

    await page.keyboard.press('t');
    const lane = (await page.locator('.tl__lane').first().boundingBox())!;
    await page.mouse.move(lane.x + 5, lane.y + 10);
    await page.mouse.down();
    await page.mouse.move(lane.x + lane.width * 0.8, lane.y + 10, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator('.tl__range')).toBeVisible();
    await page.keyboard.press('Delete');
    await expect(page.locator('.cue')).toHaveCount(0);
    expect(placed, 'there was something to clear').toBeGreaterThan(0);
  });
});
