import type { PadName } from '../types.ts';

/** Where a cue's sound comes from. */
export type SourceKind = 'kit' | 'design' | 'pitched' | 'pack';

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
  /** A pad name, a design voice name, a pitched instrument, or a pack sound. */
  name: PadName | DesignName | PitchedName | string;
  /** Pitched sources only: the note to play. */
  midi?: number;
  /** Pack sources only: which loaded pack the name belongs to. */
  pack?: string;
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
  /**
   * How much room is around it, 0 to 1.
   *
   * Its own room, not the one at the end of the chain that everything shares.
   * An impact can have a hall behind it while the click next to it stays dry,
   * which is most of the difference between a sound that reads as placed in a
   * scene and one that reads as pasted on top of it.
   */
  space: number;
  /**
   * How hard it is pushed, 0 to 1.
   *
   * Saturation, which is what punch is. It adds harmonics above what was
   * there, and those are why a hit still reads on a laptop speaker that
   * cannot reproduce any of its low end.
   */
  drive: number;
  /** Silenced without being deleted, for comparing. */
  muted: boolean;
}

/**
 * A point on one of a layer's curves.
 *
 * Two of these are a fade. A handful are a shape that follows the picture,
 * which is what a bed of rumble under a sequence actually needs: it has to
 * come up as the shot opens out and get out of the way when someone speaks.
 */
export interface AutoPoint {
  /** Seconds from the start of the video. */
  t: number;
  /** What the lane is set to at that moment, within the lane's own range. */
  value: number;
}

/** Which of a layer's curves a point belongs to. */
export type LaneName = 'level' | 'pan' | 'space';

/**
 * The curves a layer carries, each drawn over time.
 *
 * An empty lane does nothing at all, and nothing is built in the audio graph
 * for it: the fixed level applies, the layer stays in the middle, and there
 * is no room around it.
 */
export interface Lanes {
  level: AutoPoint[];
  pan: AutoPoint[];
  space: AutoPoint[];
}

/** What one lane is: what it controls, how far it goes, and how it reads. */
export interface LaneSpec {
  name: LaneName;
  label: string;
  /** What it does, for the label people hover. */
  about: string;
  min: number;
  max: number;
  /** What the lane means when nothing is drawn, and where its guide line sits. */
  neutral: number;
  /**
   * Where the shaded area under the curve is measured from.
   *
   * An amount is shaded from the floor, because what you want to see is how
   * much of it there is. A direction is shaded from the middle, because what
   * you want to see is how far off centre it has gone, and which way.
   */
  base: 'floor' | 'neutral';
}

/**
 * What each lane is, in the order they are drawn.
 *
 * The range and the resting value live here rather than in the interface,
 * because the audio has to agree with the drawing about what the height of a
 * point means. One table, read by both.
 */
export const LANES: readonly LaneSpec[] = [
  {
    name: 'level',
    label: 'Level',
    about: 'How loud the layer is, over time. A bed has to get out of the way when something else speaks.',
    min: 0,
    max: 1.5,
    neutral: 1,
    base: 'floor',
  },
  {
    name: 'pan',
    label: 'Pan',
    about: 'Where it sits between the speakers. Up is right, down is left, the middle is the middle.',
    min: -1,
    max: 1,
    neutral: 0,
    base: 'neutral',
  },
  {
    name: 'space',
    label: 'Space',
    about: 'How much room is around the whole layer, over time. A sequence can walk out of a booth into a hall.',
    min: 0,
    max: 1,
    neutral: 0,
    base: 'floor',
  },
];

export interface Layer {
  id: string;
  name: string;
  muted: boolean;
  solo: boolean;
  /** The level, when none is drawn. */
  gain: number;
  /**
   * What is drawn over time, lane by lane, each in time order.
   *
   * An empty level lane means the fixed level above applies throughout. As
   * soon as anything is drawn there it takes over completely, rather than
   * multiplying with the fixed level, because two things claiming to be the
   * same control is how you end up unable to work out why something is quiet.
   */
  auto: Lanes;
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

/**
 * How much room and how much push each voice wants to start with.
 *
 * Not a rule, only a starting point: every one of these is a control on the
 * placed sound. The pattern behind the numbers is that anything meant to land
 * in a scene gets a room, anything meant to be exact stays dry, and anything
 * that has to carry weight on a small speaker gets pushed.
 */
export const DESIGN_CHARACTER: Record<DesignName, { space: number; drive: number }> = {
  // Hits land in a place, and want to be felt as much as heard.
  impact: { space: 0.22, drive: 0.35 },
  thud: { space: 0.15, drive: 0.2 },
  slam: { space: 0.35, drive: 0.4 },
  metal: { space: 0.3, drive: 0.1 },
  clank: { space: 0.18, drive: 0.15 },
  // Movement carries across a space rather than sitting in one.
  whoosh: { space: 0.2, drive: 0 },
  swipe: { space: 0.12, drive: 0 },
  flutter: { space: 0.1, drive: 0 },
  wobble: { space: 0.1, drive: 0.2 },
  // Lead ins arrive somewhere, so they need somewhere to arrive.
  riser: { space: 0.18, drive: 0.1 },
  swell: { space: 0.22, drive: 0 },
  reverse: { space: 0.2, drive: 0 },
  // Low end is felt, and a sub with nothing above it is felt by nobody on a
  // phone. Pushing it puts harmonics where a small speaker can reach them.
  sub: { space: 0, drive: 0.25 },
  rumble: { space: 0.15, drive: 0.1 },
  drone: { space: 0.25, drive: 0.1 },
  // Detail has to be exact, and a room makes nothing more exact.
  click: { space: 0, drive: 0 },
  tick: { space: 0, drive: 0 },
  pop: { space: 0.08, drive: 0 },
  beep: { space: 0, drive: 0 },
  chirp: { space: 0.08, drive: 0 },
  // Texture is the one place a room is the point rather than the setting.
  zap: { space: 0.15, drive: 0.25 },
  glitch: { space: 0.05, drive: 0.2 },
  shimmer: { space: 0.35, drive: 0 },
  static: { space: 0, drive: 0 },
};

/** What everything else starts at. Packs bring their own effects with them. */
export const DEFAULT_CHARACTER: Record<SourceKind, { space: number; drive: number }> = {
  design: { space: 0, drive: 0 },
  kit: { space: 0.1, drive: 0 },
  pitched: { space: 0.2, drive: 0 },
  pack: { space: 0, drive: 0 },
};

export const DESIGN_NAMES: readonly DesignName[] = DESIGN_GROUPS.flatMap((g) => g.names);
