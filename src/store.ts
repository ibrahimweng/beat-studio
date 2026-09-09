import type { Pack, PackSound } from './audio/pack.ts';
import type { Sample } from './audio/samples.ts';
import type { Rebuilt } from './audio/rebuild.ts';
import { emptyProject } from './timeline/project.ts';
import type { CuePreset, CueSource, Project } from './timeline/types.ts';
import type { SeparationNotes } from './audio/separate/types.ts';
import type { MotionSample, Peak } from './video/analyse.ts';
import type { Moment } from './video/moments.ts';

export type PanelTab = 'moments' | 'sounds' | 'selected';

/**
 * Which screen the app is on.
 *
 * There was one for a long while, and a rail with one button on it that went
 * where you already were. Taking a recording apart is the second, and it is a
 * screen rather than a panel because what it needs is width: a row of waveforms
 * one under another, with the parts of each one folded under it.
 */
export type Screen = 'design' | 'separate' | 'voiceover';

/**
 * One separated part of a recording, as the app holds it.
 *
 * The audio is not here. Every part is registered as a recording the moment it
 * is made — the same kind of recording somebody drags in — so it is held as a
 * file in the browser's own store and decoded when something asks to hear it.
 * That is what makes four parts of a three minute track affordable, and it is
 * also what makes every one of them placeable on the timeline, exportable, and
 * still there tomorrow, without any of that being written twice.
 */
export interface Stem {
  id: string;
  name: string;
  /** What it is, in one line. */
  about: string;
  /** The part this came out of, or null for one of the four. */
  under: string | null;
  /** How a cue names the recording it was registered as. */
  sampleId: string;
  /** How much of the recording's energy it holds, nought to one. */
  share: number;
  /**
   * The loudest sample in each slice of it, for drawing.
   *
   * Kept because the audio is not: a waveform is a few hundred numbers and the
   * sound it came from is tens of megabytes, and the panel redraws far more
   * often than anybody plays anything.
   */
  peaks: Float32Array;
  seconds: number;
  /** Whether there is anything inside it worth taking further. */
  deeper: boolean;
}

/**
 * Taking a recording apart.
 *
 * The separation itself is in `audio/separate/`, which knows nothing about any
 * of this. What is here is what the screen needs: how far along it is, what came
 * out, which parts are open, and which are being listened to.
 */
export interface Separation {
  /** What it is doing, or null when it is not doing anything. */
  busy: string | null;
  /** Nought to one while working. */
  progress: number;
  /** Roughly how many seconds are left, or null before there is enough to say. */
  secondsLeft: number | null;
  /** The name of the file the parts came out of. */
  from: string | null;
  /** How long it is, in seconds. */
  seconds: number;
  /** Every part, the four and anything opened, in the order they are shown. */
  stems: Stem[];
  /**
   * What the measurements found, for the screen to say what it did.
   *
   * The honest thing to report about a separation is the evidence rather than a
   * score: whether there was a loop and how strong it was, and whether there
   * were two different channels to read a position from. Somebody looking at
   * four parts has no other way to know that a mono file was split on repetition
   * alone.
   */
  notes: SeparationNotes | null;
  /** Which parts are unfolded. */
  opened: string[];
  /** The one part being heard on its own, or null. */
  solo: string | null;
  /** Parts silenced while comparing. */
  muted: string[];
  /** The part currently armed to be placed, or null. */
  chosen: string | null;
  /**
   * What is sounding on this screen: a part's id, "all", or null.
   *
   * Its own thing rather than the timeline's `playing`, because these are not on
   * the timeline. Somebody here is listening to a recording being taken apart,
   * and the useful gesture is one part against the others.
   */
  hearing: string | null;
  /** Which way the split was asked to lean, nought for notes and one for hits. */
  lean: number;
  /**
   * How long the file is, which is not how long what came out of it is.
   *
   * Nought when there is no file in hand. `seconds` is the stretch that was
   * actually taken apart; this is what there is to choose from, and the two
   * differ whenever somebody has asked for part of a recording rather than all
   * of it.
   */
  whole: number;
  /**
   * The stretch of the file that was taken apart, in seconds, or null for all
   * of it.
   *
   * Kept as state rather than read back off the parts, because it is also what
   * the boxes on screen are showing while somebody is still typing a new one.
   */
  span: { from: number; to: number } | null;
  /**
   * Whether these parts are being kept for next time.
   *
   * Off by default, and the reason is size. Four parts of a three minute track
   * is a couple of hundred megabytes, and writing that into the browser's store
   * because somebody happened to take a beat apart is not a decision to make on
   * their behalf. So it is a button, and pressing it settles every part's loan
   * as well as writing the screen down — ids pointing at recordings nobody kept
   * would come back as rows that cannot be played.
   */
  kept: boolean;
}

export function emptySeparation(): Separation {
  return {
    busy: null,
    progress: 0,
    secondsLeft: null,
    from: null,
    seconds: 0,
    stems: [],
    notes: null,
    opened: [],
    solo: null,
    muted: [],
    chosen: null,
    hearing: null,
    lean: 0.5,
    whole: 0,
    span: null,
    kept: false,
  };
}

/** A voice that can read a script: from the catalogue, or one somebody kept. */
export interface Reader {
  id: string;
  name: string;
  about: string;
  language: string | null;
  /** Whether it came with the catalogue rather than being described here. */
  stock: boolean;
}

/** One narrator being made, while it is still a draft. */
export interface Draft {
  id: string;
  ready: boolean;
}

/**
 * Putting a voice to a script.
 *
 * The screen's whole state. What is deliberately not here is any audio: a take
 * becomes a recording the moment it is made, exactly as a separated part does,
 * so everything after that — placing it, exporting it, finding it in the picker
 * — is something the app already knows how to do.
 */
export interface Voiceover {
  /** What it is doing, or null when it is not doing anything. */
  busy: string | null;
  /**
   * Whether this deployment can make one at all.
   *
   * Null until it has been asked. A deployment with no Gradium key is a normal
   * state rather than a fault — the rest of the app is untouched — so the screen
   * says the voiceover is off and offers nothing rather than failing at a press.
   */
  on: boolean | null;
  /** Every narrator that can be used, once they have been fetched. */
  readers: Reader[];
  /** Which one is chosen, by id. */
  reader: string | null;
  /** What they are to read. */
  script: string;
  /** Which language a described narrator will be made for. */
  language: string;
  /** A description being tried out, and the drafts it produced. */
  describing: string;
  drafts: Draft[];
  /** The take that came back, as a recording the piece can use. */
  take: {
    sampleId: string;
    name: string;
    seconds: number;
    peaks: Float32Array;
  } | null;
  /** Whether the take is sounding, so the button can offer to stop it. */
  hearing: boolean;
  /** What just happened, in one line. */
  said: string | null;
}

export function emptyVoiceover(): Voiceover {
  return {
    busy: null,
    on: null,
    readers: [],
    reader: null,
    script: '',
    language: 'en',
    describing: '',
    drafts: [],
    take: null,
    hearing: false,
    said: null,
  };
}

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
  /** Tapping a pad key drops that sound at the playhead. */
  armed: boolean;
  /**
   * The transport is running.
   *
   * Published rather than asked for, because the clock stops itself at the
   * end of the piece and nothing watching would otherwise hear about it. It
   * was read straight off the clock by a getter, which meant the play button
   * only ever changed on some other change happening to come along at the
   * same time — so after the first press it never changed at all.
   */
  playing: boolean;
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
   * With it on, the stage above the lanes is gone rather than empty, and the
   * height it was using goes to the timeline. That is the reason to want it.
   */
  videoWindow: boolean;
  /** Which tool the pointer is holding on the timeline. */
  tool: Tool;
  /**
   * A stretch of time chosen with the range tool, or null for none.
   *
   * Held here rather than in the timeline because it is a selection like any
   * other: the keyboard acts on it, and what acts on a selection should not
   * have to reach into a view to find out what is selected.
   */
  range: TimeRange | null;
  /** Which screen is showing. */
  screen: Screen;
  /** Taking a recording apart into its parts. */
  separation: Separation;
  /** Putting a voice to a script. */
  voiceover: Voiceover;
}

/**
 * The tools, as an editor for sound would name them.
 *
 * Taken from Audition's set, minus the ones that only mean something against
 * a spectrogram. Move is what the timeline always did and is the default;
 * the other four were things you could not do at all.
 */
export const TOOLS = [
  { id: 'move', key: 'V', name: 'Move', job: 'Choose sounds, drag them, drag their edges to change how long they are' },
  { id: 'range', key: 'T', name: 'Range', job: 'Drag out a stretch of time. Delete clears every sound inside it' },
  { id: 'cut', key: 'C', name: 'Cut', job: 'Click a sound to cut it short at that point' },
  { id: 'hand', key: 'H', name: 'Hand', job: 'Drag the timeline along, or the picture once you have gone into it. Nothing on either moves' },
  { id: 'zoom', key: 'Z', name: 'Zoom', job: 'Click to go in, alt-click to go out. On the timeline, drag to fill the width with a stretch; on the picture, Fit gets the whole frame back' },
  { id: 'pen', key: 'P', name: 'Pen', job: 'Draw a curve by dragging across an open lane, instead of placing points one at a time' },
] as const;

export type Tool = (typeof TOOLS)[number]['id'];

/** A stretch of time, in seconds, kept the way round it was drawn. */
export interface TimeRange {
  from: number;
  to: number;
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
  /**
   * Roughly how many seconds are left, or null before there is enough to say.
   *
   * A percentage on its own does not answer the question somebody actually
   * has, which is whether to wait or go and do something else. Reading runs at
   * a steady rate — about half the length of the clip, every time — so a few
   * seconds in there is a real answer available, and it costs nothing to work
   * out.
   */
  secondsLeft: number | null;
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
    secondsLeft: null,
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
    playing: false,
    videoWindow: false,
    tool: 'move',
    range: null,
    keeping: true,
    screen: 'design',
    separation: emptySeparation(),
    voiceover: emptyVoiceover(),
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
