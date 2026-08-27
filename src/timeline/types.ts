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
  | 'static'
  // Struck bodies
  | 'bell'
  | 'glass'
  | 'wood'
  | 'pipe'
  // Plucked
  | 'string'
  | 'thunk'
  | 'wire'
  // Clouds of grains
  | 'rain'
  | 'fire'
  | 'gravel'
  | 'swarm'
  | 'pour'
  // Runs of hits
  | 'ratchet'
  | 'clockwork'
  | 'zip'
  | 'motor';

/** The groups the picker shows, in the order they appear. */
export const DESIGN_GROUPS: readonly { title: string; names: readonly DesignName[] }[] = [
  { title: 'Hits', names: ['impact', 'thud', 'slam', 'metal', 'clank'] },
  { title: 'Movement', names: ['whoosh', 'swipe', 'flutter', 'wobble'] },
  { title: 'Lead in', names: ['riser', 'swell', 'reverse'] },
  { title: 'Low end', names: ['sub', 'rumble', 'drone'] },
  { title: 'Detail', names: ['click', 'tick', 'pop', 'beep', 'chirp'] },
  { title: 'Texture', names: ['zap', 'glitch', 'shimmer', 'static'] },
  { title: 'Struck', names: ['bell', 'glass', 'wood', 'pipe'] },
  { title: 'Plucked', names: ['string', 'thunk', 'wire'] },
  { title: 'Grains', names: ['rain', 'fire', 'gravel', 'swarm', 'pour'] },
  { title: 'Mechanical', names: ['ratchet', 'clockwork', 'zip', 'motor'] },
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
  /**
   * Other sounds that play as part of this one.
   *
   * A stack is one sound, not several sitting on top of each other: it moves
   * once, is stretched once, and sits in one room. Which is the point — two
   * cues at the same moment are two things to keep lined up forever, and a
   * boom with a metallic ring over it is one thing.
   *
   * One deep. A sound in here carrying its own `with` is read as the sound
   * without it, because the alternative is a tree, and nobody putting sound
   * to picture has ever wanted a tree.
   */
  with?: readonly CueSource[];
  /**
   * How much of this one, when it is part of another sound's stack.
   *
   * Meaningless anywhere else, and one when it is not given. Here because a
   * ring over a boom is wanted at about half, and a stack with no way to say
   * so is a stack that comes out as mush half the time.
   */
  mix?: number;
}

/**
 * The settings a chosen sound carries onto the cue it places.
 *
 * A voice on its own arrives at the length, pitch, room and push it was born
 * with. Something picked out of the library is that same voice with a
 * different set of numbers, and this is the set: enough to say which sound
 * out of a thousand was chosen, and nothing about how it is made.
 */
export interface CuePreset {
  /** What chose it, so a list can show which one is on. */
  id: string;
  /** Seconds. */
  length: number;
  /** Semitones. */
  tune: number;
  space: number;
  drive: number;
  gain: number;
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
  /**
   * How the value gets here from the point before it.
   *
   * Missing, or zero, is a straight line, which is what every point was
   * before there was anything else. A number from -1 to 1 bends that line:
   * above zero it hangs back and then rushes, below zero it moves first and
   * then settles. `hold` does not move at all, keeping the earlier value the
   * whole way and stepping to this one on arrival, which is what a cut wants.
   *
   * It belongs to the point it arrives at rather than the one it leaves,
   * which is how a curve is written down everywhere else in this app.
   */
  curve?: number | 'hold';
}

/** Which of a layer's curves a point belongs to. */
export type LaneName = 'level' | 'pan' | 'space' | 'drive';

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
  drive: AutoPoint[];
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
  {
    name: 'drive',
    label: 'Drive',
    about: 'How hard the whole layer is pushed, over time. Weight for a moment that has to land, taken back off afterwards.',
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
  bell: 2.2,
  glass: 1.6,
  wood: 0.16,
  pipe: 1.1,
  string: 1.4,
  thunk: 0.28,
  wire: 2.0,
  rain: 1.5,
  fire: 1.6,
  gravel: 0.7,
  swarm: 1.4,
  pour: 1.2,
  ratchet: 0.8,
  clockwork: 1.6,
  zip: 0.5,
  motor: 1.8,
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
  bell: 'start',
  glass: 'start',
  wood: 'start',
  pipe: 'start',
  string: 'start',
  thunk: 'start',
  wire: 'start',
  rain: 'start',
  fire: 'start',
  gravel: 'start',
  swarm: 'start',
  pour: 'start',
  ratchet: 'start',
  clockwork: 'start',
  // A zip accelerating into a moment is a lead in, the same as a riser.
  zip: 'end',
  motor: 'start',
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
  // Struck things are objects in a place, and a room is most of what says so.
  bell: { space: 0.3, drive: 0 },
  glass: { space: 0.32, drive: 0 },
  wood: { space: 0.12, drive: 0 },
  pipe: { space: 0.28, drive: 0.1 },
  // Plucked things are closer to the ear than struck ones.
  string: { space: 0.15, drive: 0 },
  thunk: { space: 0.1, drive: 0.25 },
  wire: { space: 0.22, drive: 0 },
  // Weather and water are already made of a thousand small things, so a room
  // on top of them turns to mush rather than to distance.
  rain: { space: 0.08, drive: 0 },
  fire: { space: 0.06, drive: 0.15 },
  gravel: { space: 0.1, drive: 0.2 },
  swarm: { space: 0.18, drive: 0 },
  pour: { space: 0.12, drive: 0 },
  // Machines are near and dry, and a little push is what makes them read as
  // metal working rather than as clicks.
  ratchet: { space: 0.08, drive: 0.2 },
  clockwork: { space: 0.1, drive: 0.1 },
  zip: { space: 0.05, drive: 0.15 },
  motor: { space: 0.1, drive: 0.35 },
};

/** What everything else starts at. Packs bring their own effects with them. */
export const DEFAULT_CHARACTER: Record<SourceKind, { space: number; drive: number }> = {
  design: { space: 0, drive: 0 },
  kit: { space: 0.1, drive: 0 },
  pitched: { space: 0.2, drive: 0 },
  pack: { space: 0, drive: 0 },
};

export const DESIGN_NAMES: readonly DesignName[] = DESIGN_GROUPS.flatMap((g) => g.names);
