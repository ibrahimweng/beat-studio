import { describe, expect, it } from 'vitest';
import { runsFor, type Peak, type Span } from './analyse.ts';

const FRAME = 1 / 30;

/** A moment, and the stretch the pinning pass wants to look at around it. */
function span(at: number, back = 12): Span {
  const peak: Peak = { t: at, energy: 0.5 };
  return { peak, from: Math.max(0, at - back * FRAME), to: at + FRAME };
}

/**
 * Which stretches of a clip get read together.
 *
 * This is the whole cost of pinning. Every run is one seek, and a seek was
 * measured at 334ms on a 1080p clip against about 70ms to play through a
 * frame -- so on a busy piece, where moments land a few frames apart, the
 * difference between reading them together and reading them one at a time is
 * a hundred and sixty stops against a handful.
 */
describe('gathering the stretches to read', () => {
  it('leaves moments that are nowhere near each other alone', () => {
    const runs = runsFor([span(2), span(8), span(14)], FRAME);
    expect(runs).toHaveLength(3);
    expect(runs.map((run) => run.wants.length)).toEqual([1, 1, 1]);
  });

  it('reads overlapping stretches in one go', () => {
    // Half a window apart, so the second starts inside the first.
    const runs = runsFor([span(2), span(2 + 6 * FRAME)], FRAME);
    expect(runs).toHaveLength(1);
    expect(runs[0].wants).toHaveLength(2);
  });

  it('covers everything both stretches asked for', () => {
    const a = span(2);
    const b = span(2 + 6 * FRAME);
    const [run] = runsFor([a, b], FRAME);
    expect(run.from).toBeCloseTo(a.from, 6);
    expect(run.to).toBeCloseTo(b.to, 6);
  });

  it('joins across a short gap, because stopping costs more than reading', () => {
    // The stretches do not touch: three frames of clip sit between them.
    const a = span(2);
    const b = span(2 + 15 * FRAME);
    expect(b.from).toBeGreaterThan(a.to);
    expect(runsFor([a, b], FRAME)).toHaveLength(1);
  });

  it('stops rather than reading a long stretch nobody asked for', () => {
    const a = span(2);
    const b = span(2 + 30 * FRAME);
    expect(runsFor([a, b], FRAME)).toHaveLength(2);
  });

  it('works from a set that arrived out of order', () => {
    const runs = runsFor([span(8), span(2), span(2 + 6 * FRAME)], FRAME);
    expect(runs).toHaveLength(2);
    expect(runs[0].from).toBeLessThan(runs[1].from);
    expect(runs[0].wants).toHaveLength(2);
  });

  it('keeps every moment, so none is left unpinned', () => {
    const many = [span(1), span(1.1), span(3), span(3.05), span(3.1), span(9)];
    const runs = runsFor(many, FRAME);
    const kept = runs.flatMap((run) => run.wants);
    expect(kept).toHaveLength(many.length);
    expect(new Set(kept.map((s) => s.peak.t)).size).toBe(many.length);
  });
});
