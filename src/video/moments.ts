/**
 * What kind of moment each found hit is.
 *
 * The scan measures how much the picture changes and picks out the moments
 * that stand out. Until now only the height of each spike was used, and a
 * spike on its own says a moment is here without saying anything about what
 * sort of moment it is. The shape of the curve around it does say: a cut
 * arrives out of nothing, a build climbs into itself, a move holds its energy
 * across half a second rather than spending it all at once.
 *
 * That distinction is the whole of what somebody new to this is missing. They
 * can see that something happens at 0:02:04. What they cannot see is that it
 * has been building since 0:01:22, and that the sound therefore has to arrive
 * rather than start.
 *
 * Nothing here reads the video again. It is arithmetic over measurements the
 * scan already took, so it costs nothing and it re-runs instantly whenever the
 * sensitivity moves.
 */
import type { MotionSample, Peak } from './analyse.ts';

export type MomentKind = 'appears' | 'builds' | 'moves' | 'lands' | 'sequence' | 'quiet';

export interface Moment {
  /**
   * Stable for as long as the moment stays where it is.
   *
   * Built from the time rather than handed out in order, because moving the
   * sensitivity re-reads the whole list and a moment that survives that has
   * to keep whatever the panel knows about it. An id counted from zero would
   * hand moment four's "already placed" to whichever moment landed fourth the
   * second time.
   */
  id: string;
  /** Seconds from the start of the video. */
  t: number;
  /**
   * How long the moment runs for, in seconds.
   *
   * Zero for a moment that is a point in time, which is most of them. A move
   * and a quiet stretch are the two that have a length of their own, and it
   * is the length the sound wants to be.
   */
  span: number;
  kind: MomentKind;
  /** How strongly it stood out, carried through from the scan. */
  energy: number;
  /**
   * How much this stands out among the moments found, 0 to 1.
   *
   * Relative rather than absolute, because the raw figure is an average
   * difference between two thumbnails and means nothing on its own. What a
   * sound has to match is how big this moment is compared with the others in
   * the same clip, which is what this is.
   */
  strength: number;
  /**
   * Every time this moment covers.
   *
   * One for a moment that is a point, which is most of them. Several for a
   * sequence, because a flurry of cuts is one thing to decide about and a
   * sound on each of them. None for a quiet stretch, which is a length of
   * video rather than a set of hits.
   */
  hits: readonly number[];
}

/** How far back a build has to climb before it counts as one. */
const LEAD = 0.7;
/** How far forward to look for energy that stays up. */
const TAIL = 0.6;
/**
 * Hits chained no further apart than this, in this many, are one sequence.
 *
 * A flurry of cuts is one decision and a sound on each of them, not four
 * unrelated decisions. Listing them separately is how somebody ends up
 * choosing four different impacts for what the viewer reads as a single
 * flourish.
 */
const SEQUENCE_GAP = 0.45;
const SEQUENCE_COUNT = 3;
/**
 * A gap with nothing in it, past this long, is worth saying something about.
 *
 * Under about three seconds a quiet stretch is just the space between two
 * hits, and offering a bed for it would be noise in the list rather than
 * advice. This is the length at which somebody starts to wonder whether they
 * have missed something.
 */
const QUIET_MIN = 3.5;
/** A stretch counts as quiet while it stays this close to the clip's floor. */
const QUIET_CEILING = 1.35;

/**
 * How much of a peak's own prominence has to appear in the surrounding curve
 * before that counts as a shape rather than as noise.
 *
 * Measured against the peak rather than against a fixed number, because a
 * clip of slow graphics and a clip of fast cuts have nothing in common except
 * that in both of them a hit stands above its own neighbourhood.
 */
const HOLD = 0.3;
/** A run-up has to end this far above the floor to be a run-up at all. */
const AWAKE = 0.1;
/** And it has to end this many times higher than it started. */
const RISE = 1.6;
/**
 * How much of the curve either side of a hit to leave out of the reading.
 *
 * The scan plays the clip faster than real time and so measures a few frames
 * apart, while the second pass pins each hit to the exact frame it happened
 * on. The two do not line up: the hit's own energy is smeared across the
 * coarse measurement beside it, which sits at a time the refined hit has
 * already moved away from. Read without this guard, every cut appears to have
 * been led up to by itself, and the app confidently tells somebody a hard cut
 * out of five seconds of stillness has been building.
 *
 * A sample and a half either side, since the smear is at most one gap wide.
 */
const GUARD = 1.5;

export function readMoments(
  samples: readonly MotionSample[],
  peaks: readonly Peak[],
  duration: number,
): Moment[] {
  if (samples.length < 3) return [];

  const floor = median(samples.map((s) => s.energy));
  const guard = spacing(samples) * GUARD;
  const moments: Moment[] = [];

  for (const run of runs(peaks)) {
    if (run.length >= SEQUENCE_COUNT) {
      moments.push(dipsBetween(samples, run, floor) ? asSequence(run) : asMove(samples, run, floor));
      continue;
    }
    for (const peak of run) moments.push(readOne(samples, peak, floor, guard));
  }

  const found = [...moments, ...quietStretches(samples, peaks, duration, floor)];
  const loudest = Math.max(...found.map((m) => m.energy), floor);
  const range = Math.max(loudest - floor, 1e-6);

  return found
    .map((moment) => ({
      ...moment,
      strength: Math.max(0, Math.min(1, (moment.energy - floor) / range)),
    }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Whether a run of hits comes back down between them.
 *
 * This is the whole difference between a flurry of cuts and one long move. A
 * sequence is spikes over stillness: the curve drops to the floor between each
 * pair. A camera move or a long transition is a raised, uneven stretch, and
 * every bump along the top of it is found as a hit of its own. Both arrive
 * here as several hits close together, and telling them apart by counting the
 * hits alone gets the move wrong every time, which is how a single push-in
 * ends up wearing eight ticks.
 */
function dipsBetween(samples: readonly MotionSample[], run: readonly Peak[], floor: number): boolean {
  const top = mean(run.map((p) => p.energy));
  const over = Math.max(top - floor, 1e-6);
  const troughs: number[] = [];

  for (let i = 0; i < run.length - 1; i++) {
    const inside = between(samples, run[i].t + 1e-6, run[i + 1].t - 1e-6);
    // Nothing measured between two hits means they are adjacent samples, which
    // is as close to a dip as the measurements can show.
    troughs.push(inside.length ? Math.min(...inside) : floor);
  }

  return mean(troughs) - floor < HOLD * over;
}

function asSequence(run: readonly Peak[]): Moment {
  const times = run.map((p) => p.t);
  return {
    id: idFor(times[0]),
    t: times[0],
    span: times[times.length - 1] - times[0],
    kind: 'sequence',
    energy: Math.max(...run.map((p) => p.energy)),
    strength: 0,
    hits: times,
  };
}

/**
 * A run that never came back down is one move, and it is the sound's length.
 *
 * Measured from the curve rather than from the first and last hit, because the
 * move starts before anything stands out enough to be found and ends after the
 * last bump along it.
 */
function asMove(samples: readonly MotionSample[], run: readonly Peak[], floor: number): Moment {
  const strongest = run.reduce((best, p) => (p.energy > best.energy ? p : best), run[0]);
  const over = Math.max(strongest.energy - floor, 1e-6);
  const span = moveSpan(samples, strongest.t, floor + HOLD * over);
  const from = run[0].t;
  return {
    id: idFor(from),
    t: from,
    span: Math.max(span, run[run.length - 1].t - from),
    kind: 'moves',
    energy: strongest.energy,
    strength: 0,
    hits: [from],
  };
}

/** Split the hits into groups that chain together, in order. */
function runs(peaks: readonly Peak[]): Peak[][] {
  const out: Peak[][] = [];
  for (const peak of [...peaks].sort((a, b) => a.t - b.t)) {
    const current = out[out.length - 1];
    if (current && peak.t - current[current.length - 1].t <= SEQUENCE_GAP) current.push(peak);
    else out.push([peak]);
  }
  return out;
}

/*
 * Strength is filled in by readMoments once every moment is known, since it is
 * a comparison between them. The zeros written here are never read.
 */
function readOne(samples: readonly MotionSample[], peak: Peak, floor: number, guard: number): Moment {
  const over = Math.max(peak.energy - floor, 1e-6);
  const id = idFor(peak.t);
  const hits = [peak.t];

  /*
   * Two readings of the same run-up, because the two questions are hurt by
   * opposite things.
   *
   * Whether the energy STAYS up is a mean over the whole window, where one
   * smeared measurement beside the hit is diluted to nothing, and where
   * dropping the samples nearest the hit would throw away the strongest
   * evidence there is. Whether it CLIMBS is a comparison against the end of
   * the window, which is exactly where the smear lands, so that one reads
   * short of the hit.
   */
  const before = between(samples, peak.t - LEAD, peak.t - 1e-6);
  const after = between(samples, peak.t + 1e-6, peak.t + TAIL);
  const runUp = between(samples, peak.t - LEAD, peak.t - guard);

  const heldBefore = mean(before) - floor > HOLD * over;
  const heldAfter = mean(after) - floor > HOLD * over;

  /*
   * Raised on both sides is a move under way, and the hit is a bump inside it
   * rather than the point of it. One sound across the whole move, which is
   * the thing a beginner gets wrong by placing three hits inside it.
   *
   * Settled before the climb below, because the front of a move climbs too:
   * a camera starting to swing looks exactly like a run-up until you notice
   * that the energy never comes back down afterwards. What separates them is
   * what happens after the hit, not before it.
   */
  if (heldBefore && heldAfter) {
    return {
      id,
      t: peak.t,
      span: moveSpan(samples, peak.t, floor + HOLD * over),
      kind: 'moves',
      energy: peak.energy,
      strength: 0,
      hits,
    };
  }

  /*
   * A build shows as the curve climbing across the run-up rather than sitting
   * level and then jumping.
   *
   * Thirds rather than every step, because motion energy is noisy enough that
   * a strictly rising run almost never happens, and a measurement that almost
   * never fires is worse than no measurement.
   *
   * Judged against the run-up itself rather than against the height of the
   * hit at the end of it. A build that arrives at a hard cut has a run-up
   * many times smaller than the cut, so asking the climb to be a share of the
   * cut throws away exactly the case this is for: measured that way, a real
   * eight hundred millisecond build into a title card came out as a plain
   * cut, because the cut was six times the size of everything leading to it.
   */
  const early = mean(runUp.slice(0, Math.floor(runUp.length / 3)));
  const middle = mean(runUp.slice(Math.floor(runUp.length / 3), Math.floor((runUp.length * 2) / 3)));
  const late = mean(runUp.slice(Math.floor((runUp.length * 2) / 3)));
  const climbs =
    runUp.length >= 3 &&
    late - floor > AWAKE * over &&
    late - floor > (early - floor) * RISE &&
    middle >= early;

  if (climbs) {
    return { id, t: peak.t, span: 0, kind: 'builds', energy: peak.energy, strength: 0, hits };
  }

  // Quiet before, raised after, and falling as it goes: something arrived and
  // is still settling. That tail is what the sound has to match.
  const settles =
    heldAfter && mean(after.slice(0, Math.ceil(after.length / 2))) > mean(after.slice(Math.ceil(after.length / 2)));

  if (settles) {
    return { id, t: peak.t, span: 0, kind: 'lands', energy: peak.energy, strength: 0, hits };
  }

  return { id, t: peak.t, span: 0, kind: 'appears', energy: peak.energy, strength: 0, hits };
}

/**
 * How long the raised stretch around a move runs for.
 *
 * Walked outwards from the peak until the curve drops back, so the suggested
 * whoosh is the length of the move rather than a number this file picked.
 */
function moveSpan(samples: readonly MotionSample[], centre: number, level: number): number {
  const at = nearestIndex(samples, centre);
  let from = at;
  let to = at;
  while (from > 0 && samples[from - 1].energy >= level) from -= 1;
  while (to < samples.length - 1 && samples[to + 1].energy >= level) to += 1;
  return Math.max(0, samples[to].t - samples[from].t);
}

/**
 * The stretches where nothing happens.
 *
 * Saying that nothing goes somewhere is a suggestion in its own right, and it
 * is the one nobody new to this believes. Left out, a long quiet passage reads
 * as a part of the clip the app failed on rather than as a part of the clip
 * that is supposed to be quiet.
 */
function quietStretches(
  samples: readonly MotionSample[],
  peaks: readonly Peak[],
  duration: number,
  floor: number,
): Moment[] {
  const end = duration || samples[samples.length - 1].t;
  const edges = [0, ...peaks.map((p) => p.t), end];
  const out: Moment[] = [];

  for (let i = 0; i < edges.length - 1; i++) {
    const from = edges[i];
    const to = edges[i + 1];
    const span = to - from;
    if (span < QUIET_MIN) continue;
    // Measured a little inside each end, so the tail of the hit that opened
    // the gap does not make a genuinely still passage look busy.
    const inside = between(samples, from + 0.25, to - 0.25);
    if (!inside.length || mean(inside) > floor * QUIET_CEILING) continue;
    out.push({
      id: idFor(from),
      t: from,
      span,
      kind: 'quiet',
      energy: mean(inside),
      strength: 0,
      hits: [],
    });
  }

  return out;
}

function idFor(t: number): string {
  return `m${t.toFixed(3)}`;
}

function between(samples: readonly MotionSample[], from: number, to: number): number[] {
  const out: number[] = [];
  for (const sample of samples) {
    if (sample.t >= from && sample.t <= to) out.push(sample.energy);
  }
  return out;
}

function nearestIndex(samples: readonly MotionSample[], t: number): number {
  let best = 0;
  let closest = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const away = Math.abs(samples[i].t - t);
    if (away < closest) {
      closest = away;
      best = i;
    }
  }
  return best;
}

/** The usual distance between two measurements, in seconds. */
function spacing(samples: readonly MotionSample[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const gap = samples[i].t - samples[i - 1].t;
    if (gap > 0) gaps.push(gap);
  }
  return gaps.length ? median(gaps) : 0;
}

function mean(values: readonly number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
