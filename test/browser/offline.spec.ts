import { expect, test } from '@playwright/test';
import { loadClip, open } from './app.ts';

/**
 * Nothing is fetched from anywhere.
 *
 * The app's first screen says a video is "read straight from your disk and
 * never uploaded", and the whole of it is meant to work with the network
 * unplugged. That was not quite true: starting the audio engine asked
 * `gleitz.github.io` for General MIDI soundfonts, and shipped a library to do
 * it, for a code path that had no callers left — the piano and guitar keys
 * that once played them went when mixing moved onto the layers. Offline, or
 * behind a firewall, it was two failed requests and two console errors for
 * nothing.
 *
 * Checked by watching what the page asks for rather than by reading the
 * source, because the fault was a dependency reaching out on its own rather
 * than a line anybody would notice writing.
 */
test('asks the network for nothing but itself', async ({ page, baseURL }) => {
  const outside: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith(baseURL!) || url.startsWith('data:') || url.startsWith('blob:')) return;
    outside.push(`${request.method()} ${url}`);
  });

  await open(page);
  await loadClip(page, { seconds: 3 });

  // The gesture that builds the audio graph, which is what used to reach out.
  await page.getByRole('button', { name: /Start audio engine/ }).click();
  await page.getByRole('button', { name: /Play or pause/ }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Play or pause/ }).click();

  expect(outside, 'every request stayed on this origin').toEqual([]);
});
