import { describe, expect, it } from 'vitest';
import { parseTimecode, timecode } from './project.ts';

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
