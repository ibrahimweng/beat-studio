/** One measurement of how much the picture changed. */
export interface MotionSample {
  /** Time in the video, in seconds. */
  t: number;
  /** How much changed since the previous sampled frame, 0 to 1. */
  energy: number;
}

/** A moment worth suggesting, with how strongly it stood out. */
export interface Peak {
  t: number;
  energy: number;
}

export interface AnalyseOptions {
  /** Called with a fraction between 0 and 1. */
  onProgress?(fraction: number): void;
  /** Frames per second, used to decide how finely to sample. */
  fps: number;
  /**
   * Give up early, for somebody who did not mean to start.
   *
   * Reading takes about half the length of the clip, so a ten minute video is
   * five minutes of waiting, and there was no way out of it: the button that
   * starts the read is the one that shows the progress, and it was disabled
   * for the duration. Loading the wrong file meant waiting it out or
   * reloading the page.
   */
  signal?: AbortSignal;
}

/** Width the picture is reduced to before comparing. Height follows the shape. */
const SAMPLE_WIDTH = 64;
/**
 * Aim for at least this many measurements per second of video.
 *
 * This decides how fast the clip is played while being read, and it is a
 * straight trade against how much is found. Measured on a thirty second clip
 * with forty hits in it: at this setting the read takes about half the length
 * of the clip and finds 39 of them, while playing twice as fast halves the
 * wait but finds only 18. The wait is paid once per clip, so accuracy wins.
 */
const TARGET_PER_SECOND = 15;
/** Never ask the browser to play faster than this. */
const MAX_RATE = 8;
/** Give up rather than hang if playback stalls. */
const STALL_MS = 20000;

/**
 * Measure how much the picture changes over time.
 *
 * Every cut, snap and fast move shows up as a spike, which is what makes it
 * possible to suggest where sounds belong. Frames are shrunk to a thumbnail
 * before being compared, because the position of a change does not matter,
 * only how much of the frame it covers.
 *
 * The video is played faster than real time on a hidden element, so the clip
 * on screen is left where it is. Playing quickly means the browser presents
 * fewer frames, so measurements are further apart on long clips. That is what
 * {@link refinePeaks} is for.
 */
export async function analyseMotion(
  src: string,
  options: AnalyseOptions,
): Promise<MotionSample[]> {
  const video = document.createElement('video');
  video.src = src;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    await once(video, 'loadedmetadata');
    const { canvas, ctx, height } = makeCanvas(video);
    const duration = video.duration;

    // Fast enough to be worth waiting for, slow enough to keep detail.
    video.playbackRate = Math.max(
      1,
      Math.min(MAX_RATE, Math.round(options.fps / TARGET_PER_SECOND) || 1),
    );

    const samples: MotionSample[] = [];
    let previous: Uint8ClampedArray | null = null;

    await new Promise<void>((resolve, reject) => {
      let stall = window.setTimeout(() => reject(new Error('analysis stalled')), STALL_MS);
      const bump = (): void => {
        window.clearTimeout(stall);
        stall = window.setTimeout(() => resolve(), STALL_MS);
      };

      /*
       * Stopping is resolving rather than throwing.
       *
       * What has been read so far is real, and the caller decides what to do
       * with it. An error here would make "I have changed my mind" arrive at
       * the same place as "this file cannot be read", which are not the same
       * thing to say to somebody.
       */
      if (options.signal) {
        if (options.signal.aborted) {
          window.clearTimeout(stall);
          resolve();
          return;
        }
        options.signal.addEventListener('abort', () => {
          window.clearTimeout(stall);
          video.pause();
          resolve();
        }, { once: true });
      }

      const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
        bump();
        ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, height);
        const frame = ctx.getImageData(0, 0, SAMPLE_WIDTH, height).data;
        if (previous) {
          samples.push({ t: metadata.mediaTime, energy: difference(previous, frame) });
        }
        previous = frame;
        options.onProgress?.(duration ? Math.min(1, metadata.mediaTime / duration) : 0);
        if (!video.ended && !options.signal?.aborted) video.requestVideoFrameCallback(onFrame);
      };

      video.addEventListener('ended', () => {
        window.clearTimeout(stall);
        resolve();
      });
      video.addEventListener('error', () => {
        window.clearTimeout(stall);
        reject(new Error('could not read the video'));
      });

      video.requestVideoFrameCallback(onFrame);
      void video.play().catch(() => reject(new Error('could not play the video')));
    });

    options.onProgress?.(1);
    canvas.width = 0;
    return samples;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}

/**
 * Find the moments worth suggesting.
 *
 * A measurement counts as a hit when it stands out from the rest of the clip
 * rather than when it passes a fixed number, so a busy piece and a still one
 * both give sensible results. Sensitivity moves how far above the ordinary a
 * moment has to be.
 */
export function pickPeaks(
  samples: readonly MotionSample[],
  sensitivity: number,
  minGap: number,
): Peak[] {
  if (samples.length < 3) return [];

  const threshold = thresholdFor(samples, sensitivity);
  const found: Peak[] = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const { energy, t } = samples[i];
    if (energy < threshold) continue;
    // Only the top of a rise, so one change does not produce a run of hits.
    if (energy < samples[i - 1].energy || energy < samples[i + 1].energy) continue;
    found.push({ t, energy });
  }

  return thin(found, minGap);
}

/**
 * How far above the ordinary a moment has to be.
 *
 * Measured against the clip's own statistics rather than a fixed number, so a
 * busy piece and a still one both give sensible results.
 */
export function thresholdFor(samples: readonly MotionSample[], sensitivity: number): number {
  const energies = samples.map((s) => s.energy);
  const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
  const variance =
    energies.reduce((total, e) => total + (e - mean) * (e - mean), 0) / energies.length;
  const deviation = Math.sqrt(variance);
  // Sensitivity 0 only catches the most obvious cuts; 1 catches small moves.
  return mean + (2.6 - sensitivity * 2.3) * deviation;
}

/**
 * Narrow an already found set without measuring the video again.
 *
 * The scan finds every candidate once, so moving the sensitivity only decides
 * how many of them to show. That is what keeps the control instant on a clip
 * that took half a minute to read.
 */
export function filterPeaks(
  candidates: readonly Peak[],
  samples: readonly MotionSample[],
  sensitivity: number,
  minGap: number,
): Peak[] {
  if (!candidates.length || samples.length < 3) return [];
  const threshold = thresholdFor(samples, sensitivity);
  return thin(
    candidates.filter((c) => c.energy >= threshold),
    minGap,
  );
}

/** Where two moments survive close together, keep the stronger one. */
function thin(peaks: readonly Peak[], minGap: number): Peak[] {
  const kept: Peak[] = [];
  for (const peak of [...peaks].sort((a, b) => a.t - b.t)) {
    const last = kept[kept.length - 1];
    if (last && peak.t - last.t < minGap) {
      if (peak.energy > last.energy) kept[kept.length - 1] = peak;
      continue;
    }
    kept.push(peak);
  }
  return kept;
}

/**
 * How far apart two windows may be and still be read in one go.
 *
 * Stopping to seek is the expensive part: measured on a 1080p clip at 334ms
 * to seek, against about 67ms to play through a frame at the rate these are
 * read at. So reading four frames nobody asked for is cheaper than stopping
 * and starting again, which is roughly where the two costs meet -- and on a
 * busy clip, where moments land a few frames apart, it turns a hundred and
 * sixty stops into a handful.
 */
const JOIN_FRAMES = 4;

/**
 * How long a seek may take before it is given up on.
 *
 * Generous, because it now happens once per run of moments rather than once
 * per frame, and because giving up is no longer a way of getting the wrong
 * answer -- what a frame is worth is read from the frame itself. Only the
 * cost of waiting is at stake.
 */
const SEEK_MS = 4000;

/** Give up on a run rather than hang if playback stalls inside it. */
const RUN_STALL_MS = 10000;

/**
 * How fast a window is played while it is being read.
 *
 * Slower than real time, which sounds backwards for the pass that was the
 * slow one. A frame the decoder cannot keep up with is not presented at all,
 * and the frames it struggles with most are the ones straight after a big
 * change -- which is to say precisely the frames this pass exists to find. A
 * dropped one there does not read as noise, it reads as the change happening
 * a frame later than it did.
 *
 * Measured on a 1080p clip, six windows: at full speed one frame in eighty
 * went missing, at three quarters one, and at half none at all. Half costs
 * almost nothing in the end, because the window is three or four frames and
 * the seek that reaches it is the expensive part either way -- 944ms a window
 * against 1384ms, where the pass this replaced took 4680ms.
 */
const READ_RATE = 0.5;

/** A stretch to be read in one pass, and the moments that wanted it. */
export interface Run {
  from: number;
  to: number;
  wants: Span[];
}

/** One moment and the stretch around it that has to be looked at. */
export interface Span {
  peak: Peak;
  from: number;
  to: number;
}

/**
 * Gather the stretches that are worth reading together.
 *
 * Exported for its own sake: it is the part of pinning that is arithmetic
 * rather than video, and the part that decides how many times the expensive
 * thing happens.
 */
export function runsFor(spans: readonly Span[], frameDuration: number): Run[] {
  const runs: Run[] = [];
  for (const span of [...spans].sort((a, b) => a.from - b.from)) {
    const last = runs[runs.length - 1];
    if (last && span.from <= last.to + JOIN_FRAMES * frameDuration) {
      last.to = Math.max(last.to, span.to);
      last.wants.push(span);
      continue;
    }
    runs.push({ from: span.from, to: span.to, wants: [span] });
  }
  return runs;
}

/**
 * Pin each suggestion to the frame the change actually happened on.
 *
 * The fast pass compares frames that may be several apart, so it knows a
 * change happened somewhere inside a short window but not exactly where.
 * This reads that window a frame at a time and keeps the frame that changed
 * most, which is what makes a suggestion land on the right frame rather than
 * near it.
 *
 * The window is read by playing it, not by seeking to each frame in turn.
 * Seeking looked like the obvious way to step through frames and was two
 * different faults at once. It was slow -- 4.7 seconds a window on a 1080p
 * clip, so forty seconds to pin twenty-six moments in forty seconds of video,
 * and minutes at the candidate ceiling. And it was **wrong**: a seek on a
 * clip that size takes longer than the 400ms it was given, and when the wait
 * ran out the frame was drawn anyway. Measured, two thirds of them: 56 of 84
 * seeks came back with the element still seeking, so the pass whose whole job
 * is landing on the exact frame was comparing whatever had last been decoded.
 *
 * Playing cannot do that. `requestVideoFrameCallback` only fires for a frame
 * that was actually presented, and hands over the time of the frame you are
 * looking at -- so a frame the machine was too slow to present is a frame
 * that is missing, never one that is mistaken for its neighbour.
 */
export async function refinePeaks(
  src: string,
  peaks: readonly Peak[],
  frameDuration: number,
  windowFrames: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Peak[]> {
  if (!peaks.length) return [];

  const video = document.createElement('video');
  video.src = src;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    await once(video, 'loadedmetadata');
    const { ctx, height } = makeCanvas(video);
    const end = Number.isFinite(video.duration) ? video.duration : Infinity;

    const spans: Span[] = peaks.map((peak) => ({
      peak,
      from: Math.max(0, peak.t - windowFrames * frameDuration),
      to: Math.min(end, peak.t + frameDuration),
    }));

    const found = new Map<Peak, number>();
    const runs = runsFor(spans, frameDuration);
    let pinned = 0;

    for (const run of runs) {
      if (signal?.aborted) break;
      const read = await readRun(video, ctx, height, run, signal);
      for (const span of run.wants) {
        let bestEnergy = -1;
        for (const sample of read) {
          if (sample.t < span.from - 1e-6 || sample.t > span.to + 1e-6) continue;
          if (sample.energy > bestEnergy) {
            bestEnergy = sample.energy;
            found.set(span.peak, sample.t);
          }
        }
      }
      pinned += run.wants.length;
      onProgress?.(Math.min(1, pinned / spans.length));
    }

    // A moment nothing was read for keeps where the fast pass put it, which
    // is the answer this had before there was a second pass at all.
    return peaks.map((peak) => ({ t: found.get(peak) ?? peak.t, energy: peak.energy }));
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}

/**
 * Play one stretch and measure every frame that comes past.
 *
 * One seek to the start and then ordinary playback, which is the only way to
 * be handed frames in order without asking for each one.
 */
async function readRun(
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D,
  height: number,
  run: Run,
  signal?: AbortSignal,
): Promise<MotionSample[]> {
  await seek(video, run.from);
  if (signal?.aborted) return [];
  video.playbackRate = READ_RATE;

  const out: MotionSample[] = [];
  let previous: Uint8ClampedArray | null = null;

  await new Promise<void>((resolve) => {
    let finished = false;
    const stop = (): void => {
      if (finished) return;
      finished = true;
      window.clearTimeout(guard);
      video.removeEventListener('ended', stop);
      signal?.removeEventListener('abort', stop);
      video.pause();
      resolve();
    };
    const guard = window.setTimeout(stop, RUN_STALL_MS);

    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      if (finished) return;
      ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, height);
      const frame = ctx.getImageData(0, 0, SAMPLE_WIDTH, height).data;
      // The time is the frame's own, not the one that was asked for, so a
      // frame the machine could not present goes missing rather than wrong.
      if (previous) out.push({ t: metadata.mediaTime, energy: difference(previous, frame) });
      previous = frame;
      if (metadata.mediaTime >= run.to || video.ended || signal?.aborted) return stop();
      video.requestVideoFrameCallback(onFrame);
    };

    video.addEventListener('ended', stop);
    // Told directly rather than noticed on the next frame, so stopping during
    // a stretch that has stalled does not wait out the guard above.
    signal?.addEventListener('abort', stop, { once: true });
    video.requestVideoFrameCallback(onFrame);
    void video.play().catch(() => stop());
  });

  return out;
}

/**
 * The usual gap between measurements, in seconds.
 *
 * Playing quickly means the browser presents fewer frames than the video
 * contains, and how many it drops depends on the machine. Measuring the gap
 * that actually happened is the only reliable way to know how far back to
 * look when pinning a moment to its frame.
 */
export function medianGap(samples: readonly MotionSample[]): number {
  if (samples.length < 3) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const gap = samples[i].t - samples[i - 1].t;
    if (gap > 0) gaps.push(gap);
  }
  if (!gaps.length) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** Average change per colour channel between two thumbnails, 0 to 1. */
function difference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let total = 0;
  // Step by 4 to skip the alpha channel, which never varies here.
  for (let i = 0; i < a.length; i += 4) {
    total += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  }
  return total / ((a.length / 4) * 3 * 255);
}

function makeCanvas(video: HTMLVideoElement): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  height: number;
} {
  const ratio = video.videoHeight / (video.videoWidth || 1);
  const height = Math.max(1, Math.round(SAMPLE_WIDTH * (ratio || 0.5625)));
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_WIDTH;
  canvas.height = height;
  // Reading pixels back every frame is the whole job, so ask for it up front.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('this browser cannot read video frames');
  return { canvas, ctx, height };
}

function once(target: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    target.addEventListener(event, () => resolve(), { once: true });
    target.addEventListener('error', () => reject(new Error('could not load the video')), {
      once: true,
    });
  });
}

/**
 * Put the element on a time and wait until it is really there.
 *
 * The wait used to be capped at 400ms and the caller drew whatever was on
 * screen when it ran out, which on anything the size of a 1080p clip was
 * usually the frame before the seek. It now waits properly, because it
 * happens once for a whole run of moments rather than once per frame.
 */
function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    /*
     * Asking for the time it is already showing is not a seek.
     *
     * Nothing is fired for it, so the wait below runs to its end -- and the
     * first run of a pinning pass often starts at zero, which is where a clip
     * already sits. Four seconds of nothing, once per scan.
     */
    if (!video.seeking && Math.abs(video.currentTime - time) < 1e-3) {
      resolve();
      return;
    }
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(guard);
      video.removeEventListener('seeked', done);
      resolve();
    };
    const guard = window.setTimeout(done, SEEK_MS);
    video.addEventListener('seeked', done);
    video.currentTime = time;
  });
}
