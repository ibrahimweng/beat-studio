import { COMMON_FPS, DEFAULT_FPS } from '../timeline/project.ts';

export interface LoadedVideo {
  url: string;
  name: string;
  duration: number;
  width: number;
  height: number;
}

/**
 * Point a video element at a local file.
 *
 * The file is read straight from disk through an object URL. Nothing is
 * uploaded and nothing leaves the machine, which matters when the work is
 * unreleased client material.
 */
export function loadVideoFile(video: HTMLVideoElement, file: File): Promise<LoadedVideo> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);

    const cleanup = (): void => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };

    const onLoaded = (): void => {
      cleanup();
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        URL.revokeObjectURL(url);
        reject(new Error('That file has no readable duration.'));
        return;
      }
      resolve({
        url,
        name: file.name,
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };

    const onError = (): void => {
      cleanup();
      URL.revokeObjectURL(url);
      reject(new Error('This browser cannot play that file.'));
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
    video.src = url;
    video.load();
  });
}

/**
 * Work out the frame rate by watching frames go past.
 *
 * There is no way to ask a video element for its frame rate, so the rate is
 * measured from the gaps between presented frames and then matched to the
 * nearest standard rate. Falls back to a sensible default when the browser
 * cannot report frame timing, and the value can always be set by hand.
 */
export function estimateFps(video: HTMLVideoElement, samples = 24): Promise<number> {
  // Not every browser can report frame timing; older ones get the default.
  if (typeof video.requestVideoFrameCallback !== 'function') {
    return Promise.resolve(DEFAULT_FPS);
  }

  return new Promise((resolve) => {
    const times: number[] = [];
    let handle = 0;
    let finished = false;

    const finish = (): void => {
      if (finished) return;
      finished = true;
      if (handle) video.cancelVideoFrameCallback(handle);
      resolve(fromMediaTimes(times));
    };

    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      times.push(metadata.mediaTime);
      if (times.length >= samples) {
        finish();
        return;
      }
      handle = video.requestVideoFrameCallback(onFrame);
    };

    handle = video.requestVideoFrameCallback(onFrame);
    // Give up rather than hang if playback never starts.
    window.setTimeout(finish, 3000);
  });
}

/** Median gap between frames, matched to the nearest standard rate. */
function fromMediaTimes(times: number[]): number {
  if (times.length < 4) return DEFAULT_FPS;

  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > 0.001 && gap < 0.5) gaps.push(gap);
  }
  if (gaps.length < 3) return DEFAULT_FPS;

  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  const measured = 1 / median;

  let closest: number = DEFAULT_FPS;
  let best = Infinity;
  for (const rate of COMMON_FPS) {
    const diff = Math.abs(rate - measured);
    if (diff < best) {
      best = diff;
      closest = rate;
    }
  }
  // Only trust the match if it is actually close to a standard rate.
  return best <= 2 ? closest : Math.round(measured * 1000) / 1000;
}
