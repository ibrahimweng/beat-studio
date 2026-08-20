import { BPM_MAX, BPM_MIN } from './constants.ts';
import { freshBanks } from './pattern.ts';
import { emptyProject } from './timeline/project.ts';
import type { CueSource, Project } from './timeline/types.ts';
import type { MotionSample, Peak } from './video/analyse.ts';
import type { BankKey, Banks, Dock, Metro, Take, View } from './types.ts';

/**
 * Which half of the app is showing.
 *
 * "score" is the Sound design screen: the timeline, for placing sounds
 * against a video. It is where the app opens. "play" is the instrument, for
 * working out ideas before they go on the timeline.
 */
export type Mode = 'play' | 'score';

export interface AppState {
  mode: Mode;
  /** Instrument shown on the main stage. */
  view: View;
  /** Panel shown in the bottom dock. */
  dock: Dock;
  /** Transport is running. */
  playing: boolean;
  /** A take is being captured. */
  recording: boolean;
  /** The audio engine has been started by a user gesture. */
  ready: boolean;
  bpm: number;
  steps: 16 | 32;
  metro: Metro;
  /** Play a bar of clicks before a recording starts capturing. */
  countIn: boolean;
  /** Hold notes until re-triggered instead of releasing on key-up. */
  sustain: boolean;
  /** Bars to record before auto-stopping; 0 means keep going. */
  loops: number;
  /** Octave number of the lowest computer-keyboard row. */
  octave: number;
  bank: BankKey;
  banks: Banks;
  takes: Take[];
  /** Transient message for the dock status line; null shows the default. */
  status: string | null;
  /** Label for the engine row in the inspector. */
  engineName: string;

  // ---------- sound design ----------
  /** The cue list, layers and timing settings for the loaded video. */
  project: Project;
  /** A video file has been loaded and can be played. */
  videoReady: boolean;
  /** The cue being edited in the inspector. */
  selectedCueId: string | null;
  /** The sound that clicking the timeline will place. */
  currentSource: CueSource;
  /** The layer new cues are placed on. */
  activeLayerId: string;
  /** Playing an instrument drops a cue at the playhead. */
  armed: boolean;
  /** Progress message while exporting, or null when idle. */
  exporting: string | null;
  /** Suggested hits read from the video. */
  detect: Detection;
}

/**
 * The state of reading hits out of the video.
 *
 * The clip is measured once. After that, moving the sensitivity only decides
 * how many of the candidates to show, so the control stays instant on a long
 * piece that took a while to read.
 */
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
}

export function emptyDetection(): Detection {
  return { status: 'idle', progress: 0, samples: [], candidates: [], peaks: [], sensitivity: 0.5 };
}

export function initialState(): AppState {
  return {
    view: 'drums',
    dock: 'seq',
    playing: false,
    recording: false,
    ready: false,
    bpm: 92,
    steps: 16,
    metro: 'beat',
    countIn: false,
    sustain: false,
    loops: 2,
    octave: 4,
    bank: 'A',
    banks: freshBanks(),
    takes: [],
    status: null,
    engineName: 'standby',

    // The app opens on Sound design, because scoring a video is what most
    // people come here to do. The instruments are one click away on the rail.
    mode: 'score',
    project: emptyProject(),
    videoReady: false,
    selectedCueId: null,
    currentSource: { kind: 'design', name: 'impact' },
    activeLayerId: 'impacts',
    armed: false,
    exporting: null,
    detect: emptyDetection(),
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

/** Clamp a tempo into the range the transport supports. */
export function clampBpm(value: number): number {
  return Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(value)));
}
