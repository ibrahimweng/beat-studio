import { expect, test, type Page } from '@playwright/test';
import { loadClip, open } from './app.ts';

/**
 * The three questions the app asks, which used to be the browser's.
 *
 * `window.prompt` and `window.confirm` were the only places this app dropped
 * out of its own language — system chrome in a system font, in the middle of a
 * dark editor, which cannot be styled, cannot say which of two answers is the
 * destructive one, and is suppressed outright in some embedded contexts, where
 * a confirm returns false and the thing you asked for silently does not
 * happen.
 *
 * Every test here also watches for a native dialog appearing, because that is
 * the regression: not that the question stops working, but that it goes back
 * to being asked by the browser.
 */

/** Fail loudly if the browser puts up a dialog of its own. */
function refuseNativeDialogs(page: Page): { seen: string[] } {
  const seen: string[] = [];
  page.on('dialog', async (dialog) => {
    seen.push(dialog.type());
    await dialog.dismiss();
  });
  return { seen };
}

async function withASound(page: Page) {
  await open(page);
  await loadClip(page, { seconds: 5 });
  const lane = page.locator('.tl__lane').first();
  const box = (await lane.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
  await expect(page.locator('.cue')).toHaveCount(1);
  await page.locator('.cue__head').first().click();
}

const card = (page: Page) => page.locator('.ask__card');

test.describe('naming a sound to keep', () => {
  test('asks in the app, with the name ready to replace', async ({ page }) => {
    const native = refuseNativeDialogs(page);
    await withASound(page);
    await page.locator('.dock__tab', { hasText: 'Selected' }).first().click();
    await page.locator('.dock--right button', { hasText: 'Save as mine' }).first().click();

    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText('Name this sound');
    // The field starts focused and holding the sound's own name, so the common
    // case is type-and-return rather than select-then-type.
    await expect(page.locator('.ask__field')).toBeFocused();
    await expect(page.locator('.ask__field')).toHaveValue('impact');
    expect(native.seen, 'the browser was not asked to do it').toEqual([]);
  });

  test('Escape leaves without saving', async ({ page }) => {
    await withASound(page);
    await page.locator('.dock__tab', { hasText: 'Selected' }).first().click();
    await page.locator('.dock--right button', { hasText: 'Save as mine' }).first().click();
    await expect(card(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.ask')).toHaveCount(0);
    await expect(page.locator('.tl__status')).not.toContainText('saved');
  });

  test('Return saves what was typed', async ({ page }) => {
    await withASound(page);
    await page.locator('.dock__tab', { hasText: 'Selected' }).first().click();
    await page.locator('.dock--right button', { hasText: 'Save as mine' }).first().click();

    await page.locator('.ask__field').fill('Door slam');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ask')).toHaveCount(0);
    await expect(page.locator('.tl__status')).toContainText('Door slam saved');
  });
});

test.describe('the two questions that destroy something', () => {
  /*
   * Focus starts on the way out, not on the way through.
   *
   * These are the presses that lose work, and a dialog that opens with the
   * destructive button focused turns a stray Return into a deleted layer.
   */
  test('a removal starts with Cancel focused, not the removal', async ({ page }) => {
    const native = refuseNativeDialogs(page);
    await withASound(page);
    await page.locator('[data-gutter-layer]').first()
      .getByRole('button', { name: '×', exact: true }).click();

    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText('Remove Impacts?');
    // Named in the singular, since it is one sound.
    await expect(card(page)).toContainText('The one sound on it goes with it');
    await expect(page.locator('.ask button', { hasText: 'Cancel' })).toBeFocused();
    expect(native.seen).toEqual([]);
  });

  test('cancelling a removal keeps the layer', async ({ page }) => {
    await withASound(page);
    const before = await page.locator('[data-gutter-layer]').count();
    await page.locator('[data-gutter-layer]').first()
      .getByRole('button', { name: '×', exact: true }).click();
    await page.locator('.ask button', { hasText: 'Cancel' }).click();

    await expect(page.locator('.ask')).toHaveCount(0);
    await expect(page.locator('[data-gutter-layer]')).toHaveCount(before);
    await expect(page.locator('.cue'), 'and the sound on it').toHaveCount(1);
  });

  test('agreeing to a removal takes the layer and its sound', async ({ page }) => {
    await withASound(page);
    const before = await page.locator('[data-gutter-layer]').count();
    await page.locator('[data-gutter-layer]').first()
      .getByRole('button', { name: '×', exact: true }).click();
    await page.locator('.ask button', { hasText: 'Remove it' }).click();

    await expect(page.locator('[data-gutter-layer]')).toHaveCount(before - 1);
    await expect(page.locator('.cue')).toHaveCount(0);
  });

  test('a press on the dimmed area outside is a way out', async ({ page }) => {
    await withASound(page);
    await page.locator('.dock__tab', { hasText: 'Session' }).first().click();
    await page.locator('.dock--right button', { hasText: 'New project' }).first().click();

    await expect(card(page)).toContainText('Start a new project?');
    await page.locator('.ask').click({ position: { x: 6, y: 6 } });
    await expect(page.locator('.ask')).toHaveCount(0);
    await expect(page.locator('.cue'), 'nothing was thrown away').toHaveCount(1);
  });

  test('agreeing to start again clears the piece', async ({ page }) => {
    await withASound(page);
    await page.locator('.dock__tab', { hasText: 'Session' }).first().click();
    await page.locator('.dock--right button', { hasText: 'New project' }).first().click();
    await page.locator('.ask button', { hasText: 'Start again' }).click();

    await expect(page.locator('.ask')).toHaveCount(0);
    await expect(page.locator('.cue')).toHaveCount(0);
  });
});

/*
 * A question is modal, which means the letters underneath it are not live.
 *
 * The app puts a great deal on the bare letters — six tools, thirteen drum
 * pads, the shuttle — and none of that should fire while a question is up.
 *
 * The two shapes need testing separately, which is not obvious. With a field
 * the app is already safe: its own key handler ignores anything typed into an
 * input. A yes-or-no question has no field, focus sits on a button, and that
 * guard does not apply — so it is the confirm, not the prompt, that the
 * dialog's own handling actually protects.
 */
test('keys do not reach the app while a yes-or-no question is up', async ({ page }) => {
  await withASound(page);
  await page.locator('[data-gutter-layer]').first()
    .getByRole('button', { name: '×', exact: true }).click();
  await expect(card(page)).toBeVisible();

  const cues = await page.locator('.cue').count();
  // A tool key, a pad, and the snap cycle.
  await page.keyboard.press('c');
  await page.keyboard.press('t');
  await page.keyboard.press('s');

  await expect(page.locator('.rail__tool.is-on'), 'the tool did not change')
    .toHaveAttribute('aria-label', 'Move tool');
  await expect(page.locator('.cue'), 'no pad played onto the timeline').toHaveCount(cues);
  await expect(card(page), 'and the question is still waiting').toBeVisible();
});

test('typing a name does not reach the app underneath', async ({ page }) => {
  await withASound(page);
  await page.locator('.dock__tab', { hasText: 'Selected' }).first().click();
  await page.locator('.dock--right button', { hasText: 'Save as mine' }).first().click();

  const cues = await page.locator('.cue').count();
  await page.locator('.ask__field').fill('');
  // Every one of these is a tool key, a pad, or the shuttle.
  await page.keyboard.type('chzptvskl');
  await expect(page.locator('.ask__field')).toHaveValue('chzptvskl');
  await expect(page.locator('.rail__tool.is-on'), 'the tool did not change')
    .toHaveAttribute('aria-label', 'Move tool');
  await expect(page.locator('.cue'), 'no pad played onto the timeline').toHaveCount(cues);
});

/*
 * Tab stays inside, which is what makes it a modal rather than a card that
 * happens to be on top.
 *
 * Tabbing out of a question lands on a timeline that is dimmed, cannot be
 * seen properly, and should not be edited while something is waiting on an
 * answer — and once focus is out there, nothing says how to get back.
 */
test('Tab cycles inside the question and does not leave it', async ({ page }) => {
  await withASound(page);
  await page.locator('.dock__tab', { hasText: 'Selected' }).first().click();
  await page.locator('.dock--right button', { hasText: 'Save as mine' }).first().click();
  await expect(page.locator('.ask__field')).toBeFocused();

  const inside = () => page.evaluate(() => !!document.activeElement?.closest('.ask'));

  // Field, Cancel, Save it, and back to the field.
  const order: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    expect(await inside(), `left the question on press ${i + 1}`).toBe(true);
    order.push(await page.evaluate(() => {
      const on = document.activeElement as HTMLElement;
      return on.tagName === 'INPUT' ? 'field' : on.innerText.trim();
    }));
  }
  expect(order, 'it went round rather than out').toEqual(['Cancel', 'Save it', 'field', 'Cancel']);

  // And backwards.
  await page.keyboard.press('Shift+Tab');
  expect(await inside(), 'shift-tab left the question').toBe(true);
});
