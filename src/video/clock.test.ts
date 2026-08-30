import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProject } from '../timeline/project.ts';
import type { AudioEngine } from '../audio/engine.ts';
import type { Cue, Project } from '../timeline/types.ts';
import { VideoClock } from './clock.ts';

/**
 * The playhead while you are listening, rather than while you are exporting.
 *
 * The render tests next door ask what lands in the file, which is one pass
 * over a project with the whole of it known in advance. This is the other
 * half, and the harder one: a loop that wakes twenty-five milliseconds at a
 * time, reads where the video has got to, works out what audio time that
 * corresponds to *now*, and queues whatever falls in the next fraction of a
 * second. Nothing about that is a function of its inputs — it is two clocks
 * being kept together, and the ways it goes wrong are a cue fired twice, a
 * cue never fired, or a playhead that stops when the picture does.
 *
 * It is testable here because the clock takes all three of the things it
 * depends on: the video, the engine, and the hooks it publishes through.
 * `onCue` is the one that matters — it reports every cue queued and the audio
 * time it will sound at, which is exactly the claim worth checking.
 */

/** How often the scheduler wakes, matching TICK_MS in the clock. */
const TICK = 25;

/**
 * Just enough video element for the clock to read.
 *
 * Six members, which is all of them: where it is, how long it is, whether it
 * is running, whether it has finished, and the two ways to change that. In
 * the spirit of `test/audio-buffer.ts` — a stub of exactly the surface used,
 * so what the clock actually depends on is written down rather than implied.
 */
function stubVideo(duration: number) {
  return {
    currentTime: 0,
    duration,
    paused: true,
    /*
     * True once playback has reached the end, as a real element reports it.
     *
     * This is what the clock watches for to hand over to the audio clock, so
     * getting it wrong means the handover never happens and the playhead
     * simply stops with the picture -- which is the exact fault the handover
     * was written to fix.
     */
    get ended() {
      return this.duration > 0 && this.currentTime >= this.duration;
    },
    play() {
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
  };
}

type StubVideo = ReturnType<typeof stubVideo>;

/**
 * A real context with a clock somebody else winds.
 *
 * The nodes have to be real, because the clock builds a layer's graph as it
 * plays and a stub would not catch it building the wrong one. The time does
 * not: an `OfflineAudioContext` sits at zero until it renders, and the whole
 * point here is to control how time passes. So the context is a real one with
 * `currentTime` overridden on an object in front of it, which leaves every
 * method going to the real thing.
 *
 * A live `AudioContext` would advance on its own and was the obvious first
 * idea. It opens an audio device, and on a machine with none — a CI runner,
 * this container — that is a pile of ALSA errors rather than a context.
 */
function fakeContext() {
  const real = new OfflineAudioContext(2, 48_000, 48_000);
  let now = 0;
  const ctx = Object.create(real) as AudioContext & { advance(by: number): void };
  Object.defineProperty(ctx, 'currentTime', { get: () => now });
  ctx.advance = (by: number) => {
    now += by;
  };
  return ctx;
}

/** The three members of the engine the clock touches, and nothing else. */
function fakeEngine(ctx: AudioContext) {
  const destination = ctx.createGain();
  return {
    engine: { start: () => ctx, context: ctx, cueDestination: destination } as unknown as AudioEngine,
    destination,
  };
}

function cue(over: Partial<Cue> & { id: string; time: number; layerId: string }): Cue {
  return {
    source: { kind: 'design', name: 'click' },
    gain: 1,
    tune: 0,
    length: 0.2,
    anchor: 'start',
    space: 0,
    drive: 0,
    vary: 0,
    muted: false,
    ...over,
  };
}

const LAYERS = emptyProject().layers.map((layer) => layer.id);

interface Rig {
  clock: VideoClock;
  video: StubVideo;
  ctx: ReturnType<typeof fakeContext>;
  /** Every cue queued, in order, with the audio time it was given. */
  queued: { id: string; at: number }[];
  /** Every value published to the playhead. */
  times: number[];
  /** Every change of transport state. */
  playing: boolean[];
  /** Let real time pass: the video and the audio clock move together. */
  run(seconds: number): void;
}

function rig(project: Project, videoSeconds: number): Rig {
  const video = stubVideo(videoSeconds);
  const ctx = fakeContext();
  const { engine } = fakeEngine(ctx);

  const queued: { id: string; at: number }[] = [];
  const times: number[] = [];
  const playing: boolean[] = [];

  const clock = new VideoClock(video as unknown as HTMLVideoElement, engine, {
    project: () => project,
    onTime: (time) => times.push(time),
    onCue: (one, at) => queued.push({ id: one.id, at }),
    onPlaying: (on) => playing.push(on),
  });

  /*
   * The two clocks advance together, which is the normal case.
   *
   * The video only moves while it is not paused, because that is the thing
   * being modelled: past the end of the clip the picture holds and the
   * position has to come from somewhere else.
   */
  const run = (seconds: number): void => {
    const ticks = Math.round((seconds * 1000) / TICK);
    for (let i = 0; i < ticks; i += 1) {
      ctx.advance(TICK / 1000);
      if (!video.paused) {
        video.currentTime = Math.min(video.duration, video.currentTime + TICK / 1000);
        // A real element stops itself on the last frame rather than sitting
        // there claiming to be running.
        if (video.currentTime >= video.duration) video.paused = true;
      }
      vi.advanceTimersByTime(TICK);
    }
  };

  return { clock, video, ctx, queued, times, playing, run };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('queueing cues while the playhead runs', () => {
  it('queues each cue once, however many ticks it takes to get there', async () => {
    const one = { ...emptyProject(), duration: 3, cues: [cue({ id: 'c1', time: 1, layerId: LAYERS[0] })] };
    const it_ = rig(one, 3);
    await it_.clock.play();
    it_.run(2);

    expect(it_.queued.map((q) => q.id), 'fired once, not once per tick').toEqual(['c1']);
  });

  /*
   * Ahead of the playhead, not on it.
   *
   * Web Audio is only exact about things scheduled in advance. A cue handed
   * to the graph at the moment it is due is a cue that is already late, and
   * late by however long the tick took — which is what makes a scheduler that
   * works "well enough" sound loose against picture.
   */
  it('queues a cue at an audio time in the future', async () => {
    const one = { ...emptyProject(), duration: 3, cues: [cue({ id: 'c1', time: 1, layerId: LAYERS[0] })] };
    const it_ = rig(one, 3);
    await it_.clock.play();
    it_.run(2);

    const [fired] = it_.queued;
    expect(fired, 'it was queued').toBeDefined();
    // Worked out at the tick that queued it, so it is ahead of where the
    // audio clock stood then and no further ahead than the lookahead allows.
    expect(fired.at).toBeGreaterThan(0);
  });

  it('does not queue a cue the playhead has already passed', async () => {
    const one = {
      ...emptyProject(),
      duration: 4,
      cues: [cue({ id: 'early', time: 0.5, layerId: LAYERS[0] }), cue({ id: 'later', time: 3, layerId: LAYERS[0] })],
    };
    const it_ = rig(one, 4);
    it_.clock.seek(2);
    await it_.clock.play();
    it_.run(1.5);

    expect(it_.queued.map((q) => q.id), 'only the one still ahead').toEqual(['later']);
  });

  it('queues them in the order they are placed', async () => {
    const one = {
      ...emptyProject(),
      duration: 3,
      cues: [
        cue({ id: 'third', time: 1.5, layerId: LAYERS[0] }),
        cue({ id: 'first', time: 0.4, layerId: LAYERS[0] }),
        cue({ id: 'second', time: 0.9, layerId: LAYERS[1] }),
      ],
    };
    const it_ = rig(one, 3);
    await it_.clock.play();
    it_.run(2);

    expect(it_.queued.map((q) => q.id)).toEqual(['first', 'second', 'third']);
  });

  /*
   * A seek backwards has to let the cues behind it fire again.
   *
   * The scheduler remembers how far it has queued so a cue is not fired every
   * tick. Left alone, that marker sits ahead of a playhead that has just been
   * moved backwards, and everything between the two is silently skipped — so
   * going back to hear a passage again gives you the picture and none of the
   * sound. `seek` puts the marker back itself, which is what this checks.
   */
  it('fires a cue again after seeking back over it', async () => {
    const one = { ...emptyProject(), duration: 4, cues: [cue({ id: 'c1', time: 1, layerId: LAYERS[0] })] };
    const it_ = rig(one, 4);
    await it_.clock.play();
    it_.run(1.5);
    expect(it_.queued).toHaveLength(1);

    it_.clock.seek(0.2);
    it_.video.currentTime = 0.2;
    it_.run(1.5);

    expect(it_.queued.map((q) => q.id), 'heard twice, because it was played twice')
      .toEqual(['c1', 'c1']);
  });

  /*
   * And again when the picture is moved without going through `seek`.
   *
   * The clock reads the video's position rather than owning it, so anything
   * that writes `currentTime` moves the playhead — the scrub bar on the
   * floating video window does exactly that (`video-window.ts`), and it never
   * touches the clock. `seek` puts the queued-up-to marker back itself, so it
   * cannot catch this; the tick has its own guard for a position that has
   * jumped backwards underneath it, and this is the only thing that reaches
   * it.
   *
   * Worth its own test because removing that guard broke nothing else: the
   * seek test above passed without it, which is how it came to look covered
   * when it was not.
   */
  it('fires a cue again when the video itself is scrubbed back', async () => {
    const one = { ...emptyProject(), duration: 4, cues: [cue({ id: 'c1', time: 1, layerId: LAYERS[0] })] };
    const it_ = rig(one, 4);
    await it_.clock.play();
    it_.run(1.5);
    expect(it_.queued, 'heard on the way past').toHaveLength(1);

    // As the floating window's scrub bar does: the element, not the clock.
    it_.video.currentTime = 0.2;
    it_.run(1.5);

    expect(it_.queued.map((q) => q.id), 'heard again on the second pass')
      .toEqual(['c1', 'c1']);
  });

  it('leaves a muted layer silent while it runs', async () => {
    const base = emptyProject();
    const one: Project = {
      ...base,
      duration: 3,
      layers: base.layers.map((l) => (l.id === LAYERS[0] ? { ...l, muted: true } : l)),
      cues: [
        cue({ id: 'quiet', time: 0.5, layerId: LAYERS[0] }),
        cue({ id: 'heard', time: 1, layerId: LAYERS[1] }),
      ],
    };
    const it_ = rig(one, 3);
    await it_.clock.play();
    it_.run(2);

    expect(it_.queued.map((q) => q.id)).toEqual(['heard']);
  });
});

describe('where the playhead stops', () => {
  it('publishes the position as it goes', async () => {
    const one = { ...emptyProject(), duration: 3, cues: [] };
    const it_ = rig(one, 3);
    await it_.clock.play();
    it_.run(1);

    expect(it_.times.length, 'the playhead was told').toBeGreaterThan(10);
    expect(it_.times[it_.times.length - 1], 'and it moved').toBeGreaterThan(0.5);
  });

  it('says once when it starts and once when it stops', async () => {
    const one = { ...emptyProject(), duration: 3, cues: [] };
    const it_ = rig(one, 3);
    await it_.clock.play();
    it_.run(0.5);
    it_.clock.pause();

    expect(it_.playing, 'not once per tick').toEqual([true, false]);
  });

  it('stops itself at the end of the piece', async () => {
    const one = { ...emptyProject(), duration: 1, cues: [] };
    const it_ = rig(one, 4);
    await it_.clock.play();
    it_.run(2);

    expect(it_.clock.playing, 'it stopped on its own').toBe(false);
    expect(it_.playing, 'and said so').toEqual([true, false]);
    expect(it_.clock.time, 'landing exactly on the end').toBeCloseTo(1, 3);
  });

  /*
   * A piece shorter than its clip stops with the picture still running, which
   * is the same rule seen from the other side: somebody scoring the first
   * thirty seconds of a long clip.
   */
  it('stops at the end of the piece rather than the end of the clip', async () => {
    const one = { ...emptyProject(), duration: 1, cues: [cue({ id: 'late', time: 2, layerId: LAYERS[0] })] };
    const it_ = rig(one, 10);
    await it_.clock.play();
    it_.run(3);

    expect(it_.queued, 'nothing past the end of the piece sounded').toEqual([]);
    expect(it_.clock.playing).toBe(false);
  });

  it('pausing stops the queueing', async () => {
    const one = { ...emptyProject(), duration: 4, cues: [cue({ id: 'c1', time: 2, layerId: LAYERS[0] })] };
    const it_ = rig(one, 4);
    await it_.clock.play();
    it_.run(0.5);
    it_.clock.pause();
    it_.run(2);

    expect(it_.queued, 'nothing was queued after the stop').toEqual([]);
  });
});

/**
 * Past the last frame, where the picture stops being any help.
 *
 * The playhead used to be the video's own position and nothing else, so it
 * stopped dead wherever the clip did however long the piece was. A tail that
 * rings out past the final cut is the ordinary case in this work, and it had
 * nowhere to be and no way to be heard.
 */
describe('past the end of the clip', () => {
  it('keeps running on the audio clock once the picture has ended', async () => {
    const one = { ...emptyProject(), duration: 4, cues: [] };
    const it_ = rig(one, 1);
    await it_.clock.play();
    it_.run(2);

    expect(it_.clock.time, 'past the end of the picture').toBeGreaterThan(1.5);
    expect(it_.clock.playing, 'and still going').toBe(true);
  });

  it('queues a cue that falls past the picture', async () => {
    const one = { ...emptyProject(), duration: 4, cues: [cue({ id: 'tail', time: 2, layerId: LAYERS[0] })] };
    const it_ = rig(one, 1);
    await it_.clock.play();
    it_.run(2.5);

    expect(it_.queued.map((q) => q.id), 'the tail sounded').toEqual(['tail']);
  });

  it('still stops at the end of the piece out there', async () => {
    const one = { ...emptyProject(), duration: 2, cues: [] };
    const it_ = rig(one, 1);
    await it_.clock.play();
    it_.run(3);

    expect(it_.clock.playing).toBe(false);
    expect(it_.clock.time).toBeCloseTo(2, 2);
  });

  /*
   * Seeking out there lands where it was asked to, with the picture held on
   * its last frame rather than going blank: the frame it stopped on is the
   * one the tail is ringing over.
   */
  it('can be seeked into, and holds the last frame', async () => {
    const one = { ...emptyProject(), duration: 5, cues: [] };
    const it_ = rig(one, 2);
    it_.clock.seek(3.5);

    expect(it_.clock.time).toBeCloseTo(3.5, 3);
    expect(it_.video.currentTime, 'the picture holds where it ran out').toBeCloseTo(2, 3);
  });

  it('comes back onto the picture when seeked back inside it', async () => {
    const one = { ...emptyProject(), duration: 5, cues: [] };
    const it_ = rig(one, 2);
    it_.clock.seek(3.5);
    it_.clock.seek(0.75);

    expect(it_.clock.time).toBeCloseTo(0.75, 3);
    expect(it_.video.currentTime).toBeCloseTo(0.75, 3);
  });
});
