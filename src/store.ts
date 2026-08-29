import type { Pack, PackSound } from './audio/pack.ts';
import type { Sample } from './audio/samples.ts';
import type { Rebuilt } from './audio/rebuild.ts';
import { emptyProject } from './timeline/project.ts';
import type { CuePreset, CueSource, Project } from './timeline/types.ts';
import type { MotionSample, Peak } from './video/analyse.ts';
import type { Moment } from './video/moments.ts';

export type PanelTab = 'moments' | 'sounds' | 'selected';

export interface AppState {
  /** The audio engine has been started by a user gesture. */
  ready: boolean;
  /** Transient message for the status line; null shows the default. */
  status: string | null;

  /** The cue list, layers and timing settings for the loaded video. */
  project: Project;
  /** A video file has been loaded and can be played. */
  videoReady: boolean;
  /**
   * The sounds being worked on, in the order they were chosen.
   *
   * A list rather than one, because moving four sounds together is the
   * difference between placing forty and placing four and repeating them.
   * Most of the interface still cares only about the case of exactly one.
   */
  selection: string[];
  /** The sound that clicking the timeline will place. */
  currentSource: CueSource;
  /**
   * The settings that sound arrives with, when it was picked from the library.
   *
   * Null means the voice's own, which is what every sound in the app used to
   * be. Kept beside the source rather than folded into it because it is not
   * part of what the sound is made of: the same voice can be placed plain or
   * as any of the library's twenty five versions of it.
   */
  currentPreset: CuePreset | null;
  /** The layer new cues are placed on. */
  activeLayerId: string;
  /** Playing an instrument drops a cue at the playhead. */
  armed: boolean;
  /** Progress message while exporting, or null when idle. */
  exporting: string | null;
  /**
   * Which of the three the right panel is showing.
   *
   * Moments is what a scanned video opens on, because for somebody who has
   * never done this the list of what to do next is the app. Sounds is the
   * library for choosing something yourself, and Selected is the sound
   * currently picked on the timeline.
   */
  panelTab: PanelTab;
  /** Suggested hits read from the video. */
  detect: Detection;
  /** Sound packs that have been loaded, in the order they were added. */
  packs: Pack[];
  /** Sounds saved from the timeline, kept between projects. */
  mine: PackSound[];
  /**
   * Recordings somebody gave the app, kept between projects.
   *
   * The one kind of sound the app does not make itself. See `audio/samples.ts`
   * for why they are held by id rather than carried in a description.
   */
  samples: Sample[];
  /** Sounds read out of a recording, and rebuilt out of the palette. */
  extract: Extraction;
  /**
   * This tab is the one writing the piece down.
   *
   * False when another tab has the app open and claimed the keeping first.
   * Both tabs work; only one writes, because two writing to one place means
   * the last to save quietly wins and the other's work is gone.
   */
  keeping: boolean;
  /**
   * The video floats in its own window rather than sitting on the stage.
   *
   * Only meaningful on the sound design screen, where there is a stage to
   * choose against. On the instrument screens the window is the only way to
   * see the clip, so it opens there whether this is on or not.
   */
  videoWindow: boolean;
}

/**
 * Sounds pulled out of a recording.
 *
 * Kept whole rather than placed straight onto the timeline, because a rebuild
 * is a suggestion: the app offers three ways of making each one and cannot
 * tell you which is right, so somebody has to listen before any of them is
 * worth putting anywhere.
 */
export interface Extraction {
  /** What it is doing, or null when it is not doing anything. */
  busy: string | null;
  /** The name of the file they came out of. */
  from: string | null;
  sounds: Rebuilt[];
}

/**
 * The state of reading hits out of the video.
 *
 * The clip is measured once. After that, moving the sensitivity only decides
 * how many of the candidates to show, so the control stays instant on a long
 * piece that took a while to read.
 */
/** What has been done about a suggested moment. */
export type MomentState = 'placed' | 'skipped';

export interface Detection {
  status: 'idle' | 'scanning' | 'pinning' | 'ready';
  /** 0 to 1 while working. */
  progress: number;
  /** Every measurement taken, used for the strip under the ruler. */
  samples: MotionSample[];
  /** Every moment found, before the sensitivity is applied. */
  candidates: Peak[];
  /** The moments currently shown. */
  peaks: Peak[];
  sensitivity: number;
  /**
   * The moments as things to decide about, rather than as marks on a ruler.
   *
   * Worked out from the samples and the peaks above, so it costs nothing and
   * is redone whenever the sensitivity moves. Held rather than derived at
   * render time because the panel, the strip and the accept-all button all
   * have to be looking at the same list.
   */
  moments: Moment[];
  /**
   * What has been done about each one, by moment id.
   *
   * Kept apart from the moments themselves because the list is rebuilt every
   * time the sensitivity moves and a decision must not be. A moment that
   * survives that keeps its answer; one that does not is gone either way.
   */
  settled: Record<string, MomentState>;
}

export function emptyDetection(): Detection {
  return {
    status: 'idle',
    progress: 0,
    samples: [],
    candidates: [],
    peaks: [],
    sensitivity: 0.5,
    moments: [],
    settled: {},
  };
}

export function initialState(): AppState {
  return {
    ready: false,
    status: null,
    project: emptyProject(),
    videoReady: false,
    selection: [],
    currentSource: { kind: 'design', name: 'impact' },
    currentPreset: null,
    activeLayerId: 'impacts',
    armed: false,
    exporting: null,
    panelTab: 'moments',
    detect: emptyDetection(),
    packs: [],
    mine: [],
    samples: [],
    extract: { busy: null, sounds: [], from: null },
    videoWindow: false,
    keeping: true,
  };
}

export type Listener = (state: AppState, previous: AppState) => void;

/**
 * A minimal observable state container.
 *
 * Updates are shallow-merged and broadcast synchronously. Listeners receive
 * the previous state too, so a view can skip work when the slice it draws is
 * unchanged — the sequencer grid and the 88-key piano are expensive enough
 * that rebuilding them on every tick would be visible.
 */
export class Store {
  #state: AppState;
  #listeners = new Set<Listener>();

  constructor(initial: AppState = initialState()) {
    this.#state = initial;
  }

  get state(): Readonly<AppState> {
    return this.#state;
  }

  set(patch: Partial<AppState>): void {
    const previous = this.#state;
    let changed = false;
    for (const key of Object.keys(patch) as (keyof AppState)[]) {
      if (!Object.is(previous[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.#state = { ...previous, ...patch };
    for (const listener of this.#listeners) listener(this.#state, previous);
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
