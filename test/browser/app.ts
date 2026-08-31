import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Opening the app, and the two things every test needs first.
 *
 * The walkthrough opens over the top on a first visit and would swallow the
 * first click of every test, and most of what is worth checking needs a clip
 * loaded. Both are here rather than in each file so that a test reads as the
 * thing it is testing.
 */
export async function open(page: Page): Promise<void> {
  await page.goto('/');
  // The rail is the last thing built, so its tools mean the app is up.
  await expect(page.locator('.rail__tool').first()).toBeVisible();

  /*
   * The walkthrough is dismissed rather than disabled.
   *
   * It only appears on a first visit, and each test gets a fresh profile, so
   * it is always there. Skipping it through its own button is also the only
   * way that keeps working if how it is stored ever changes.
   */
  const skip = page.getByRole('button', { name: 'Skip', exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(skip).toBeHidden();
}

/**
 * A clip, made in the page rather than committed to the repository.
 *
 * A few seconds of canvas recorded through MediaRecorder: about ninety
 * kilobytes, made in under a second, and no binary in git that somebody has
 * to trust. `cuts` puts a white frame at two seconds and a red one at four
 * and a half, which is what the scanner reads as moments — so the same clip
 * serves both the tests that only need a duration and the ones that need
 * something to find.
 */
export async function loadClip(
  page: Page,
  {
    seconds = 5,
    cuts = true,
    settle = true,
    width = 320,
    cutEvery = 0,
  }: {
    seconds?: number;
    cuts?: boolean;
    settle?: boolean;
    /**
     * How wide to make it, for the tests that are about the cost of a frame.
     *
     * A seek and a decode scale with the picture, and the faults in the
     * second pass of the scan only appear once a frame is expensive enough
     * that a seek does not finish promptly. At 320 wide everything is fast
     * and nothing shows.
     */
    width?: number;
    /**
     * A cut every so many seconds instead of the two fixed ones.
     *
     * For the tests that need the pinning pass to have real work in it: two
     * moments are pinned before a test can see that it started.
     */
    cutEvery?: number;
  } = {},
): Promise<void> {
  const bytes = await page.evaluate(
    async ({ seconds, cuts, width, cutEvery }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = Math.round((width * 9) / 16);
      const ctx = canvas.getContext('2d')!;
      const rec = new MediaRecorder(canvas.captureStream(30), {
        mimeType: 'video/webm',
        videoBitsPerSecond: width > 640 ? 4_000_000 : 1_000_000,
      });
      const parts: Blob[] = [];
      rec.ondataavailable = (event) => parts.push(event.data);
      rec.start();

      const began = performance.now();
      await new Promise<void>((done) => {
        const draw = (): void => {
          const at = (performance.now() - began) / 1000;
          if (at > seconds) return done();
          let ground = '#101018';
          if (cutEvery) ground = Math.floor(at / cutEvery) % 2 ? '#101018' : '#e8e8f0';
          else if (cuts && at > 2 && at < 2.25) ground = '#ffffff';
          else if (cuts && at > 4.5 && at < 4.7) ground = '#ff2020';
          ctx.fillStyle = ground;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#88ccff';
          const unit = canvas.width / 320;
          ctx.fillRect(unit * (40 + Math.sin(at * 2) * 30), unit * 60, unit * 60, unit * 60);
          requestAnimationFrame(draw);
        };
        draw();
      });

      rec.stop();
      await new Promise((settled) => (rec.onstop = settled));
      const blob = new Blob(parts, { type: 'video/webm' });
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { seconds, cuts, width, cutEvery },
  );

  /*
   * Watched before the file goes in, because what is being waited for happens
   * on its own the moment it does.
   *
   * The frame rate is measured by letting the clip run muted for a moment and
   * then putting it back to the start, and until that is over the app is
   * driving its own transport. A test that starts in that window is aiming at
   * something that is still moving. There is no flag for it, so the thing
   * itself is watched: the one play-then-pause that is not anybody's doing.
   */
  await page.evaluate(() => {
    const video = document.querySelector('video')!;
    (window as unknown as { rateMeasured?: boolean }).rateMeasured = false;
    video.addEventListener(
      'play',
      () => {
        video.addEventListener(
          'pause',
          () => {
            (window as unknown as { rateMeasured?: boolean }).rateMeasured = true;
          },
          { once: true },
        );
      },
      { once: true },
    );
  });

  await page.setInputFiles('input[type=file][accept*=video]', {
    name: 'clip.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from(bytes),
  });

  // The length readout is written from the file, so it is the app itself
  // saying the clip is in rather than a guess at how long that takes.
  await expect(page.locator('.transport__total')).not.toHaveText('00:00:00:00');
  if (!settle) return;
  await page.waitForFunction(
    () => (window as unknown as { rateMeasured?: boolean }).rateMeasured === true,
    undefined,
    { timeout: 15_000 },
  );
}

/**
 * Wait until the frame rate measurement has taken hold of the clip.
 *
 * The other half of `settle: false`, for the one test that is about what
 * happens if somebody reaches for the transport while this is going on.
 * Waiting for it to *start* rather than sleeping for a moment and hoping is
 * what makes that test land inside the window every time rather than most
 * times.
 */
export async function whileMeasuringRate(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return !!video && !video.paused && video.currentTime >= 0;
  }, undefined, { timeout: 15_000 });
}

/** Put one sound on the first layer, at roughly the given fraction along. */
export async function placeSound(page: Page, along = 0.3): Promise<void> {
  const lane = page.locator('.tl__lane').first();
  const box = (await lane.boundingBox())!;
  const before = await page.locator('.cue').count();
  await page.mouse.click(box.x + box.width * along, box.y + box.height / 2);
  await expect(page.locator('.cue')).toHaveCount(before + 1);
}

/**
 * A point on an element that is actually on screen, as a fraction along it.
 *
 * The lanes scroll under a fixed frame, and a sound zoomed in far enough runs
 * off the right of it and under the panel column, which sits on top. Clicking
 * the middle of such a sound by its own box lands on the panel and does
 * nothing at all -- which is what the first blade test did, silently, and
 * looked for all the world like the blade being broken.
 *
 * So the point comes from the part of the element inside the frame, and the
 * test says how much of it it needs; a run where the sound is barely in view
 * fails saying so rather than passing for the wrong reason.
 */
export async function pointOn(
  page: Page,
  target: Locator,
  along = 0.5,
  { need = 40 }: { need?: number } = {},
): Promise<{ x: number; y: number; width: number }> {
  const box = (await target.boundingBox())!;
  const frame = (await page.locator('.tl__viewport').boundingBox())!;
  const from = Math.max(box.x, frame.x);
  const to = Math.min(box.x + box.width, frame.x + frame.width);
  const width = to - from;
  expect(width, 'enough of it is on screen to aim at').toBeGreaterThan(need);
  return { x: from + width * along, y: box.y + box.height / 2, width };
}

/**
 * Zoom in, as far as asked or as far as the timeline allows.
 *
 * The buttons grey out at their limits — all the way in, or far enough out
 * that the whole piece is showing — so pressing one blindly the moment it has
 * nothing left to do is a click that waits forever. Tests that want "well
 * zoomed in" want exactly this: as far as it goes, up to the number asked
 * for.
 */
export async function zoomIn(page: Page, times: number): Promise<void> {
  const button = page.getByRole('button', { name: '+', exact: true });
  for (let i = 0; i < times; i += 1) {
    if (!(await button.isEnabled())) return;
    await button.click();
  }
}

/** Which tool is currently held, by the name on its button. */
export async function currentTool(page: Page): Promise<string | null> {
  return page.locator('.rail__tool.is-on').getAttribute('aria-label');
}

/** The cursor a surface actually shows, as the browser resolves it. */
export async function cursorOver(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((node) => getComputedStyle(node).cursor);
}
