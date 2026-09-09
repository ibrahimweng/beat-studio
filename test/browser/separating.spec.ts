import { expect, test } from '@playwright/test';
import { open } from './app.ts';

/**
 * Taking a beat apart, in a real browser.
 *
 * What only a browser can answer here is not the arithmetic — that is measured in
 * Node, in `src/audio/separate/` — but whether the screen exists, whether it can
 * be reached, and whether the parts actually arrive on the timeline. Those are
 * layout, wiring and one file input, and every one of them is a thing that has
 * shipped broken in this app before.
 *
 * The beat is built here rather than committed, for the same reason the clip in
 * `app.ts` is recorded in the page: no binary in the repository that somebody has
 * to take on trust. A kick, a hat on every half beat and a held tone, in stereo so
 * that where things sit can be read.
 */

const RATE = 44_100;

/** A kick: a low sine falling in pitch, under a short burst of noise. */
function kick(into: Float32Array, at: number): void {
  const start = Math.round(at * RATE);
  const length = Math.round(0.3 * RATE);
  let phase = 0;
  let noise = 12345;
  for (let i = 0; i < length && start + i < into.length; i++) {
    const along = i / length;
    const hz = 110 * Math.exp(-4 * along) + 45;
    phase += (2 * Math.PI * hz) / RATE;
    noise = (noise * 1103515245 + 12345) & 0x7fffffff;
    const click = i < RATE * 0.004 ? (noise / 0x3fffffff - 1) * 0.25 : 0;
    into[start + i] += (Math.sin(phase) * 0.8 + click) * Math.exp(-5 * along);
  }
}

/** A hat: a very short burst of high noise. */
function hat(into: Float32Array, at: number): void {
  const start = Math.round(at * RATE);
  const length = Math.round(0.05 * RATE);
  let noise = 777;
  let last = 0;
  for (let i = 0; i < length && start + i < into.length; i++) {
    noise = (noise * 1103515245 + 12345) & 0x7fffffff;
    const white = noise / 0x3fffffff - 1;
    // A crude difference, which is a high pass: a hat is all top.
    const bright = white - last;
    last = white;
    into[start + i] += bright * 0.35 * Math.exp((-12 * i) / length);
  }
}

/** A held tone, for the parts that are not drums. */
function held(into: Float32Array, hz: number, gain: number): void {
  for (let i = 0; i < into.length; i++) into[i] += Math.sin((2 * Math.PI * hz * i) / RATE) * gain;
}

/** A four second beat as a 16-bit stereo WAV. */
function beatWav(): Buffer {
  const frames = RATE * 4;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);

  for (const [into, other] of [[left, right] as const]) {
    for (let beat = 0; beat < 8; beat++) {
      // Kick on every beat, hat on every half beat, both dead centre.
      if (beat % 2 === 0) {
        kick(into, 0.25 + beat * 0.5);
        kick(other, 0.25 + beat * 0.5);
      }
      hat(into, 0.5 + beat * 0.5);
      hat(other, 0.5 + beat * 0.5);
    }
  }
  // Centred, so it reads as the thing in front. And one pushed to the left, so
  // there is something for the rest.
  held(left, 330, 0.12);
  held(right, 330, 0.12);
  held(left, 520, 0.12);

  const bytes = 2;
  const data = frames * 2 * bytes;
  const view = new DataView(new ArrayBuffer(44 + data));
  const text = (at: number, what: string): void => {
    for (let i = 0; i < what.length; i++) view.setUint8(at + i, what.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2 * bytes, true);
  view.setUint16(32, 2 * bytes, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, data, true);

  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (const lane of [left, right]) {
      const value = Math.max(-1, Math.min(1, lane[i]));
      view.setInt16(at, Math.round(value * (value < 0 ? 0x8000 : 0x7fff)), true);
      at += 2;
    }
  }
  return Buffer.from(view.buffer);
}

/** Open the app on the screen that takes recordings apart, with a beat in it. */
async function takeApart(page: import('@playwright/test').Page): Promise<void> {
  await open(page);
  await page.locator('.rail__screen[data-screen="separate"]').click();
  await expect(page.locator('.sep')).toBeVisible();

  await page.setInputFiles('.sep input[type=file]', {
    name: 'beat.wav',
    mimeType: 'audio/wav',
    buffer: beatWav(),
  });
  // The rows are the app itself saying it is done, rather than a guess at how
  // long the work takes.
  await expect(page.locator('.sep__row')).toHaveCount(4, { timeout: 60_000 });
}

test.describe('taking a beat apart', () => {
  test('comes back as four parts, and says what it found', async ({ page }) => {
    await takeApart(page);

    const names = await page.locator('.sep__title').allInnerTexts();
    expect(names).toEqual(['Drums', 'Bass', 'Lead', 'Tonal']);

    // Every part has a share, and they come to about the whole recording.
    const shares = await page.locator('.sep__share').allInnerTexts();
    expect(shares).toHaveLength(4);
    for (const share of shares) expect(share).toMatch(/^\d+%$/);

    /*
     * The evidence, not a score.
     *
     * Whether a loop was found and whether there were two channels to read a
     * position from are what decide how much of the work each measurement did.
     * Somebody looking at four parts has no other way to know.
     */
    await expect(page.locator('.sep__notes')).toContainText('two channels');
  });

  /*
   * A waveform that is actually drawn.
   *
   * The kind of thing that ships broken: an SVG made in the wrong namespace looks
   * right in the document and draws nothing at all, and this app has that fault
   * on record — which is why `dom.ts` has a separate helper for SVG.
   */
  test('draws a waveform for every part', async ({ page }) => {
    await takeApart(page);
    const paths = page.locator('.sep__path');
    await expect(paths).toHaveCount(4);
    for (let at = 0; at < 4; at++) {
      const box = await paths.nth(at).boundingBox();
      expect(box, `part ${at} drew nothing`).not.toBeNull();
      expect((box as { width: number }).width).toBeGreaterThan(100);
    }
  });

  test('opens the drums into the drums', async ({ page }) => {
    await takeApart(page);
    await page.locator('.sep__row[data-part="drums"] button', { hasText: 'Open' }).click();

    // More rows than the four, and the new ones sit in from their parent.
    await expect(page.locator('.sep__row')).not.toHaveCount(4, { timeout: 60_000 });
    await expect(page.locator('.sep__row.is-inside').first()).toBeVisible();
    const inside = await page.locator('.sep__row.is-inside .sep__title').allInnerTexts();
    expect(inside).toContain('Kick');
    // What no hit accounted for is a part like the others, because the parts have
    // to add up.
    expect(inside).toContain('Rest');

    // And folds back up again.
    await page.locator('.sep__row[data-part="drums"] button', { hasText: 'Fold up' }).click();
    await expect(page.locator('.sep__row')).toHaveCount(4);
  });

  /*
   * The whole point of the screen: the parts reach the piece.
   *
   * A layer each, at the start, and the app goes back to the timeline — because
   * having taken a beat apart, what somebody wants next is to work with it.
   */
  test('places the parts on the timeline, one layer each', async ({ page }) => {
    await takeApart(page);
    const layersBefore = await page.locator('.tl__layer-name, .tl__layer').count();

    await page.getByRole('button', { name: 'Place on the timeline' }).click();

    // Back on the timeline, with a sound per part.
    await expect(page.locator('.sep')).toBeHidden();
    await expect(page.locator('.cue')).toHaveCount(4);
    expect(await page.locator('.tl__layer-name, .tl__layer').count()).toBeGreaterThan(
      layersBefore,
    );
  });

  /*
   * The tools belong to the timeline, and there is no timeline here.
   *
   * Out of reach rather than gone: a strip that changes length when you change
   * screen makes the whole window shift, and a tool that has quietly disappeared
   * is worse to come back to than one that is plainly not available yet.
   */
  test('puts the timeline tools out of reach', async ({ page }) => {
    await open(page);
    await expect(page.locator('.rail__tool').first()).toBeEnabled();
    await page.locator('.rail__screen[data-screen="separate"]').click();
    await expect(page.locator('.rail__tool').first()).toBeDisabled();
    await page.locator('.rail__screen[data-screen="design"]').click();
    await expect(page.locator('.rail__tool').first()).toBeEnabled();
  });
});
