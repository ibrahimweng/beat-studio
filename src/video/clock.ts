import type { AudioEngine } from '../audio/engine.ts';
import {
  releaseBus,
  scheduleCue,
  scheduleLayerLanes,
  syncLayerBuses,
  type LayerBus,
} from '../audio/sources.ts';
import { audibleCues, cueStart, layerLevelAt } from '../timeline/project.ts';
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
  /**
   * Called when the transport starts or stops, and only when it changes.
   *
   * The playhead running is not otherwise something anything outside here can
   * find out about without asking, and it has to be published rather than
   * asked for: the clock stops itself at the end of the piece, so nothing
   * else is in a position to know it happened.
   */
  onPlaying(playing: boolean): void;
}

/**
 * Plays cues against the video's clock, and past the end of it.
 *
 * Web Audio needs events scheduled ahead of time to be exact, but the video
 * decides where we are in the piece. So each tick reads the position, works
 * out what audio time that position corresponds to right now, and queues any
 * cue falling inside the next fraction of a second.
 *
 * Recomputing the mapping every tick is what keeps the two clocks together
 * over a long piece. If the video drifts against the audio clock, the next
 * tick simply uses the corrected mapping, and only cues already queued in the
 * last 150 milliseconds are unaffected.
 *
 * The piece and the clip are not the same length. Since the length can be set
 * by hand there may be work past the last frame — a tail that runs on after
 * the picture cuts is the ordinary case — and there may be less piece than
 * clip, when somebody is scoring the first thirty seconds of something long.
 * So this keeps a position of its own rather than reading the video's:
 *
 * - inside the clip, that position is the video's, exactly as before
 * - past it, the picture holds on its last frame and the position comes from
 *   the audio clock, which is the clock every sound is already scheduled
 *   against and therefore the one worth following when the picture is gone
 *
 * Either way it stops at the end of the piece rather than the end of the
 * file.
 */
export class VideoClock {
  #video: HTMLVideoElement;
  #engine: AudioEngine;
  #hooks: ClockHooks;
  #timer: ReturnType<typeof setInterval> | null = null;
  /** Cues before this timeline time have already been queued. */
  #queuedUpTo = 0;
  /** The nodes for each layer with something drawn on it, rebuilt on play. */
  #buses = new Map<string, LayerBus>();
  /**
   * Where the playhead is once it is past the end of the clip, or null while
   * it is still on it.
   *
   * While playing this is an anchor rather than the answer: the position is
   * this plus however much audio time has passed since {@link #beyondCtx}.
   * Taken from an anchor rather than added up tick by tick, so a long tail
   * does not accumulate a tick's worth of rounding a hundred times over.
   */
  #beyondAt: number | null = null;
  /** The audio time {@link #beyondAt} was true at. */
  #beyondCtx = 0;

  constructor(video: HTMLVideoElement, engine: AudioEngine, hooks: ClockHooks) {
    this.#video = video;
    this.#engine = engine;
    this.#hooks = hooks;
  }

  get playing(): boolean {
    return this.#timer !== null;
  }

  get time(): number {
    if (this.#beyondAt === null) return this.#video.currentTime;
    if (!this.playing) return this.#beyondAt;
    const ctx = this.#engine.context;
    return ctx ? this.#beyondAt + (ctx.currentTime - this.#beyondCtx) : this.#beyondAt;
  }

  /** The end of the piece, which is what the playhead runs to. */
  get #end(): number {
    return this.#hooks.project().duration || this.#video.duration || 0;
  }

  /** The end of the picture, which is where it stops being any help. */
  get #picture(): number {
    return this.#video.duration || 0;
  }

  async play(): Promise<void> {
    const ctx = this.#engine.start();
    if (this.#timer) return;

    /*
     * With no clip at all, the audio clock drives from the first frame.
     *
     * Not only past the end of a picture, which is what this position was
     * built for. There is a case with no picture from the start: a piece has
     * had its own length since it became something you can set, so sound can
     * be made without a video and somebody doing that used to press play and
     * get nothing at all -- the button was live, `video.play()` was refused
     * on an element with no source, and the refusal was swallowed as though
     * it were a browser blocking autoplay. Nothing on screen said why.
     */
    if (this.#picture <= 0 && this.#beyondAt === null) this.#beyondAt = 0;

    // Already at the end: start again rather than sitting there doing nothing.
    if (this.time >= this.#end - 1e-3) this.seek(0);
    this.#queuedUpTo = this.time;

    if (this.#beyondAt === null) {
      try {
        await this.#video.play();
      } catch {
        // Autoplay can be refused before the page has been interacted with.
        return;
      }
    } else {
      // No picture to run, so the audio clock is the only thing moving.
      this.#beyondCtx = ctx.currentTime;
    }

    this.#timer = setInterval(() => this.#tick(), TICK_MS);
    this.#hooks.onPlaying(true);
    this.#tick();
  }

  pause(): void {
    // Read the position before the timer goes, since past the video it is
    // worked out from how long play has been running.
    const stoppedAt = this.#beyondAt === null ? null : this.time;
    const was = this.#timer !== null;
    this.#video.pause();
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    if (stoppedAt !== null) this.#beyondAt = stoppedAt;
    if (was) this.#hooks.onPlaying(false);
    for (const bus of this.#buses.values()) releaseBus(bus);
    this.#buses.clear();
  }

  /** Move to a time. Cues are not fired while scrubbing. */
  seek(time: number): void {
    const wanted = Math.max(0, Math.min(this.#end, time));
    const picture = this.#picture;

    if (picture <= 0 || wanted > picture) {
      /*
       * Past the last frame, or with no frames at all.
       *
       * Where there is a picture it holds where it ran out rather than going
       * blank, because the frame it stopped on is the one the tail is still
       * ringing over, and a black stage says "nothing loaded" when something
       * very much is. Where there is no picture there is nothing to hold, and
       * the position is the audio clock's from the start -- the same case
       * arrived at from the other end.
       */
      if (picture > 0) {
        this.#video.currentTime = picture;
        this.#video.pause();
      }
      this.#beyondAt = wanted;
      this.#beyondCtx = this.#engine.context?.currentTime ?? 0;
    } else {
      this.#beyondAt = null;
      this.#video.currentTime = wanted;
      // Coming back onto the picture while running: it was paused when the
      // playhead left it, and has to be told to carry on.
      if (this.playing && this.#video.paused) void this.#video.play().catch(() => {});
    }

    this.#queuedUpTo = wanted;
    this.#hooks.onTime(wanted);
  }

  /** Hear one cue on its own, without moving the playhead. */
  audition(cue: Cue): void {
    const ctx = this.#engine.start();
    const project = this.#hooks.project();
    // Nothing is playing, so there is no layer node carrying a drawn level.
    // Reading it at this sound's own moment is what makes hearing it on its
    // own match hearing it in place.
    const layer = project.layers.find((l) => l.id === cue.layerId);
    const level = layer && layer.auto.level.length ? layerLevelAt(layer, cue.time) : 1;
    // Place the timeline origin so this cue sounds now.
    scheduleCue(
      ctx,
      this.#engine.cueDestination,
      project,
      cue,
      ctx.currentTime + 0.02 - cueStart(cue),
      level,
    );
  }

  #tick(): void {
    const ctx = this.#engine.context;
    if (!ctx) return;
    const project = this.#hooks.project();
    const end = project.duration || this.#video.duration || 0;

    /*
     * The picture has run out but the piece has not.
     *
     * This is the handover, and it happens once: the video is left on its
     * last frame and the position carries on from the audio clock. Anchored
     * to where the picture actually stopped rather than to its stated
     * duration, since a file can end a frame or two short of what it claims
     * and starting the tail from the wrong place would put every sound in it
     * out by that much.
     */
    if (this.#beyondAt === null && this.#video.ended) {
      const stopped = this.#video.currentTime || this.#video.duration || 0;
      if (end > stopped + 1e-3) {
        this.#beyondAt = stopped;
        this.#beyondCtx = ctx.currentTime;
      } else {
        this.pause();
        this.#hooks.onTime(stopped);
        return;
      }
    }

    const now = this.time;

    // The end of the piece stops it, whether or not the picture got there
    // first. A piece shorter than its clip stops with the picture still
    // running, which is the same rule seen from the other side.
    if (now >= end) {
      this.pause();
      // Landed exactly, rather than wherever the last tick happened to fall.
      if (this.#beyondAt !== null) this.#beyondAt = end;
      this.#hooks.onTime(end);
      return;
    }

    this.#hooks.onTime(now);

    // Where audio time zero of the timeline sits, as of this instant.
    const origin = ctx.currentTime - now;
    const until = now + LOOKAHEAD;

    // A seek backwards leaves the marker ahead of us; catch it up.
    if (this.#queuedUpTo > now + 0.5) this.#queuedUpTo = now;

    /*
     * The drawn levels are written against the mapping worked out this tick,
     * and only for the fraction of a second ahead. Writing the whole shape
     * once when play began would let it drift away from the picture over a
     * long piece, which is the same reason the cues themselves are queued a
     * little at a time rather than all at once.
     *
     * The nodes themselves are kept and reused. Sounds queued on an earlier
     * tick are still playing through them.
     */
    syncLayerBuses(ctx, project, this.#engine.cueDestination, this.#buses);
    scheduleLayerLanes(this.#buses, project, origin, now, until);

    for (const cue of audibleCues(project)) {
      const start = cueStart(cue);
      if (start < this.#queuedUpTo || start >= until) continue;
      const bus = this.#buses.get(cue.layerId)?.input ?? this.#engine.cueDestination;
      scheduleCue(ctx, bus, project, cue, origin);
      this.#hooks.onCue(cue, origin + start);
    }

    this.#queuedUpTo = Math.max(this.#queuedUpTo, until);
  }
}
