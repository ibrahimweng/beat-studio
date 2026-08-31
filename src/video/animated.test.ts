import { describe, expect, it } from 'vitest';
import { canReadAnimated, isAnimatedImage } from './animated.ts';

/**
 * Telling a moving picture from a video, before anything tries to play it.
 *
 * Getting this wrong is quiet in both directions. A GIF that is not
 * recognised goes straight to a video element, which refuses it with "this
 * browser cannot play that file" -- true, and no help at all, because the
 * browser can read it perfectly well, just not that way. A video that is
 * mistaken for an image goes to a decoder that cannot open it and fails for
 * a reason that has nothing to do with anything.
 */

const file = (name: string, type: string): File =>
  new File([new Uint8Array([1, 2, 3])], name, { type });

describe('what counts as a moving picture', () => {
  it('takes the formats that move but are not video', () => {
    for (const [name, type] of [
      ['loop.gif', 'image/gif'],
      ['loop.apng', 'image/apng'],
      ['loop.webp', 'image/webp'],
      ['loop.avif', 'image/avif'],
      ['LOOP.GIF', 'image/gif'],
    ] as const) {
      expect(isAnimatedImage(file(name, type)), name).toBe(true);
    }
  });

  it('leaves video alone', () => {
    for (const [name, type] of [
      ['clip.webm', 'video/webm'],
      ['clip.mp4', 'video/mp4'],
      ['clip.mov', 'video/quicktime'],
    ] as const) {
      expect(isAnimatedImage(file(name, type)), name).toBe(false);
    }
  });

  it('leaves a still image alone', () => {
    expect(isAnimatedImage(file('shot.png', 'image/png'))).toBe(false);
    expect(isAnimatedImage(file('shot.jpg', 'image/jpeg'))).toBe(false);
  });

  /*
   * A file dragged from some places arrives with no type at all, and its name
   * is the only thing there is to go on.
   */
  it('falls back to the name when the file does not say what it is', () => {
    expect(isAnimatedImage(file('loop.gif', '')), 'named, unstated').toBe(true);
    expect(isAnimatedImage(file('clip.webm', '')), 'a video, unstated').toBe(false);
    expect(isAnimatedImage(file('nameless', '')), 'nothing to go on').toBe(false);
  });

  /*
   * The name is only consulted when the type is silent. A file that says it
   * is a video is a video, whatever somebody called it.
   */
  it('believes the type over the name', () => {
    expect(isAnimatedImage(file('actually-a-video.gif', 'video/webm'))).toBe(false);
  });
});

describe('what the browser can do', () => {
  it('says whether it can read one at all', () => {
    // Both are needed: one to read the frames, one to write them back out.
    const answer = canReadAnimated();
    expect(typeof answer).toBe('boolean');
    const has = typeof globalThis.ImageDecoder === 'function'
      && typeof globalThis.MediaRecorder === 'function';
    expect(answer, 'it agrees with what is actually here').toBe(has);
  });
});
