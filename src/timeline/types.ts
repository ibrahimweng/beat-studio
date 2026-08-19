import type { PadName } from '../types.ts';

/** Where a cue's sound comes from. */
export type SourceKind = 'kit' | 'design' | 'pitched';

/**
 * Sound design voices, tuned for motion graphics rather than music.
 *
 * Each one is built from a different mechanism rather than from the same one
 * with the numbers moved around, so they stay apart from each other however
 * they are tuned or stretched.
 */
export type DesignName =
  // Hits
  | 'impact'
  | 'thud'
  | 'slam'
  | 'metal'
  | 'clank'
  // Movement
  | 'whoosh'
  | 'swipe'
  | 'flutter'
  | 'wobble'
  // Lead ins
  | 'riser'
  | 'swell'
  | 'reverse'
  // Low end
  | 'sub'
  | 'rumble'
  | 'drone'
  // Detail
  | 'click'
  | 'tick'
  | 'pop'
  | 'beep'
  | 'chirp'
  // Texture
  | 'zap'
  | 'glitch'
  | 'shimmer'
  | 'static';

/** The groups the picker shows, in the order they appear. */
export const DESIGN_GROUPS: readonly { title: string; names: readonly DesignName[] }[] = [
  { title: 'Hits', names: ['impact', 'thud', 'slam', 'metal', 'clank'] },
  { title: 'Movement', names: ['whoosh', 'swipe', 'flutter', 'wobble'] },
  { title: 'Lead in', names: ['riser', 'swell', 'reverse'] },
  { title: 'Low end', names: ['sub', 'rumble', 'drone'] },
  { title: 'Detail', names: ['click', 'tick', 'pop', 'beep', 'chirp'] },
  { title: 'Texture', names: ['zap', 'glitch', 'shimmer', 'static'] },
];

export type PitchedName = 'piano' | 'guitar';

export interface CueSource {
  kind: SourceKind;
  /** A pad name, a design voice name, or a pitched instrument name. */
  name: PadName | DesignName | PitchedName;
  /** Pitched sources only: the note to play. */
  midi?: number;
}

/**
 * Which end of the sound lands on the cue's time.
 *
 * A riser or a reverse swell leads into a moment, so the part that matters is
 * where it finishes. Anchoring to the end means the sound is scheduled to stop
 * on the marker rather than start on it.
 */
export type Anchor = 'start' | 'end';

export interface Cue {
  id: string;
  /** Seconds from the start of the video. */
  time: number;
  layerId: string;
  source: CueSource;
  /** Level, 0 to 1.5. */
  gain: number;
  /** Pitch offset in semitones. */
  tune: number;
  /** Seconds. Design voices stretch to this; kit voices ignore it. */
  length: number;
  anchor: Anchor;
  /** Silenced without being deleted, for comparing. */
  muted: boolean;
}

export interface Layer {
  id: string;
  name: string;
  muted: boolean;
  solo: boolean;
  gain: number;
}

export interface Project {
  /** Frames per second, used for snapping and for the timecode display. */
  fps: number;
  /** Length of the loaded video in seconds. */
  duration: number;
  /** Name of the video file, for the session record. Video is never uploaded. */
  videoName: string | null;
  layers: Layer[];
  cues: Cue[];
  /** Optional musical grid, for work that is cut to a tempo. */
  bpm: number;
  /** What placing and nudging snap to. */
  snap: SnapMode;
}

export type SnapMode = 'off' | 'frame' | 'beat';

/** Sound design voices are stretched to a length; these are sensible defaults. */
export const DESIGN_DEFAULT_LENGTH: Record<DesignName, number> = {
  impact: 0.6,
  thud: 0.3,
  slam: 0.9,
  metal: 1.6,
  clank: 0.25,
  whoosh: 0.7,
  swipe: 0.35,
  flutter: 0.8,
  wobble: 1.0,
  riser: 1.2,
  swell: 1.0,
  reverse: 1.0,
  sub: 0.9,
  rumble: 1.8,
  drone: 2.0,
  click: 0.02,
  tick: 0.03,
  pop: 0.18,
  beep: 0.2,
  chirp: 0.15,
  zap: 0.45,
  glitch: 0.35,
  shimmer: 1.8,
  static: 0.8,
};

/**
 * Voices that read better ending on the marker than starting on it.
 *
 * These are the ones that lead into a moment. What matters about a riser is
 * where it arrives, not where it set off.
 */
export const DESIGN_DEFAULT_ANCHOR: Record<DesignName, Anchor> = {
  impact: 'start',
  thud: 'start',
  slam: 'start',
  metal: 'start',
  clank: 'start',
  whoosh: 'start',
  swipe: 'start',
  flutter: 'start',
  wobble: 'start',
  riser: 'end',
  swell: 'end',
  reverse: 'end',
  sub: 'start',
  rumble: 'start',
  drone: 'start',
  click: 'start',
  tick: 'start',
  pop: 'start',
  beep: 'start',
  chirp: 'start',
  zap: 'start',
  glitch: 'start',
  shimmer: 'start',
  static: 'start',
};

export const DESIGN_NAMES: readonly DesignName[] = DESIGN_GROUPS.flatMap((g) => g.names);
