import { LANES } from '../constants.ts';
import type { Lane, Metro, Pattern } from '../types.ts';
import type { AudioEngine } from './engine.ts';

/** How often the scheduler wakes up, in milliseconds. */
const TICK_MS = 25;
/** How far ahead of the clock notes are scheduled, in seconds. */
const LOOKAHEAD = 0.14;
/** Delay before the first step, giving the graph time to settle. */
const START_OFFSET = 0.09;

/** Live readings the transport needs on every tick. */
export interface TransportHooks {
  bpm(): number;
  steps(): number;
  pattern(): Pattern;
  metro(): Metro;
  /** A lane fired. Called at schedule time, with the audio time it will sound. */
  onLaneHit(lane: Lane, time: number): void;
  /** Move the playhead. Called at schedule time; use {@link Transport.atTime}. */
  onStep(step: number, time: number): void;
  /** The pattern wrapped. `count` counts loops since the transport started. */
  onLoop(count: number, time: number): void;
}

/**
 * The step clock.
 *
 * Web Audio events must be scheduled ahead of time to be sample-accurate, but
 * a timer that fires exactly on the beat drifts. The standard fix, used here,
 * is a coarse `setInterval` that runs ahead of the audio clock and queues every
 * step falling inside the next {@link LOOKAHEAD} seconds. Audio is therefore
 * always early and always exact; only the UI is aligned to wall-clock time,
 * via {@link atTime}.
 */
export class Transport {
  #engine: AudioEngine;
  #hooks: TransportHooks;
  #timer: ReturnType<typeof setInterval> | null = null;
  #nextTime = 0;
  #stepIndex = 0;
  #loopCount = 0;
  /** Steps still to pass before events resume being reported (count-in). */
  #muteSteps = 0;

  constructor(engine: AudioEngine, hooks: TransportHooks) {
    this.#engine = engine;
    this.#hooks = hooks;
  }

  get running(): boolean {
    return this.#timer !== null;
  }

  /** Seconds per step; a step is a sixteenth note. */
  get stepDuration(): number {
    return 60 / this.#hooks.bpm() / 4;
  }

  start(): void {
    this.#engine.start();
    if (this.#timer) return;
    this.#stepIndex = 0;
    this.#loopCount = 0;
    this.#nextTime = this.#engine.now() + START_OFFSET;
    this.#timer = setInterval(() => this.#schedule(), TICK_MS);
    this.#schedule();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * Click through `bars` bars before returning, so a player has time to come
   * in. Resolves when the count-in finishes; the caller then starts recording.
   */
  countIn(bars = 1): Promise<void> {
    this.#engine.start();
    const beats = bars * 4;
    const beatDur = this.stepDuration * 4;
    const t0 = this.#engine.now() + START_OFFSET;
    for (let i = 0; i < beats; i++) this.#engine.click(t0 + i * beatDur, i % 4 === 0);
    const endsAt = t0 + beats * beatDur;
    return new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, (endsAt - this.#engine.now()) * 1000));
    });
  }

  /** Run `fn` when audio time `t` arrives, for UI that must match the sound. */
  atTime(t: number, fn: () => void): void {
    setTimeout(fn, Math.max(0, (t - this.#engine.now()) * 1000));
  }

  #schedule(): void {
    const stepDur = this.stepDuration;
    const steps = this.#hooks.steps();
    const pattern = this.#hooks.pattern();
    const metro = this.#hooks.metro();
    const now = this.#engine.now();

    while (this.#nextTime < now + LOOKAHEAD) {
      const step = this.#stepIndex % steps;
      const time = this.#nextTime;

      if (step === 0 && this.#stepIndex > 0) {
        this.#loopCount++;
        this.#hooks.onLoop(this.#loopCount, time);
      }

      if (this.#muteSteps > 0) {
        this.#muteSteps--;
      } else {
        for (const lane of LANES) {
          if (pattern[lane.key]?.[step]) {
            this.#engine.drum(lane.pad, time, 0.95);
            this.#hooks.onLaneHit(lane, time);
          }
        }
      }

      if (metro !== 'off' && (metro === 'sixteenth' || step % 4 === 0)) {
        this.#engine.click(time, step === 0);
      }

      this.#hooks.onStep(step, time);
      this.#nextTime += stepDur;
      this.#stepIndex++;
    }
  }
}
