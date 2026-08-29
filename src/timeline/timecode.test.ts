import { describe, expect, it } from 'vitest';
import { timecode } from './project.ts';

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
