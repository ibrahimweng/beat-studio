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
 * Pin each suggestion to the frame the change actually happened on.
 *
 * The fast pass compares frames that may be several apart, so it knows a
 * change happened somewhere inside a short window but not exactly where.
 * This steps through that window one frame at a time and keeps the frame that
 * changed most, which is what makes a suggestion land on the right frame
 * rather than near it.
 */
export async function refinePeaks(
  src: string,
  peaks: readonly Peak[],
  frameDuration: number,
  window: number,
  onProgress?: (fraction: number) => void,
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
    const refined: Peak[] = [];

    for (let i = 0; i < peaks.length; i++) {
      const centre = peaks[i].t;
      const from = Math.max(0, centre - window * frameDuration);
      const to = Math.min(video.duration, centre + frameDuration);

      let previous: Uint8ClampedArray | null = null;
      let bestTime = centre;
      let bestEnergy = -1;

      for (let t = from; t <= to + 1e-6; t += frameDuration) {
        await seek(video, t);
        ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, height);
        const frame = ctx.getImageData(0, 0, SAMPLE_WIDTH, height).data;
        if (previous) {
          const energy = difference(previous, frame);
          if (energy > bestEnergy) {
            bestEnergy = energy;
            bestTime = t;
          }
        }
        previous = frame;
      }

      refined.push({ t: bestTime, energy: peaks[i].energy });
      onProgress?.((i + 1) / peaks.length);
    }

    return refined;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
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

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => resolve();
    video.addEventListener('seeked', done, { once: true });
    video.currentTime = time;
    // A seek to a position already shown may not fire the event.
    window.setTimeout(done, 400);
  });
}
