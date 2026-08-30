import { expect, test } from '@playwright/test';
import { loadClip, open, whileMeasuringRate } from './app.ts';

/** The length readout, which is also the control that sets it. */
const total = (page: import('@playwright/test').Page) => page.locator('.transport__total');
const clock = (page: import('@playwright/test').Page) => page.locator('.transport__clock');

/** Seconds, from a timecode as the transport prints it. */
function seconds(text: string, fps = 25): number {
  const [h, m, s, f] = text.split(':').map(Number);
  return h * 3600 + m * 60 + s + f / fps;
}

/** Type a new length into the readout and commit it. */
async function setLength(page: import('@playwright/test').Page, typed: string): Promise<void> {
  await total(page).click();
  const box = page.getByLabel('Length of the piece');
  await expect(box).toBeVisible();
  await box.fill(typed);
  await box.press('Enter');
}

/**
 * Move the playhead to a fraction of the way through the piece.
 *
 * By fraction of the whole rather than of what happens to be on screen. Those
 * are not the same thing and assuming they were is how the first version of
 * this quietly tested four seconds while claiming to test eleven: the lanes
 * are drawn at a fixed scale, so a twelve second piece is two and a half
 * frames wide and the far end of it is off to the right. So it is scrolled
 * into view first, and the moment it actually landed on is read back from the
 * clock rather than assumed.
 */
async function scrubTo(page: import('@playwright/test').Page, along: number): Promise<void> {
  await page.locator('.tl__viewport').evaluate((frame, at) => {
    const content = frame.querySelector('.tl__content') as HTMLElement;
    frame.scrollLeft = Math.max(0, content.offsetWidth * (at as number) - frame.clientWidth / 2);
  }, along);

  const content = (await page.locator('.tl__content').boundingBox())!;
  const frame = (await page.locator('.tl__viewport').boundingBox())!;
  const ruler = (await page.locator('.tl__ruler').boundingBox())!;
  const x = content.x + content.width * along;
  expect(x, 'the moment is on screen to be clicked').toBeGreaterThan(frame.x);
  expect(x, 'the moment is on screen to be clicked').toBeLessThan(frame.x + frame.width);

  await page.mouse.click(x, ruler.y + ruler.height / 2);
}

/**
 * How long the piece is, and the playhead's right to leave the picture.
 *
 * These are two halves of the same idea. The length of the piece used to be
 * whatever the video happened to be, and the playhead used to stop dead on
 * its last frame -- so a tail that rings out past the final cut had nowhere
 * to be and no way to be heard. Both are driven by a clock that hands over
 * from the video element to the audio context at the end of the clip, which
 * is a piece of timing no pure function test can stand in for.
 */
test.describe('the length of the piece', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await loadClip(page);
  });

  test('starts as the length of the clip that was loaded', async ({ page }) => {
    const shown = seconds(await total(page).innerText());
    expect(shown, 'about the five seconds that were recorded').toBeGreaterThan(3);
    expect(shown).toBeLessThan(8);
  });

  test('can be typed as full timecode', async ({ page }) => {
    await setLength(page, '00:00:20:00');
    await expect(total(page)).toHaveText('00:00:20:00');
  });

  /* Nobody types four fields to say thirty seconds. */
  test('can be typed as a bare number of seconds', async ({ page }) => {
    await setLength(page, '30');
    await expect(total(page)).toHaveText('00:00:30:00');
  });

  /*
   * A field that quietly keeps the old value looks exactly like one that took
   * a value and lost it, so this says so.
   */
  test('says so when what was typed is not a length', async ({ page }) => {
    await setLength(page, 'later');
    await expect(page.locator('.status, [class*="status"]').first()).toContainText('not a length');
    await expect(total(page)).not.toHaveText('00:00:00:00');
  });

  /*
   * Making the piece longer makes the ruler longer.
   *
   * The point of setting a length is the room it gives you; a number that
   * changes on screen and leaves the lanes the width they were has done
   * nothing.
   */
  test('a longer piece is a longer timeline', async ({ page }) => {
    const before = await page.locator('.tl__content').evaluate((n) => n.getBoundingClientRect().width);
    await setLength(page, '60');
    await expect
      .poll(async () => page.locator('.tl__content').evaluate((n) => n.getBoundingClientRect().width))
      .toBeGreaterThan(before);
  });
});

test.describe('the playhead past the end of the video', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await loadClip(page);
    // Twice the clip, so there is a stretch with no picture under it.
    await setLength(page, '00:00:12:00');
    await expect(total(page)).toHaveText('00:00:12:00');
  });

  /*
   * The ruler can be dragged past the last frame.
   *
   * It could not: the playhead was the video's own currentTime and nothing
   * else, so it stopped dead wherever the clip did however long the piece
   * was, and the stretch you had just made was unreachable.
   */
  test('the ruler scrubs into the empty stretch', async ({ page }) => {
    await scrubTo(page, 0.85);

    await expect
      .poll(async () => seconds(await clock(page).innerText()), {
        message: 'the clock went past the end of the clip',
      })
      .toBeGreaterThan(6);
  });

  /*
   * And it keeps running there.
   *
   * This is the handover: the video element ends, and the clock carries on
   * off the audio context instead. Started from inside the clip rather than
   * after it, so what is measured is the crossing itself.
   */
  test('playing runs on through the end of the clip', async ({ page }) => {
    // A third of the way into twelve seconds, which is inside the five
    // second clip with a second or so to spare.
    await scrubTo(page, 1 / 3);
    await expect
      .poll(async () => seconds(await clock(page).innerText()), { message: 'it started inside the clip' })
      .toBeGreaterThan(2);

    await page.getByTitle('Play or pause (Space)').click();
    await expect
      .poll(async () => seconds(await clock(page).innerText()), {
        message: 'the clock crossed the end of the clip while playing',
        timeout: 20_000,
      })
      .toBeGreaterThan(6.5);

    // And the playhead went with it rather than being left on the last frame.
    const head = (await page.locator('.tl__playhead').boundingBox())!;
    const content = (await page.locator('.tl__content').boundingBox())!;
    const along = (head.x - content.x) / content.width;
    expect(along, 'the playhead is past halfway through a twelve second piece')
      .toBeGreaterThan(0.45);
  });
});

/*
 * Reaching for the transport before the app has finished with the clip.
 *
 * Loading a clip is not one step. The length appears, the transport comes
 * alive, and then the frame rate is measured by letting the picture run muted
 * for half a second and putting it back to the start -- and that last part
 * used to stop whatever you had started and drop you at zero, because it
 * reset the position unconditionally. Nothing said why; it looked like the
 * play button had simply not worked.
 *
 * Every other test in this file waits that window out, which is what makes
 * this one worth writing: it is the only place the window is aimed at
 * deliberately.
 */
test.describe('while the clip is still being measured', () => {
  test('pressing play is not undone by the measurement', async ({ page }) => {
    await open(page);
    await loadClip(page, { settle: false });
    await whileMeasuringRate(page);

    await page.getByTitle('Play or pause (Space)').click();

    // Still playing once the measurement is over and done with, rather than
    // stopped at the top of the clip.
    await page.waitForFunction(
      () => (window as unknown as { rateMeasured?: boolean }).rateMeasured === true,
      undefined,
      { timeout: 15_000 },
    );
    await expect
      .poll(async () => seconds(await clock(page).innerText()), {
        message: 'the playhead kept running',
      })
      .toBeGreaterThan(1);
    await expect(page.locator('.play-btn')).toHaveClass(/is-playing/);
  });
});
