import { expect, test, type Page } from '@playwright/test';
import { loadClip, open } from './app.ts';

const findButton = (page: Page) => page.locator('.tl__detect button').first();

/**
 * The second pass of the scan, which is the one that decides what a
 * suggestion is worth.
 *
 * The first pass plays the clip quickly and finds roughly where things
 * happen; this one looks at each of those places a frame at a time and picks
 * the frame the change actually landed on. A moment that is near the right
 * frame is not much use when the whole job is landing on it.
 *
 * It used to do that by seeking to each frame in turn and giving each seek
 * 400ms before drawing whatever was on screen anyway. Measured on a 1080p
 * clip, a seek there takes 342ms on average and 28 of 56 ran past the
 * allowance -- so on the size of picture this is actually used at, half the
 * comparisons were between a frame and itself, or between two frames from
 * somewhere else entirely. It was also the slowest thing in the app: 4.7
 * seconds a window, forty seconds to pin twenty-six moments.
 *
 * So these run at 1920 wide. At 320 a seek is 11ms and none of it shows.
 */
test.describe('pinning a moment to its frame', () => {
  test.describe.configure({ timeout: 240_000 });

  test('every moment lands on a frame where the picture changed', async ({ page }) => {
    /*
     * This one needs the machine to itself.
     *
     * Both halves of it decode 1080p in real time -- the app pinning the
     * moments, and this reading back what it landed on -- and a browser
     * sharing two cores with three others is handed fewer frames than the
     * file holds. Under a parallel run every reading came back with a hole in
     * it, which says nothing about the code. CI runs one at a time, which is
     * where this is the gate; locally it wants `--workers=1`.
     */
    test.skip(
      test.info().config.workers > 1,
      'reads 1080p in real time: run it with --workers=1',
    );
    await open(page);
    await loadClip(page, { seconds: 14, width: 1920, cutEvery: 1.4 });

    await findButton(page).click();
    await expect(findButton(page)).toHaveText('Find hits', { timeout: 200_000 });
    await expect(page.locator('.tl__status')).toContainText('moments found');

    const stamps = await page.locator('.moment__at').allInnerTexts();
    expect(stamps.length, 'the clip had cuts in it to find').toBeGreaterThan(5);

    /*
     * The rate the app settled on, not the one the clip was asked for.
     *
     * A timecode is frames, so reading one needs the rate it was written at,
     * and that rate is measured off the clip rather than assumed -- a first
     * attempt here assumed thirty, the app had measured something else, and
     * every moment converted to a time part way through a shot where nothing
     * changes. Fourteen readings of exactly zero, and a test that failed
     * while the code was right.
     */
    const fps = Number(await page.locator('.transport__select').first().inputValue());
    expect(fps, 'the app says what rate it is working at').toBeGreaterThan(1);

    /*
     * Checked against the clip itself rather than against the times the cuts
     * were drawn at.
     *
     * What was drawn and what was encoded are not the same list -- the
     * recorder takes frames when it takes them -- so the truth here is the
     * file: at a frame a cut landed on, that frame and the one before it are
     * different pictures, and anywhere else they are nearly the same one.
     */
    /*
     * How far each moment is from where the picture actually changes.
     *
     * Checked against the clip itself rather than against the times the cuts
     * were drawn at. What was drawn and what was encoded are not the same
     * list -- the recorder takes frames when it takes them -- so the truth
     * here is the file: the frames either side of a cut are different
     * pictures, and everywhere else in a shot they are nearly the same one.
     *
     * The file's own frames are counted rather than a grid of them being
     * assumed. This clip encodes at about 30.3 frames a second while the app
     * measures it as 30, so a time reconstructed from a timecode is up to one
     * frame early -- never late -- and a first attempt at this seeked to that
     * time and read the frame before the one it meant. Thirteen of fourteen
     * moments came back one frame out, which was the reading and not the app.
     */
    const offsets = await page.evaluate(async ({ times, fps }) => {
      const nominal = 1 / fps;
      const seconds = times.map((stamp) => {
        const [h, m, s, f] = stamp.trim().split(':').map(Number);
        // Half a frame on, so the reading sits in the middle of the frame the
        // timecode names rather than at the earliest edge it could mean.
        return h * 3600 + m * 60 + s + (f + 0.5) * nominal;
      });

      const video = document.createElement('video');
      video.src = (document.querySelector('video') as HTMLVideoElement).src;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      await new Promise((r) => video.addEventListener('loadeddata', r, { once: true }));

      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 36;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const apart = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
        let total = 0;
        for (let i = 0; i < a.length; i += 4) {
          total += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        }
        return total / ((a.length / 4) * 3 * 255);
      };

      /** Every frame the file really holds across a stretch, in order. */
      const framesBetween = async (from: number, to: number) => {
        await new Promise<void>((resolve) => {
          video.addEventListener('seeked', () => resolve(), { once: true });
          video.currentTime = Math.max(0, from);
        });
        // Half speed, because a 1080p frame the decoder cannot keep up with
        // is never presented, and a reading with a hole in it would count
        // every frame after the hole one place out.
        video.playbackRate = 0.5;
        const held: { t: number; px: Uint8ClampedArray }[] = [];
        await new Promise<void>((resolve) => {
          const onFrame: VideoFrameRequestCallback = (_n, meta) => {
            ctx.drawImage(video, 0, 0, 64, 36);
            held.push({ t: meta.mediaTime, px: ctx.getImageData(0, 0, 64, 36).data });
            if (meta.mediaTime >= to || video.ended) {
              video.pause();
              return resolve();
            }
            video.requestVideoFrameCallback(onFrame);
          };
          video.requestVideoFrameCallback(onFrame);
          void video.play();
        });
        return held;
      };

      /*
       * A cut here is the whole frame changing, which reads as about 0.79.
       * The square drifting inside a shot covers a twentieth of the picture
       * and reads under 0.05, so there is nothing in between to argue about.
       */
      const CUT = 0.2;
      const REACH = 5;
      const out: (number | string)[] = [];
      for (const at of seconds) {
        /*
         * Read again if the reading itself lost a frame.
         *
         * A hole in the list shifts every index after it, so a reading with
         * one in it cannot be counted. Twice, and it is reported rather than
         * quietly retried until it agrees.
         */
        let held: { t: number; px: Uint8ClampedArray }[] = [];
        let sound = false;
        for (let go = 0; go < 3 && !sound; go++) {
          held = await framesBetween(at - REACH * nominal, at + REACH * nominal);
          if (held.length < 4) continue;
          const gaps = held.slice(1).map((f, i) => f.t - held[i].t);
          sound = Math.max(...gaps) <= Math.min(...gaps) * 1.5;
        }
        if (!sound) {
          out.push('the reading kept dropping frames');
          continue;
        }

        let changed = -1;
        for (let i = 1; i < held.length; i++) {
          if (apart(held[i - 1].px, held[i].px) > CUT) {
            changed = i;
            break;
          }
        }
        if (changed < 0) {
          out.push('no change near it');
          continue;
        }

        let nearest = 0;
        for (let i = 1; i < held.length; i++) {
          if (Math.abs(held[i].t - at) < Math.abs(held[nearest].t - at)) nearest = i;
        }
        out.push(nearest - changed);
      }
      return out;
    }, { times: stamps, fps });

    const say = offsets.join(' ');
    const numbers = offsets.filter((o): o is number => typeof o === 'number');
    expect(numbers.length, `most moments could be read (per moment: ${say})`).toBeGreaterThanOrEqual(
      Math.ceil(offsets.length * 0.75),
    );

    /*
     * On the frame, or the one beside it -- not somewhere in the window.
     *
     * A frame either way rather than dead on, because the reading cannot be
     * finer than that: a moment is read back through the timecode the app
     * shows, which is written at the rate the app measured, and this clip
     * encodes at about 30.3 frames a second against a measured 30. What that
     * leaves is still the whole of what the pass is for. Its window is three
     * or four frames wide and it is choosing inside it, so a pass that had
     * stopped working would scatter across that width or land nowhere near a
     * change at all -- which is what the seeking version scored here, and
     * what this holds it to.
     */
    const close = numbers.filter((o) => Math.abs(o) <= 1);
    expect(
      close.length,
      `moments land on the frame the picture changed on (frames off: ${say})`,
    ).toBeGreaterThanOrEqual(Math.ceil(numbers.length * 0.75));
  });

  /*
   * Stopping during the second pass is stopping.
   *
   * The button is live through both passes and the guard on it admits either,
   * so pressing it while it said Pinning cleared the screen and said "stopped
   * reading the video" -- and then the pass, which was never told, ran to the
   * end and put its results up regardless. Moments out of nowhere, minutes
   * after somebody asked for none. The first pass has always been told; this
   * one was reached through a signal it did not take.
   */
  test('and it can be stopped once it has started', async ({ page }) => {
    await open(page);
    await loadClip(page, { seconds: 16, width: 960, cutEvery: 1.4 });

    await findButton(page).click();
    await expect
      .poll(async () => (await findButton(page).innerText()).trim(), {
        message: 'it reached the pinning pass',
        timeout: 120_000,
      })
      .toContain('Pinning');

    await findButton(page).click();
    await expect(findButton(page)).toHaveText('Find hits');
    await expect(page.locator('.tl__status')).toContainText('stopped reading');

    // Long enough that a pass that was only forgotten about would have
    // finished and handed its moments in.
    await page.waitForTimeout(20_000);
    await expect(findButton(page), 'nothing came back').toHaveText('Find hits');
    await expect(page.locator('.tl__status')).not.toContainText('moments found');
    await expect(page.locator('.dock--right .dock__body')).toContainText('Nothing found yet');
  });
});
