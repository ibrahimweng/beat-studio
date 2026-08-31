import { expect, test } from '@playwright/test';
import { open } from './app.ts';

/**
 * Dropping something that moves but is not a video.
 *
 * A GIF cannot go in a video element, so it is decoded and recorded back out
 * as one before anything else sees it -- and that needs `ImageDecoder`, which
 * is the newest thing this app depends on anywhere.
 *
 * What is checked here is the half that can be checked without it. The
 * browser these run in has no `ImageDecoder` at all, which makes it exactly
 * the machine somebody on an older browser is using: the file has to be
 * recognised as a moving picture, and it has to fail saying what is actually
 * wrong rather than "this browser cannot play that file", which is true of a
 * video element and no help when the browser can read the file perfectly
 * well and simply not that way.
 */

/**
 * Six frames of forty by forty, two hundred milliseconds each.
 *
 * Written out rather than fetched, so the test carries its own subject: a
 * real animated GIF with a real length, which is the only way to check that
 * the length survives being converted.
 */
const SIX_FRAME_GIF = Buffer.from(
    'R0lGODlhKAAoAPEAAAAAAP////8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQEFAAAACwAAAAA' +
    'KAAoAAACl4yPoMvowSJ4SS567MVQT+59WMh1WkmCHrqqp2ux79jSM5XaMSzJu97jRXxB4FDYQG6M' +
    'SeYSV4PeHjnpz1rEHp0K4lbbBD+pUfLUUTVf1Vn21x2Gj9Fl+rlyz9Txa3uf3+YXCPgmWEgYZ5iI' +
    'OMfYpfTIJSIWSTkpV4l5qdiol2eQxpkpuulY6vmHOqh6yLro2gm6BztqWgAAIfkEBBQAAAAsAAAA' +
    'ACgAKAAAApeEj6HL6MBieEkueuzFUE/ufVjIdVpJgh66qqdrse/Y0jOV2jEsybve40V8QeBQ2EBu' +
    'jEnmEleD3h456c9axB6dCuJW2wQ/qVHy1FE1X9VZ9tcdho/RZfq5cs/U8Wt7n9/mFwj4JlhIGGeY' +
    'iDjH2KX0yCUiFkk5KVeJeanYqJdnkMaZKbrpWOr5hzqoesi66NoJugc7aloAACH5BAQUAAAALAAA' +
    'AAAoACgAAAKXjI+gy+jBInhJLnrsxVBP7n1YyHVaSYIeuqqna7Hv2NIzldoxLMm73uNFfEHgUNhA' +
    'boxJ5hJXg94eOenPWsQenQriVtsEP6lR8tRRNV/VWfbXHYaP0WX6uXLP1PFre5/f5hcI+CZYSBhn' +
    'mIg4x9il9MglIhZJOSlXiXmp2KiXZ5DGmSm66Vjq+Yc6qHrIuujaCboHO2paAAAh+QQEFAAAACwA' +
    'AAAAKAAoAAACl4SPocvowGJ4SS567MVQT+59WMh1WkmCHrqqp2ux79jSM5XaMSzJu97jRXxB4FDY' +
    'QG6MSeYSV4PeHjnpz1rEHp0K4lbbBD+pUfLUUTVf1Vn21x2Gj9Fl+rlyz9Txa3uf3+YXCPgmWEgY' +
    'Z5iIOMfYpfTIJSIWSTkpV4l5qdiol2eQxpkpuulY6vmHOqh6yLro2gm6BztqWgAAIfkEBBQAAAAs' +
    'AAAAACgAKAAAApeMj6DL6MEieEkueuzFUE/ufVjIdVpJgh66qqdrse/Y0jOV2jEsybve40V8QeBQ' +
    '2EBujEnmEleD3h456c9axB6dCuJW2wQ/qVHy1FE1X9VZ9tcdho/RZfq5cs/U8Wt7n9/mFwj4JlhI' +
    'GGeYiDjH2KX0yCUiFkk5KVeJeanYqJdnkMaZKbrpWOr5hzqoesi66NoJugc7aloAACH5BAQUAAAA' +
    'LAAAAAAoACgAAAKXhI+hy+jAYnhJLnrsxVBP7n1YyHVaSYIeuqqna7Hv2NIzldoxLMm73uNFfEHg' +
    'UNhAboxJ5hJXg94eOenPWsQenQriVtsEP6lR8tRRNV/VWfbXHYaP0WX6uXLP1PFre5/f5hcI+CZY' +
    'SBhnmIg4x9il9MglIhZJOSlXiXmp2KiXZ5DGmSm66Vjq+Yc6qHrIuujaCboHO2paAAA7',
  'base64',
);

/** The smallest real GIF there is: one transparent pixel. */
const ONE_PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

test('a GIF is taken as a moving picture, not refused as a video', async ({ page }) => {
  await open(page);

  const reachable = await page.evaluate(() => typeof (window as { ImageDecoder?: unknown }).ImageDecoder);
  await page.setInputFiles('input[type=file][accept*=video]', {
    name: 'loop.gif', mimeType: 'image/gif', buffer: ONE_PIXEL_GIF,
  });
  await page.waitForTimeout(1500);
  const said = (await page.locator('.tl__status').innerText()).trim();

  if (reachable === 'function') {
    // A browser that can read it: the one pixel is a real animation of one
    // frame, and what comes back is a video.
    expect(said, `it took the GIF: "${said}"`).not.toMatch(/cannot play that file/i);
  } else {
    /*
     * A browser that cannot. The message has to name the real reason, and it
     * has to be a way forward rather than a dead end.
     */
    expect(said, `it said: "${said}"`).toMatch(/animated image/i);
    expect(said, 'and what to do about it').toMatch(/convert/i);
    expect(said, 'not the video element talking').not.toMatch(/cannot play that file/i);
  }
});

test('the picker offers them, so they can be chosen and not only dropped', async ({ page }) => {
  await open(page);
  const accept = await page.locator('input[type=file][accept*=video]').first().getAttribute('accept');
  expect(accept, 'video, and the pictures that move').toContain('image/gif');
  expect(accept).toContain('video/*');
});

/**
 * The length a converted picture is given.
 *
 * Measured while writing this: a six frame GIF held 200ms a frame is 1.200
 * seconds, and what the recorder writes comes back as 1.007. A WebM written
 * from a live stream ends at its last encoded frame, and no amount of extra
 * frames afterwards moves it -- 1428ms of wall clock produced a 1.024 second
 * file in a bare test of the recorder alone.
 *
 * Usually a frame is nothing. GIFs are often five frames a second, though,
 * where one frame is 200ms, which is six frames at thirty -- not a rounding
 * error in an app whose whole job is landing a sound on the right one. So the
 * length comes from the frames, which say how long they are held for, rather
 * than from the file that was written from them.
 */
test('runs for as long as its frames say, not as long as the recorder wrote', async ({ page }) => {
  await open(page);
  /*
   * Asked after the page is open, not before.
   *
   * `ImageDecoder` is not on `about:blank` -- a blank page is not a secure
   * context with the same features -- so checking before navigating says it
   * is missing on a browser that has it, and skips a test that would have
   * run. Which is exactly what this did, and what a capability probe on
   * `about:blank` told me about this browser earlier.
   */
  test.skip(
    await page.evaluate(() => typeof (window as { ImageDecoder?: unknown }).ImageDecoder) !== 'function',
    'this browser cannot read animated images',
  );
  // Six frames, 200ms each: 1.200 seconds, at five frames a second.
  await page.setInputFiles('input[type=file][accept*=video]', {
    name: 'moving.gif', mimeType: 'image/gif', buffer: SIX_FRAME_GIF,
  });
  /*
   * Waited on the status, not on the readout.
   *
   * A piece with no clip is thirty seconds long, so the length is already
   * something before anything is loaded -- waiting for it to stop being
   * zero is a wait that ends immediately, and this measured the empty
   * project rather than the GIF.
   */
  await expect(page.locator('.tl__status')).toContainText('loaded', { timeout: 30_000 });

  const { shown, asked, fps } = await page.evaluate(() => {
    const select = [...document.querySelectorAll('select')]
      .find((one) => one.value && /^[\d.]+$/.test(one.value));
    const rate = select ? Number(select.value) : 0;
    const text = document.querySelector('.transport__total')!.textContent!.trim();
    const [h, m, s, f] = text.split(':').map(Number);
    return { shown: text, asked: h * 3600 + m * 60 + s + (rate ? f / rate : 0), fps: rate };
  });

  // Within one frame of 1.2s. The recorder's own answer is 1.007, which is
  // most of a frame out at this rate and would fail this.
  expect(Math.abs(asked - 1.2), `${shown} at ${fps}fps is ${asked.toFixed(3)}s`)
    .toBeLessThan(0.12);
});

test('a still image is still refused, since there is nothing to time against', async ({ page }) => {
  await open(page);
  // A one pixel PNG: a real image, but one that does not move.
  await page.setInputFiles('input[type=file][accept*=video]', {
    name: 'shot.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await page.waitForTimeout(1200);
  const said = (await page.locator('.tl__status').innerText()).trim();
  expect(said, `a still is not a clip: "${said}"`).not.toBe('');
});
