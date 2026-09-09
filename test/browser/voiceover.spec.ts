import { expect, test, type Page, type Route } from '@playwright/test';
import { open } from './app.ts';

/**
 * Putting a voice to a script, in a real browser.
 *
 * Every test here answers `/api/narrate` itself rather than letting it through,
 * and that is the point rather than a shortcut. The proxy behind that endpoint
 * is measured next door in `src/audio/narrate-proxy.test.ts`, where it is driven
 * with a stand-in for `fetch`; what only a browser can answer is whether the
 * screen exists, whether the take reaches the timeline, and whether a deployment
 * with no key says so instead of failing at a press.
 *
 * It also means no test needs a key, an account, or a network — and that a build
 * server never spends anybody's credits to find out that a button is wired up.
 */

const RATE = 24_000;

/** Two narrators, as the catalogue would describe them. */
const CATALOGUE = [
  {
    uid: 'v-desmond',
    name: 'Desmond',
    description: 'Clean, deliberate and precise, for academic authority',
    is_catalog: true,
    is_pro_clone: false,
    language: 'en',
  },
  {
    uid: 'v-freya',
    name: 'Freya',
    description: 'Glossy and confident, for a friendly receptionist',
    is_catalog: true,
    is_pro_clone: false,
    language: 'en',
  },
];

/**
 * A short spoken-sounding WAV, built here.
 *
 * The browser has to be able to decode it, because the screen reads the take's
 * length and its waveform out of the decoded audio. A tone under an envelope is
 * not speech, but it is a real 16-bit WAV of a known length, which is all that
 * is being checked.
 */
function speechWav(seconds = 1.5): Buffer {
  const frames = Math.round(RATE * seconds);
  const view = new DataView(new ArrayBuffer(44 + frames * 2));
  const text = (at: number, what: string): void => {
    for (let i = 0; i < what.length; i++) view.setUint8(at + i, what.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * 2, true);

  for (let i = 0; i < frames; i++) {
    const at = i / RATE;
    // A voice-ish band, opening and closing so the waveform has a shape.
    const shape = Math.min(1, at * 6) * Math.min(1, (seconds - at) * 6);
    const wave = Math.sin(2 * Math.PI * 180 * at) * 0.5 + Math.sin(2 * Math.PI * 320 * at) * 0.2;
    view.setInt16(44 + i * 2, Math.round(wave * shape * 0x6000), true);
  }
  return Buffer.from(view.buffer);
}

/** What one ask was, so a stub can answer the right thing. */
const asked = (route: Route): Record<string, unknown> => {
  try {
    return JSON.parse(route.request().postData() ?? '{}');
  } catch {
    return {};
  }
};

/**
 * Answer `/api/narrate` as a working deployment would.
 *
 * `also` gets first refusal on every ask, so a test can change one answer
 * without restating the rest.
 */
async function withNarrate(
  page: Page,
  also?: (ask: Record<string, unknown>, route: Route) => Promise<boolean>,
): Promise<void> {
  await page.route('**/api/narrate', async (route) => {
    const ask = asked(route);
    if (also && (await also(ask, route))) return;
    switch (ask.what) {
      case 'narrators':
        return route.fulfill({ json: CATALOGUE });
      case 'design':
        return route.fulfill({
          json: {
            embeddings: [
              { embedding_id: 'vox_emb_one', ready: false },
              { embedding_id: 'vox_emb_two', ready: false },
              { embedding_id: 'vox_emb_three', ready: false },
            ],
          },
        });
      case 'ready':
        return route.fulfill({
          json: { embeddings: [{ embedding_id: ask.candidate, ready: true }] },
        });
      case 'say':
        return route.fulfill({ contentType: 'audio/wav', body: speechWav() });
      case 'keep':
        return route.fulfill({ json: { uid: 'v-kept', name: 'The one I kept', language: 'en' } });
      case 'drop':
        return route.fulfill({ json: { dropped: ask.candidate } });
      default:
        return route.fulfill({ status: 400, json: { error: 'bad', message: 'no' } });
    }
  });
}

/** Open the app on the voiceover screen, with the service answering. */
async function onVoiceover(
  page: Page,
  also?: (ask: Record<string, unknown>, route: Route) => Promise<boolean>,
): Promise<void> {
  await withNarrate(page, also);
  await open(page);
  await page.locator('.rail__screen[data-screen="voiceover"]').click();
  await expect(page.locator('.vo')).toBeVisible();
}

test.describe('making a voiceover', () => {
  test('offers the narrators the deployment can use', async ({ page }) => {
    await onVoiceover(page);
    await expect(page.locator('.vo__readers option')).toHaveCount(2);
    await expect(page.locator('.vo__readers')).toHaveValue('v-desmond');
    // Nothing to read yet, so nothing offers to read it.
    await expect(page.getByRole('button', { name: 'Read it' })).toBeDisabled();
  });

  test('reads a script and shows what came back', async ({ page }) => {
    await onVoiceover(page);
    await page.locator('.vo__script').fill('Four people made this, in a room above a bakery.');
    await expect(page.locator('.vo__counted')).toHaveText('48 of 2000');

    await page.getByRole('button', { name: 'Read it' }).click();
    await expect(page.locator('.vo__take')).toBeVisible({ timeout: 30_000 });
    // Named after the first few words, which is what somebody looks for later,
    // and measured from the audio rather than from the header it arrived with.
    await expect(page.locator('.vo__takename')).toContainText('Four people made this');
    await expect(page.locator('.vo__takename')).toContainText('0:02');
    await expect(page.locator('.vo__wave svg')).toBeVisible();
  });

  /*
   * The take reaches the timeline, which is the whole point of the screen.
   *
   * One take, one layer: a voiceover is the thing everything else gets balanced
   * against, so it gets a lane of its own rather than being dropped onto
   * whatever was selected.
   */
  test('places the take on a layer of its own', async ({ page }) => {
    await onVoiceover(page);
    await page.locator('.vo__script').fill('A line worth placing.');
    await page.getByRole('button', { name: 'Read it' }).click();
    await expect(page.locator('.vo__take')).toBeVisible({ timeout: 30_000 });

    const layers = await page.locator('.rail__screen[data-screen="design"]').count();
    expect(layers).toBe(1);
    await page.getByRole('button', { name: 'Place on the timeline' }).click();

    await page.locator('.rail__screen[data-screen="design"]').click();
    await expect(page.locator('.cue')).toHaveCount(1);
    await expect(page.locator('.tl__layer-name', { hasText: 'A line worth placing' })).toBeVisible();
  });

  /*
   * A described narrator is four steps, and the screen shows all four.
   *
   * Sampled, made, auditioned, kept. Keeping is not tidiness: a draft can only
   * read a hundred characters and disappears after thirty days, so it is the
   * step that turns a candidate into something that can read a script at all.
   */
  test('describes three narrators and keeps one', async ({ page }) => {
    await onVoiceover(page);
    await page.locator('.vo__design summary').click();
    await page.locator('.vo__describe').fill('A Bristolian pirate, weathered and gravelly');
    await page.getByRole('button', { name: 'Find three' }).click();

    await expect(page.locator('.vo__draft')).toHaveCount(3, { timeout: 30_000 });
    await page
      .locator('.vo__draft')
      .first()
      .getByRole('button', { name: 'Keep this one' })
      .click();

    // The kept one becomes the chosen narrator, and the drafts go with it.
    await expect(page.locator('.vo__draft')).toHaveCount(0);
    await expect(page.locator('.vo__readers')).toHaveValue('v-kept');
    await expect(page.locator('.vo__said')).toContainText('can read a whole script');
  });

  /*
   * A deployment with no key says so, rather than failing at a press.
   *
   * It is a normal state: everything else in the app works without one, so the
   * screen explains itself and offers nothing, the same way the palette leaves
   * the Freesound group out.
   */
  test('says the voiceover is off when the deployment has no key', async ({ page }) => {
    await onVoiceover(page, async (ask, route) => {
      if (ask.what !== 'narrators') return false;
      await route.fulfill({
        status: 503,
        json: { error: 'not-configured', message: 'This deployment has no Gradium key set.' },
      });
      return true;
    });

    await expect(page.locator('.vo__nothing')).toBeVisible();
    await expect(page.locator('.vo__nothing')).toContainText('no Gradium key');
    // And nothing that would spend anything is on screen at all.
    await expect(page.locator('.vo__script')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Read it' })).toBeHidden();
  });

  /*
   * Running out of room is somebody else's doing, and says so.
   *
   * Kept narrators come out of one pool belonging to the deployment rather than
   * to whoever pressed the button, so this can fail for a person who has kept
   * nothing at all. A sentence naming that is the least the screen can do.
   */
  test('says when there is no room to keep another narrator', async ({ page }) => {
    await onVoiceover(page, async (ask, route) => {
      if (ask.what !== 'keep') return false;
      await route.fulfill({
        status: 409,
        json: {
          error: 'no-room',
          message: 'This deployment has no room for another kept narrator.',
        },
      });
      return true;
    });

    await page.locator('.vo__design summary').click();
    await page.locator('.vo__describe').fill('Anyone at all');
    await page.getByRole('button', { name: 'Find three' }).click();
    await expect(page.locator('.vo__draft')).toHaveCount(3, { timeout: 30_000 });

    await page.locator('.vo__draft').first().getByRole('button', { name: 'Keep this one' }).click();
    await expect(page.locator('.vo__said')).toContainText('no room');
    // The drafts stay, so the one that was nearly kept can still be heard.
    await expect(page.locator('.vo__draft')).toHaveCount(3);
  });

  test('forgets the take, and leaves the piece alone', async ({ page }) => {
    await onVoiceover(page);
    await page.locator('.vo__script').fill('Something to forget.');
    await page.getByRole('button', { name: 'Read it' }).click();
    await expect(page.locator('.vo__take')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Forget' }).click();
    await expect(page.locator('.vo__take')).toBeHidden();
    // The narrators are not re-fetched, because they did not go anywhere.
    await expect(page.locator('.vo__readers option')).toHaveCount(2);
  });
});
