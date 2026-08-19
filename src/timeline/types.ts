import type { PadName } from '../types.ts';

/** Where a cue's sound comes from. */
export type SourceKind = 'kit' | 'design' | 'pitched';

/** Sound design voices, tuned for motion graphics rather than music. */
export type DesignName =
  | 'impact'
  | 'whoosh'
  | 'riser'
  | 'sub'
  | 'click'
  | 'pop'
  | 'swell';

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
  whoosh: 0.7,
  riser: 1.2,
  sub: 0.9,
  click: 0.08,
  pop: 0.18,
  swell: 1.0,
};

/** Voices that read better ending on the marker than starting on it. */
export const DESIGN_DEFAULT_ANCHOR: Record<DesignName, Anchor> = {
  impact: 'start',
  whoosh: 'start',
  riser: 'end',
  sub: 'start',
  click: 'start',
  pop: 'start',
  swell: 'end',
};

export const DESIGN_NAMES: readonly DesignName[] = [
  'impact',
  'whoosh',
  'riser',
  'sub',
  'click',
  'pop',
  'swell',
];
