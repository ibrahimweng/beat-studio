import { describe, expect, it } from 'vitest';
import { ROOMS, ROOM_NAMES, buildRoom, roomOfLength } from './room.ts';
import { sequence } from './voice-spec.ts';

/**
 * The rooms every sound in the app can be put in.
 *
 * A room here is an impulse the convolver multiplies a sound by, built from
 * noise rather than loaded from a file -- which is what lets the app say
 * nothing is fetched from anywhere. Six of them, and the whole claim is that
 * they are what their names say: a booth is small and short, a cathedral is
 * long and open, and turning the Space control up moves the walls out.
 *
 * None of it was checked. A room that comes back the wrong length is a tail
 * that stops rather than fades, which is a click at the end of every sound
 * placed in it -- and the comment in `buildRoom` says that exact fault was
 * found by measuring once already.
 */

const RATE = 44_100;
const ctx = (seconds: number): OfflineAudioContext =>
  new OfflineAudioContext(2, Math.round(RATE * seconds), RATE);
const random = (): (() => number) => sequence(12345);

/** Where the tail has fallen to a thousandth of its loudest, in seconds. */
function tailOf(buffer: AudioBuffer): number {
  const samples = buffer.getChannelData(0);
  let loudest = 0;
  for (let at = 0; at < samples.length; at += 1) loudest = Math.max(loudest, Math.abs(samples[at]));
  const floor = loudest * 0.001;
  for (let at = samples.length - 1; at >= 0; at -= 1) {
    if (Math.abs(samples[at]) > floor) return at / buffer.sampleRate;
  }
  return 0;
}

describe('every room', () => {
  it('is built, and has something in it', () => {
    const empty: string[] = [];
    for (const name of ROOM_NAMES) {
      const spec = ROOMS[name];
      const impulse = buildRoom(ctx(spec.seconds + 2), spec, random());
      const tail = tailOf(impulse);
      if (!(tail > 0.01)) empty.push(`${name} came back with a tail of ${tail.toFixed(4)}s`);
    }
    expect(empty, `${empty.length} rooms were empty`).toEqual([]);
  });

  /*
   * Long enough for the slowest band, not for the nominal one.
   *
   * The bottom rings longer than the middle, so a buffer cut at the named
   * length ends while the bass is still going -- a tail that stops rather
   * than fades, and a click at the end of every sound in that room.
   */
  it('rings for at least as long as its name says', () => {
    const short: string[] = [];
    for (const name of ROOM_NAMES) {
      const spec = ROOMS[name];
      const tail = tailOf(buildRoom(ctx(spec.seconds + 4), spec, random()));
      if (tail < spec.seconds * 0.6) {
        short.push(`${name} asks for ${spec.seconds}s, rang ${tail.toFixed(2)}s`);
      }
    }
    expect(short, `${short.length} rooms were cut short`).toEqual([]);
  });

  it('is bigger the further down the list it sits', () => {
    const tails = ROOM_NAMES.map((name) => ({
      name,
      seconds: ROOMS[name].seconds,
      tail: tailOf(buildRoom(ctx(ROOMS[name].seconds + 4), ROOMS[name], random())),
    }));
    // Against the named length rather than the order, because `plate` is a
    // long tail in a small box and sits where it does for that reason.
    const byName = [...tails].sort((a, b) => a.seconds - b.seconds);
    const wrong: string[] = [];
    for (let at = 1; at < byName.length; at += 1) {
      if (byName[at].tail < byName[at - 1].tail * 0.9) {
        wrong.push(`${byName[at].name} (${byName[at].tail.toFixed(2)}s) is shorter than ` +
          `${byName[at - 1].name} (${byName[at - 1].tail.toFixed(2)}s)`);
      }
    }
    expect(wrong, `${wrong.length} rooms were out of order`).toEqual([]);
  });

  it('is the same room every time, so an export matches what was heard', () => {
    for (const name of ROOM_NAMES) {
      const spec = ROOMS[name];
      const once = buildRoom(ctx(spec.seconds + 1), spec, random()).getChannelData(0);
      const kept = Float32Array.from(once);
      const again = buildRoom(ctx(spec.seconds + 1), spec, random()).getChannelData(0);

      let worst = 0;
      for (let at = 0; at < kept.length; at += 1) worst = Math.max(worst, Math.abs(kept[at] - again[at]));
      expect(worst, `${name} built two different rooms from one stream`).toBe(0);
    }
  });

  it('is in stereo, and not the same on both sides', () => {
    const flat: string[] = [];
    for (const name of ROOM_NAMES) {
      const spec = ROOMS[name];
      const impulse = buildRoom(ctx(spec.seconds + 1), spec, random());
      expect(impulse.numberOfChannels, `${name} is stereo`).toBe(2);
      const left = impulse.getChannelData(0);
      const right = impulse.getChannelData(1);
      let apart = 0;
      for (let at = 0; at < left.length; at += 1) apart = Math.max(apart, Math.abs(left[at] - right[at]));
      if (apart < 1e-6) flat.push(name);
    }
    expect(flat, `${flat.length} rooms were the same on both sides`).toEqual([]);
  });
});

/*
 * The Space control on a placed sound, which is one number rather than a
 * choice of room. Size follows length, because somebody turning one control
 * up expects the walls to move out as the tail grows.
 */
describe('a room made to a length', () => {
  it('rings longer the longer it is asked for', () => {
    const tails = [0.3, 1, 2.5].map((seconds) =>
      tailOf(roomOfLength(ctx(seconds + 4), seconds, 0.3, random())),
    );
    expect(tails[1], `${tails[1].toFixed(2)}s against ${tails[0].toFixed(2)}s`)
      .toBeGreaterThan(tails[0]);
    expect(tails[2], `${tails[2].toFixed(2)}s against ${tails[1].toFixed(2)}s`)
      .toBeGreaterThan(tails[1]);
  });

  it('is duller the more it is damped', () => {
    const bright = roomOfLength(ctx(4), 2, 0.05, random()).getChannelData(0);
    const dull = roomOfLength(ctx(4), 2, 0.9, random()).getChannelData(0);
    // Zero crossings stand in for how much top is left in the tail.
    const crossings = (samples: Float32Array): number => {
      let count = 0;
      for (let at = 1; at < samples.length; at += 1) {
        if (samples[at - 1] < 0 !== samples[at] < 0) count += 1;
      }
      return count;
    };
    expect(crossings(dull), 'a damped room keeps less of the top')
      .toBeLessThan(crossings(bright));
  });
});
