import { expect, test, type Page } from '@playwright/test';
import { currentTool, cursorOver, loadClip, open, placeSound, zoomIn } from './app.ts';

/**
 * Where each tool applies, and where it deliberately does not.
 *
 * The tools were right about what they do and wrong about where. Every one of
 * them reached the automation curves, because the handler that routes them
 * stepped aside for a curve lane and the curve editor asks only whether the
 * pen is held -- so panning across an open layer wrote a point into the
 * automation, and so did zooming, and so did the blade. Meanwhile the picture
 * was outside the tools altogether: the hand could not move it, because it
 * had no size but the one that fit the stage.
 *
 * Both are about a surface rather than about a tool, which is why they are
 * here rather than in tools.spec.ts, and why every case is a tool crossed
 * with a place.
 */

/** Open the first layer's curve lanes, and hand back the one that is open. */
async function openCurve(page: Page) {
  await page.locator('[data-gutter-layer]').first()
    .getByRole('button', { name: 'A', exact: true }).click();
  const lane = page.locator('.tl__auto:not(.is-shut)').first();
  await lane.waitFor();
  return lane;
}

const points = (page: Page) =>
  page.locator('.tl__auto:not(.is-shut) .tl__auto-point').count();

test.describe('the curve lanes', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await loadClip(page);
    await placeSound(page, 0.25);
  });

  /*
   * The fault, stated as the rule it broke.
   *
   * Checked with a drag rather than a click because that is what the hand and
   * the pen are for, and because a drag is what left a point behind and then
   * moved it -- a click alone understates what was happening to the curve.
   */
  test('only Move and the pen write points on a curve', async ({ page }) => {
    for (const [key, tool, writes] of [
      ['v', 'Move', true],
      ['p', 'Pen', true],
      ['h', 'Hand', false],
      ['z', 'Zoom', false],
      ['c', 'Cut', false],
      ['t', 'Range', false],
    ] as const) {
      await page.reload();
      await expect(page.locator('.rail__tool').first()).toBeVisible();
      const lane = await openCurve(page);
      await page.keyboard.press(key);

      const before = await points(page);
      const box = (await lane.boundingBox())!;
      await page.mouse.move(box.x + 40, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 180, box.y + box.height / 2 - 8, { steps: 8 });
      await page.mouse.up();
      const after = await points(page);

      if (writes) expect(after, `${tool} draws on a curve`).toBeGreaterThan(before);
      else expect(after, `${tool} must not touch the curve`).toBe(before);
    }
  });

  test('the hand pans across a curve lane instead of drawing on it', async ({ page }) => {
    const lane = await openCurve(page);
    await zoomIn(page, 3);
    await page.keyboard.press('h');

    const box = (await lane.boundingBox())!;
    await page.mouse.move(box.x + 400, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    const scrolled = await page.locator('.tl__viewport').evaluate((n) => n.scrollLeft);
    expect(scrolled, 'the view moved').toBeGreaterThan(0);
    expect(await points(page), 'nothing was drawn').toBe(0);
  });

  test('zoom zooms over a curve lane instead of drawing on it', async ({ page }) => {
    const lane = await openCurve(page);
    await page.keyboard.press('z');
    const wide = () => page.locator('.tl__content').evaluate((n) => n.getBoundingClientRect().width);

    const before = await wide();
    const box = (await lane.boundingBox())!;
    await page.mouse.click(box.x + 120, box.y + box.height / 2);

    expect(await wide(), 'it zoomed in').toBeGreaterThan(before);
    expect(await points(page), 'nothing was drawn').toBe(0);
  });
});

/**
 * The picture, which had no size but the one that fit the stage.
 *
 * A tool called Hand that cannot move the picture does not do what its name
 * says, and it could not, because there was nothing to move it to. So the
 * zoom is the thing being tested here as much as the pan is.
 */
test.describe('the picture', () => {
  const scaleOf = (page: Page) =>
    page.locator('.vstage__video').evaluate((n) => getComputedStyle(n).transform);

  test.beforeEach(async ({ page }) => {
    await open(page);
    await loadClip(page);
  });

  test('starts whole, with nothing offering a way back', async ({ page }) => {
    expect(await scaleOf(page), 'no transform at Fit').toBe('none');
    await expect(page.locator('.vstage__fit')).toBeHidden();
  });

  test('the zoom tool goes into the picture, and alt comes back out', async ({ page }) => {
    await page.keyboard.press('z');
    const stage = (await page.locator('.vstage').boundingBox())!;
    const middle = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };

    await page.mouse.click(middle.x, middle.y);
    await expect(page.locator('.vstage')).toHaveClass(/is-zoomed/);
    const inOnce = await scaleOf(page);
    expect(inOnce, 'the picture is magnified').not.toBe('none');

    await page.mouse.click(middle.x, middle.y);
    expect(await scaleOf(page), 'a second press goes further in').not.toBe(inOnce);

    // Alt goes back out, and far enough out it is whole again. Held over the
    // presses rather than passed to them: `mouse.click` has no modifier of
    // its own, so the key has to actually be down.
    await page.keyboard.down('Alt');
    await page.mouse.click(middle.x, middle.y);
    await page.mouse.click(middle.x, middle.y);
    await page.keyboard.up('Alt');
    expect(await scaleOf(page), 'back to the whole picture').toBe('none');
    await expect(page.locator('.vstage')).not.toHaveClass(/is-zoomed/);
  });

  test('the hand moves the picture once there is somewhere to move it', async ({ page }) => {
    await page.keyboard.press('z');
    const stage = (await page.locator('.vstage').boundingBox())!;
    await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
    const before = await scaleOf(page);

    await page.keyboard.press('h');
    await page.mouse.move(stage.x + stage.width * 0.6, stage.y + stage.height / 2);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width * 0.35, stage.y + stage.height / 2, { steps: 8 });
    await page.mouse.up();

    expect(await scaleOf(page), 'the picture moved under the hand').not.toBe(before);
    // And it is a move, not a zoom: the last two numbers of the matrix are the
    // offset, the first and fourth are the scale.
    const [a, , , d] = (await scaleOf(page)).replace(/[^0-9.,-]/g, '').split(',').map(Number);
    const [a0, , , d0] = before.replace(/[^0-9.,-]/g, '').split(',').map(Number);
    expect(a, 'the magnification is unchanged').toBeCloseTo(a0, 3);
    expect(d, 'the magnification is unchanged').toBeCloseTo(d0, 3);
  });

  test('Fit puts the whole picture back', async ({ page }) => {
    await page.keyboard.press('z');
    const stage = (await page.locator('.vstage').boundingBox())!;
    await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await expect(page.locator('.vstage__fit')).toBeVisible();

    await page.locator('.vstage__fit').click();
    expect(await scaleOf(page)).toBe('none');
    await expect(page.locator('.vstage__fit')).toBeHidden();
  });

  /*
   * The picture cannot be thrown off the stage.
   *
   * A pan with no limit leaves you looking at an empty stage with nothing on
   * screen saying which way the picture went, and no way back but Fit.
   */
  test('the picture cannot be dragged away from the stage', async ({ page }) => {
    await page.keyboard.press('z');
    const stage = (await page.locator('.vstage').boundingBox())!;
    await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);

    await page.keyboard.press('h');
    // Far further than the picture has room for, several times over.
    for (let i = 0; i < 3; i += 1) {
      await page.mouse.move(stage.x + stage.width - 10, stage.y + stage.height / 2);
      await page.mouse.down();
      await page.mouse.move(stage.x - 600, stage.y - 600, { steps: 6 });
      await page.mouse.up();
    }

    /*
     * Measured against the video's own box, not the stage's.
     *
     * The stage has padding, so the picture never reaches its edges and never
     * should -- that border is the frame. What must hold is that the
     * magnified picture still covers the box it is drawn in, on every side.
     * The box is read from `offsetLeft` and `clientWidth`, which a transform
     * does not touch; the picture is read from the drawn rectangle, which is
     * the same box after it.
     */
    const seen = await page.locator('.vstage__video').evaluate((node) => {
      const video = node as HTMLVideoElement;
      let x = 0;
      let y = 0;
      for (let up: HTMLElement | null = video; up; up = up.offsetParent as HTMLElement | null) {
        x += up.offsetLeft;
        y += up.offsetTop;
      }
      const box = { x, y, width: video.clientWidth, height: video.clientHeight };

      const drawn = video.getBoundingClientRect();
      const at = Math.min(drawn.width / video.videoWidth, drawn.height / video.videoHeight);
      const wide = video.videoWidth * at;
      const tall = video.videoHeight * at;
      return {
        box,
        picture: {
          left: drawn.x + (drawn.width - wide) / 2,
          right: drawn.x + (drawn.width + wide) / 2,
          top: drawn.y + (drawn.height - tall) / 2,
          bottom: drawn.y + (drawn.height + tall) / 2,
        },
      };
    });

    expect(seen.picture.left, 'it pulled away from the left edge')
      .toBeLessThanOrEqual(seen.box.x + 1);
    expect(seen.picture.right, 'it pulled away from the right edge')
      .toBeGreaterThanOrEqual(seen.box.x + seen.box.width - 1);
    expect(seen.picture.top, 'it pulled away from the top edge')
      .toBeLessThanOrEqual(seen.box.y + 1);
    expect(seen.picture.bottom, 'it pulled away from the bottom edge')
      .toBeGreaterThanOrEqual(seen.box.y + seen.box.height - 1);
  });

  test('the tools that have no business on a frame say so', async ({ page }) => {
    const stage = (await page.locator('.vstage').boundingBox())!;
    for (const [key, tool] of [['c', 'cut'], ['t', 'range'], ['p', 'pen']] as const) {
      await page.keyboard.press(key);
      await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
      await expect(page.locator('.status, [class*="status"]').first())
        .toContainText(`${tool} tool works on the timeline`);
    }
    expect(await scaleOf(page), 'and none of them moved the picture').toBe('none');
  });

  test('the picture says which tool is over it', async ({ page }) => {
    await page.keyboard.press('h');
    expect(await cursorOver(page, '.vstage__video')).toBe('grab');
    await page.keyboard.press('z');
    expect(await cursorOver(page, '.vstage__video')).toBe('zoom-in');
    await page.keyboard.press('v');
    expect(await cursorOver(page, '.vstage__video'), 'Move leaves it plain').toBe('auto');
  });
});

/**
 * The layer column, which the tools deliberately do not apply to.
 *
 * A track header works whatever tool is held, in this app and in every edit
 * suite. What it must not do is claim otherwise, and it was: a text caret over
 * every layer name while the hand was held, promising a rename to a pointer
 * that was about to pan.
 */
test.describe('the layer column', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await loadClip(page);
  });

  test('does not offer a text caret while a tool is held', async ({ page }) => {
    await page.keyboard.press('v');
    expect(await cursorOver(page, '.tl__layer-name'), 'Move can rename').toBe('text');

    for (const [key, tool] of [['h', 'Hand'], ['c', 'Cut'], ['z', 'Zoom']] as const) {
      await page.keyboard.press(key);
      expect(await cursorOver(page, '.tl__layer-name'), `${tool} must not promise a rename`)
        .toBe('default');
    }
  });

  test('still works while a tool is held', async ({ page }) => {
    await page.keyboard.press('h');
    const row = page.locator('[data-gutter-layer]').first();
    await row.getByRole('button', { name: 'A', exact: true }).click();
    await expect(page.locator('.tl__auto:not(.is-shut)')).not.toHaveCount(0);
  });
});

/**
 * The letters, which the drum pads and the tools both want.
 *
 * Six are claimed twice and the record button settles those. It used to
 * settle all of them, including the four that were never in dispute.
 */
test.describe('the letter keys under record', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await loadClip(page);
    await page.getByTitle(/^Record:/).click();
  });

  test('a letter that is not a pad is still a tool', async ({ page }) => {
    for (const [key, name] of [['c', 'Cut tool'], ['z', 'Zoom tool'], ['p', 'Pen tool']] as const) {
      await page.keyboard.press(key);
      expect(await currentTool(page), `${key} while armed`).toBe(name);
    }
  });

  test('a letter that is a pad plays the pad and leaves the tool alone', async ({ page }) => {
    await page.keyboard.press('v');
    const before = await page.locator('.cue').count();
    await page.keyboard.press('t');
    await expect(page.locator('.cue')).toHaveCount(before + 1);
    expect(await currentTool(page), 'T stayed a drum').toBe('Move tool');
  });
});
