import { describe, expect, it } from 'vitest';
import { pickPeaks } from './analyse.ts';
import type { MotionSample, Peak } from './analyse.ts';
import { readMoments } from './moments.ts';
import type { MomentKind } from './moments.ts';
import clip from '../../test/fixtures/motion-shapes.json';

/**
 * Measurements arrive about this far apart.
 *
 * The scan aims for fifteen a second, so this is the spacing the classifier
 * is actually handed. It matters: the guard that keeps a hit out of its own
 * run-up is sized from it.
 */
const STEP = 1 / 15;
/** The clip's ordinary level, when nothing is happening. */
const FLOOR = 0.02;

function curve(duration: number, at: (t: number) => number): MotionSample[] {
  const out: MotionSample[] = [];
  for (let t = 0; t <= duration + 1e-9; t += STEP) {
    out.push({ t: Number(t.toFixed(4)), energy: at(t) });
  }
  return out;
}

/** True within about half a measurement of the given time. */
const near = (t: number, x: number): boolean => Math.abs(t - x) < STEP * 0.75;

/** What the app does: find the hits, then read the shape around each. */
function kindsOf(samples: MotionSample[], sensitivity = 0.5): MomentKind[] {
  const peaks = pickPeaks(samples, sensitivity, 0.08);
  const end = samples[samples.length - 1].t;
  return readMoments(samples, peaks, end).map((m) => m.kind);
}

describe('reading what kind of moment a hit is', () => {
  it('calls a spike out of stillness a cut', () => {
    expect(kindsOf(curve(4, (t) => (near(t, 2) ? 0.4 : FLOOR)))).toContain('appears');
  });

  it('calls a climb into a hit a build', () => {
    const samples = curve(4, (t) => {
      if (near(t, 2)) return 0.45;
      if (t > 1.25 && t < 2) return 0.03 + ((t - 1.25) / 0.75) * 0.22;
      return FLOOR;
    });
    expect(kindsOf(samples)).toContain('builds');
  });

  it('calls energy held across a stretch a move, and measures how long it runs', () => {
    const samples = curve(4, (t) => {
      if (near(t, 2)) return 0.24;
      if (t > 1.55 && t < 2.65) return 0.15;
      return FLOOR;
    });
    const peaks = pickPeaks(samples, 0.5, 0.08);
    const move = readMoments(samples, peaks, 4).find((m) => m.kind === 'moves');
    expect(move).toBeDefined();
    // The move in the picture is 1.1 seconds long, and the suggested whoosh
    // is cut to that rather than to a length this app picked.
    expect(move!.span).toBeGreaterThan(0.8);
    expect(move!.span).toBeLessThan(1.4);
  });

  it('calls a spike that keeps falling afterwards something landing', () => {
    const samples = curve(4, (t) => {
      if (near(t, 2)) return 0.42;
      if (t > 2 && t < 2.6) return 0.3 - ((t - 2) / 0.6) * 0.25;
      return FLOOR;
    });
    expect(kindsOf(samples)).toContain('lands');
  });

  it('gathers a flurry of hits into one sequence, keeping every hit in it', () => {
    const times = [2.0, 2.2, 2.4, 2.6];
    const samples = curve(4, (t) => (times.some((x) => near(t, x)) ? 0.35 : FLOOR));
    const peaks = pickPeaks(samples, 0.5, 0.08);
    const found = readMoments(samples, peaks, 4);
    const sequence = found.find((m) => m.kind === 'sequence');

    expect(sequence).toBeDefined();
    expect(sequence!.hits.length).toBe(times.length);
    // One row to decide about, not four.
    expect(found.filter((m) => m.kind === 'sequence')).toHaveLength(1);
  });

  it('offers a long still passage as a quiet stretch', () => {
    const samples = curve(9, (t) => ([0.6, 8.2].some((x) => near(t, x)) ? 0.4 : 0.008));
    const peaks = pickPeaks(samples, 0.5, 0.08);
    const quiet = readMoments(samples, peaks, 9).find((m) => m.kind === 'quiet');

    expect(quiet).toBeDefined();
    expect(quiet!.span).toBeGreaterThan(3.5);
    // Nothing to place on it hit by hit: it is a length of video, not a hit.
    expect(quiet!.hits).toHaveLength(0);
  });

  it('leaves a short gap between two hits alone', () => {
    const samples = curve(6, (t) => ([2, 4].some((x) => near(t, x)) ? 0.4 : 0.008));
    // Two seconds of nothing is the space between two hits, not a passage
    // anybody wants advice about.
    expect(kindsOf(samples)).not.toContain('quiet');
  });
});

describe('telling a move from a flurry of cuts', () => {
  /*
   * Both arrive as several hits close together, and counting the hits alone
   * gets the move wrong every time. What separates them is whether the curve
   * comes back down in between.
   */
  it('reads bumps along a raised stretch as one move', () => {
    const samples = curve(4, (t) => {
      if (t > 1.55 && t < 2.65) return 0.15 + Math.abs(Math.sin(t * 41)) * 0.09;
      return FLOOR + Math.abs(Math.sin(t * 37)) * 0.004;
    });
    const kinds = kindsOf(samples);
    expect(kinds).toContain('moves');
    expect(kinds).not.toContain('sequence');
  });

  it('reads spikes over stillness as a sequence', () => {
    const times = [2.0, 2.25, 2.5, 2.75];
    const samples = curve(4, (t) => (times.some((x) => near(t, x)) ? 0.42 : FLOOR));
    const kinds = kindsOf(samples);
    expect(kinds).toContain('sequence');
    expect(kinds).not.toContain('moves');
  });
});

describe('the two faults a real clip turned up', () => {
  /*
   * Both were found by scoring a clip whose right answer was known, and both
   * are the kind that never shows up in a reading of the code.
   */

  it('does not mistake a hard cut for a build on its own smeared energy', () => {
    /*
     * The scan measures a few frames apart while the second pass pins each
     * hit to its exact frame, so the hit's energy lands in the coarse
     * measurement beside it, at a time the refined hit has moved away from.
     * Read without a guard the cut appears to have led up to itself, and the
     * app told somebody a hard cut out of five seconds of stillness had been
     * building.
     *
     * Written against the real measurements rather than a curve made up here,
     * because how much energy smears and how far it reaches are properties of
     * the decoder and the scan's playback rate. A run-up invented by hand can
     * be tuned until it passes while the fault it stands for is untouched,
     * which is what the first version of this test did.
     */
    const samples = clip.samples as MotionSample[];
    // The last cut in the clip: five seconds of stillness, then a hard change.
    const cut = (clip.peaks as Peak[]).find((p) => p.t > 11)!;
    const found = readMoments(samples, [cut], 12.95).find((m) => m.t === cut.t)!;

    expect(found.kind).toBe('appears');
  });

  it('still calls a small run-up into a big cut a build', () => {
    /*
     * The other side of the same coin. A build that arrives at a hard cut has
     * a run-up many times smaller than the cut, so judging the climb as a
     * share of the cut throws away exactly the case this is for: an eight
     * hundred millisecond build into a title card came out as a plain cut,
     * because the cut was six times the size of everything leading to it.
     */
    const hit = 3;
    const samples = curve(6, (t) => {
      if (t <= hit - 0.8 || t >= hit - STEP) return 0.001;
      const k = (t - (hit - 0.8)) / 0.8;
      return 0.01 + k * k * 0.16;
    });
    const peaks: Peak[] = [{ t: hit, energy: 0.92 }];

    expect(readMoments(samples, peaks, 6).map((m) => m.kind)).toContain('builds');
  });
});

describe('a clip read by the app itself', () => {
  /*
   * Real measurements, taken by the scan off a clip built with one of each
   * shape in it. Kept because it is decoder output rather than arithmetic:
   * the noise, the smear and the uneven spacing are all real, and both faults
   * above were found here rather than in the tidy curves written by hand.
   */
  const samples = clip.samples as MotionSample[];
  const peaks = clip.peaks as Peak[];
  const found = readMoments(samples, peaks, 12.95);

  it('finds every shape that was put in it, and nothing else', () => {
    expect(found.map((m) => m.kind)).toEqual([
      'appears', // a cut at 1.0
      'appears', // the cut that starts the run-up at 2.0
      'builds', // the run-up arriving at 2.8
      'moves', // the stripes travelling, 3.6 to 4.8
      'sequence', // four flashes, 5.4 to 6.4
      'quiet', // nothing at all, 6.4 to 11.6
      'appears', // a cut at 11.6
    ]);
  });

  it('lands each one on the moment it belongs to', () => {
    const at = (kind: MomentKind): number => found.find((m) => m.kind === kind)!.t;
    expect(at('builds')).toBeCloseTo(2.87, 1);
    expect(at('moves')).toBeCloseTo(3.59, 1);
    expect(at('sequence')).toBeCloseTo(5.43, 1);
  });

  it('measures the move and the quiet stretch against the picture', () => {
    const move = found.find((m) => m.kind === 'moves')!;
    const quiet = found.find((m) => m.kind === 'quiet')!;
    // The stripes travel for 1.2 seconds and the still passage runs 5.2.
    expect(move.span).toBeGreaterThan(1);
    expect(move.span).toBeLessThan(1.5);
    expect(quiet.span).toBeGreaterThan(5);
  });

  it('scores the strongest moment highest and the quiet one lowest', () => {
    const quiet = found.find((m) => m.kind === 'quiet')!;
    const loudest = [...found].sort((a, b) => b.strength - a.strength)[0];
    expect(loudest.strength).toBe(1);
    expect(quiet.strength).toBeLessThan(0.1);
    for (const moment of found) {
      expect(moment.strength).toBeGreaterThanOrEqual(0);
      expect(moment.strength).toBeLessThanOrEqual(1);
    }
  });

  it('gives a moment the same id however many others are shown', () => {
    /*
     * Moving the sensitivity re-reads the whole list, and a decision already
     * made about a moment has to survive that. Ids come from the time for
     * exactly this reason: counted in order, moment four's "already placed"
     * would land on whichever moment came fourth the second time.
     */
    const fewer = readMoments(samples, peaks.slice(0, 6), 12.95);
    const shared = found.filter((m) => fewer.some((f) => f.id === m.id));
    expect(shared.length).toBeGreaterThan(2);
    for (const moment of shared) {
      expect(fewer.find((f) => f.id === moment.id)!.t).toBe(moment.t);
    }
  });
});

describe('holding up on nothing much', () => {
  it('says nothing about a clip it could not measure', () => {
    expect(readMoments([], [], 0)).toEqual([]);
    expect(readMoments([{ t: 0, energy: 0 }], [], 1)).toEqual([]);
  });

  it('reads a clip with no hits in it as one quiet stretch', () => {
    const samples = curve(8, () => 0.004);
    expect(readMoments(samples, [], 8).map((m) => m.kind)).toEqual(['quiet']);
  });

  it('gives every moment an id of its own', () => {
    const samples = clip.samples as MotionSample[];
    const ids = readMoments(samples, clip.peaks as Peak[], 12.95).map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
