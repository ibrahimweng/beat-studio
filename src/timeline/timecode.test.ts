import { describe, expect, it } from 'vitest';
import { frameAt, parseTimecode, timecode } from './project.ts';

/*
 * The format is the whole point of these.
 *
 * It used to be three fields, minutes:seconds:frames, which collides with the
 * clock everybody reads by habit: a six second clip said "0:05:29" and a
 * ninety minute one said "90:00:00". Both of those are wrong to a person who
 * works with picture, and the second is wrong to anybody. So these pin the
 * shape as much as the arithmetic.
 */
describe('timecode', () => {
  it('always writes four padded fields', () => {
    expect(timecode(0, 30)).toBe('00:00:00:00');
    for (const seconds of [0, 0.5, 7, 61, 3599, 3600, 7325.5]) {
      expect(timecode(seconds, 30), `${seconds}s`).toMatch(/^\d\d:\d\d:\d\d:\d\d$/);
    }
  });

  it('does not read as a wall clock', () => {
    // Six seconds. The old format said "0:05:29", which reads as five
    // minutes twenty nine to anyone used to picture.
    expect(timecode(5.977, 30)).toBe('00:00:05:29');
  });

  it('carries hours instead of piling them into the minutes', () => {
    expect(timecode(3600, 30)).toBe('01:00:00:00');
    // An hour and a half used to come out as "90:00:00".
    expect(timecode(5400, 30)).toBe('01:30:00:00');
    expect(timecode(7325, 25)).toBe('02:02:05:00');
  });

  it('counts frames at the project rate', () => {
    expect(timecode(1.5, 30)).toBe('00:00:01:15');
    expect(timecode(1.5, 24)).toBe('00:00:01:12');
    // A frame is never the next second, however close it lands.
    expect(timecode(0.999, 30)).toBe('00:00:00:29');
  });

  it('treats a time before the start as the start', () => {
    expect(timecode(-10, 30)).toBe('00:00:00:00');
  });

  it('falls back to a sane rate rather than dividing by nothing', () => {
    expect(timecode(1.5, 0)).toBe('00:00:01:15');
  });
});

/*
 * The other direction, which is how a length gets typed in.
 *
 * The rule is that the number of parts decides what they mean, counting from
 * the right the way a clock is read, with four being the app's own format. So
 * these are as much about what is refused as about what is read: a field that
 * takes "abc" as zero is a field that empties the timeline.
 */
describe('parseTimecode', () => {
  it('reads a bare number as seconds', () => {
    expect(parseTimecode('30', 30)).toBe(30);
    expect(parseTimecode('7.5', 30)).toBe(7.5);
    expect(parseTimecode('  12  ', 30)).toBe(12);
  });

  it('reads two parts as minutes and seconds', () => {
    expect(parseTimecode('1:30', 30)).toBe(90);
    expect(parseTimecode('0:05', 30)).toBe(5);
  });

  it('reads three parts as a wall clock, not as frames', () => {
    expect(parseTimecode('1:20:00', 30)).toBe(4800);
    expect(parseTimecode('0:01:30', 30)).toBe(90);
  });

  it('reads four parts as the app writes them', () => {
    expect(parseTimecode('00:01:30:12', 30)).toBeCloseTo(90.4, 6);
    expect(parseTimecode('01:00:00:00', 30)).toBe(3600);
    /*
     * A round trip lands within a frame, and cannot do better.
     *
     * Timecode counts whole frames, so 125.5s at 25fps is twelve and a half
     * frames and is written as twelve. Reading it back gives 125.48. That is
     * the format's resolution rather than a fault, so what is pinned here is
     * the size of the gap: within one frame, never further.
     */
    for (const [seconds, rate] of [[125.5, 25], [7.98, 30], [3601.4, 24]] as const) {
      const back = parseTimecode(timecode(seconds, rate), rate);
      expect(back, `${seconds}s at ${rate}fps`).not.toBeNull();
      expect(Math.abs(back! - seconds)).toBeLessThan(1 / rate);
      // And never past it, since a length is written by flooring.
      expect(back!).toBeLessThanOrEqual(seconds);
    }
  });

  it('counts frames at the rate it is given', () => {
    expect(parseTimecode('00:00:00:15', 30)).toBeCloseTo(0.5, 6);
    expect(parseTimecode('00:00:00:12', 24)).toBeCloseTo(0.5, 6);
  });

  it('refuses anything that is not a length', () => {
    for (const bad of ['', '   ', 'abc', '1:ab', '-5', '1:2:3:4:5', '::', '1::2']) {
      expect(parseTimecode(bad, 30), bad).toBeNull();
    }
  });

  it('falls back to a sane rate rather than dividing by nothing', () => {
    expect(parseTimecode('00:00:01:15', 0)).toBeCloseTo(1.5, 6);
  });
});

/*
 * The frame a time is actually on.
 *
 * These are the ones that were wrong. `timecode` used to take the fraction of
 * a second first and multiply that by the rate, which asks binary floating
 * point for numbers it does not hold: 2.3 minus 2 is 0.2999999999999998, and
 * thirty of those floor to 8. Nearly half of every frame position at 30fps
 * came out a frame early, and it went unnoticed because a frame is a
 * thirtieth of a second and the readout looked plausible either way.
 *
 * The app's whole job is landing a sound on the frame a cut happens on, so
 * the sweep is the test that matters: not a handful of cases someone thought
 * to write down, but every frame position over ten minutes at each rate.
 */
describe('frameAt', () => {
  it('puts every frame-snapped time on its own frame', () => {
    for (const fps of [24, 25, 30, 48, 50, 60]) {
      const wrong: number[] = [];
      for (let frame = 0; frame < fps * 600; frame++) {
        if (frameAt(frame / fps, fps) !== frame) wrong.push(frame);
      }
      expect(wrong.slice(0, 8), `${fps}fps, ${wrong.length} wrong of ${fps * 600}`).toEqual([]);
    }
  });

  it('does not round up to a frame that has not started', () => {
    // Two thirds of the way through frame 68 is still frame 68.
    expect(frameAt(68.67 / 30, 30)).toBe(68);
    expect(frameAt(0.999, 30)).toBe(29);
  });

  it('treats a time before the start as the start', () => {
    expect(frameAt(-10, 30)).toBe(0);
  });
});

describe('timecode and frameAt agree', () => {
  /*
   * The two used to be worked out separately, and the marker list wrote both
   * on the same row: a sound at 2.3 seconds was frame 69 in one column and
   * 00:00:02:08 -- frame 68 -- in the next.
   */
  it('names the same frame, over ten minutes', () => {
    const fps = 30;
    const wrong: string[] = [];
    for (let frame = 0; frame < fps * 600; frame++) {
      const at = frame / fps;
      const shown = Number(timecode(at, fps).split(':')[3]);
      if (shown !== frameAt(at, fps) % fps) wrong.push(`${frame}: ${timecode(at, fps)}`);
    }
    expect(wrong.slice(0, 8), `${wrong.length} rows disagreed`).toEqual([]);
  });

  it('the case that was wrong on screen', () => {
    expect(timecode(2.3, 30)).toBe('00:00:02:09');
    expect(timecode(7.3, 30)).toBe('00:00:07:09');
    expect(frameAt(2.3, 30)).toBe(69);
  });
});

/*
 * Rates that are not whole numbers still have to print two digits.
 *
 * 29.97 fills thirty frame slots and takes 1.001 seconds over it, which is
 * what non-drop timecode is. Taking the remainder against 29.97 itself prints
 * a fraction of a frame, which no edit suite can read.
 */
describe('timecode at broadcast rates', () => {
  it('writes whole frames, never a fraction of one', () => {
    for (const fps of [23.976, 29.97, 59.94]) {
      for (const at of [0, 0.5, 1, 61, 3600]) {
        expect(timecode(at, fps), `${at}s at ${fps}`).toMatch(/^\d\d:\d\d:\d\d:\d\d$/);
      }
    }
  });

  /*
   * The seconds are the seconds, whatever the rate is.
   *
   * This asked for slot counting at first -- thirty frame slots per second at
   * 29.97, the way non-drop timecode works -- and that is right for a rate
   * somebody chose and wrong for one this app measured off a clip. At 29.97 a
   * piece set to exactly twenty seconds counts 599 frames, and dividing that
   * by thirty reads as nineteen. CI caught it as a length typed as twenty
   * seconds coming back as 00:00:19:29.
   */
  it('shows the length that was asked for, at any measured rate', () => {
    for (const fps of [30, 29.97, 29.95, 29.9, 30.03, 25, 24, 23.976, 60]) {
      expect(timecode(20, fps), `twenty seconds at ${fps}fps`).toBe('00:00:20:00');
      expect(timecode(90, fps), `a minute and a half at ${fps}fps`).toBe('00:01:30:00');
    }
  });

  it('never shows a frame number the rate does not have', () => {
    const tooHigh: string[] = [];
    for (const fps of [24, 25, 29.97, 30, 50, 59.94, 60]) {
      const slots = Math.round(fps);
      for (let at = 0; at < 400; at += 1) {
        const shown = Number(timecode(at / 37, fps).split(':')[3]);
        if (shown >= slots) tooHigh.push(`${(at / 37).toFixed(3)}s at ${fps}fps showed ${shown}`);
      }
    }
    expect(tooHigh.slice(0, 6), `${tooHigh.length} readings ran past the rate`).toEqual([]);
  });

  it('ticks the second over exactly on the second', () => {
    for (const fps of [29.97, 30, 23.976]) {
      expect(timecode(1, fps), `one second at ${fps}fps`).toBe('00:00:01:00');
      expect(timecode(0.999, fps), `just before it at ${fps}fps`).toMatch(/^00:00:00:/);
    }
  });
});
