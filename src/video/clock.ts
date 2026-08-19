import type { AudioEngine } from '../audio/engine.ts';
import { scheduleCue } from '../audio/sources.ts';
import { audibleCues, cueStart } from '../timeline/project.ts';
import type { Cue, Project } from '../timeline/types.ts';

/** How often the scheduler wakes up, in milliseconds. */
const TICK_MS = 25;
/** How far past the video's position cues are queued, in seconds. */
const LOOKAHEAD = 0.15;

export interface ClockHooks {
  project(): Project;
  /** Called every tick with the video's position, for the playhead. */
  onTime(time: number): void;
  /** Called when a cue is queued, with the audio time it will sound at. */
  onCue(cue: Cue, at: number): void;
}

/**
 * Plays cues against the video's clock.
 *
 * Web Audio needs events scheduled ahead of time to be exact, but the video
 * decides where we are in the piece. So each tick reads the video's position,
 * works out what audio time that position corresponds to right now, and
 * queues any cue falling inside the next fraction of a second.
 *
 * Recomputing the mapping every tick is what keeps the two clocks together
 * over a long piece. If the video drifts against the audio clock, the next
 * tick simply uses the corrected mapping, and only cues already queued in the
 * last 150 milliseconds are unaffected.
 */
export class VideoClock {
  #video: HTMLVideoElement;
  #engine: AudioEngine;
  #hooks: ClockHooks;
  #timer: ReturnType<typeof setInterval> | null = null;
  /** Cues before this video time have already been queued. */
  #queuedUpTo = 0;

  constructor(video: HTMLVideoElement, engine: AudioEngine, hooks: ClockHooks) {
    this.#video = video;
    this.#engine = engine;
    this.#hooks = hooks;
  }

  get playing(): boolean {
    return this.#timer !== null;
  }

  get time(): number {
    return this.#video.currentTime;
  }

  async play(): Promise<void> {
    this.#engine.start();
    if (this.#timer) return;
    this.#queuedUpTo = this.#video.currentTime;
    try {
      await this.#video.play();
    } catch {
      // Autoplay can be refused before the page has been interacted with.
      return;
    }
    this.#timer = setInterval(() => this.#tick(), TICK_MS);
    this.#tick();
  }

  pause(): void {
    this.#video.pause();
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** Move to a time. Cues are not fired while scrubbing. */
  seek(time: number): void {
    const clamped = Math.max(0, Math.min(this.#video.duration || 0, time));
    this.#video.currentTime = clamped;
    this.#queuedUpTo = clamped;
    this.#hooks.onTime(clamped);
  }

  /** Hear one cue on its own, without moving the playhead. */
  audition(cue: Cue): void {
    const ctx = this.#engine.start();
    const project = this.#hooks.project();
    // Place the timeline origin so this cue sounds now.
    scheduleCue(ctx, this.#engine.cueDestination, project, cue, ctx.currentTime + 0.02 - cueStart(cue));
  }

  #tick(): void {
    const video = this.#video;
    if (video.ended) {
      this.pause();
      this.#hooks.onTime(video.duration);
      return;
    }

    const videoNow = video.currentTime;
    this.#hooks.onTime(videoNow);

    const ctx = this.#engine.context;
    if (!ctx) return;

    // Where audio time zero of the timeline sits, as of this instant.
    const origin = ctx.currentTime - videoNow;
    const until = videoNow + LOOKAHEAD;

    // A seek backwards leaves the marker ahead of us; catch it up.
    if (this.#queuedUpTo > videoNow + 0.5) this.#queuedUpTo = videoNow;

    const project = this.#hooks.project();
    for (const cue of audibleCues(project)) {
      const start = cueStart(cue);
      if (start < this.#queuedUpTo || start >= until) continue;
      scheduleCue(ctx, this.#engine.cueDestination, project, cue, origin);
      this.#hooks.onCue(cue, origin + start);
    }

    this.#queuedUpTo = Math.max(this.#queuedUpTo, until);
  }
}
