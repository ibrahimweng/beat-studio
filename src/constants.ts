import type { PadName } from './types.ts';

/**
 * Every drum voice, with a readable name.
 *
 * The sequencer only drives eight of these, because eight lanes is as many as
 * a pattern grid can show without becoming unreadable. When placing sounds
 * against a video there is no such limit, so all of them are offered.
 */
export const KIT_SOUNDS: readonly { pad: PadName; label: string }[] = [
  { pad: 'kick', label: 'Kick' },
  { pad: 'kick2', label: 'Kick 2' },
  { pad: 'snare', label: 'Snare' },
  { pad: 'hhc', label: 'HH closed' },
  { pad: 'hho', label: 'HH open' },
  { pad: 'tom1', label: 'Tom 1' },
  { pad: 'tom2', label: 'Tom 2' },
  { pad: 'tom3', label: 'Tom 3' },
  { pad: 'floor', label: 'Floor' },
  { pad: 'crash1', label: 'Crash' },
  { pad: 'crash2', label: 'Crash 2' },
  { pad: 'splash', label: 'Splash' },
  { pad: 'ride', label: 'Ride' },
];

/** General MIDI percussion note for each pad. */
export const PAD_MIDI: Record<PadName, number> = {
  kick: 36,
  kick2: 35,
  snare: 38,
  hhc: 42,
  hho: 46,
  tom1: 48,
  tom2: 45,
  tom3: 43,
  floor: 41,
  crash1: 49,
  crash2: 57,
  splash: 55,
  ride: 51,
};

/** Computer-keyboard mapping for the drum pads. */
export const PAD_KEYS: Record<string, PadName> = {
  w: 'crash1',
  e: 'splash',
  r: 'crash2',
  t: 'ride',
  a: 'hhc',
  s: 'hho',
  d: 'kick',
  f: 'kick2',
  g: 'tom1',
  h: 'tom2',
  j: 'snare',
  k: 'floor',
  l: 'tom3',
};

/** Pitch-class names, index = semitone. */
export const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export const PACKS_KEY = 'toolcraft.st88.packs';
export const MINE_KEY = 'toolcraft.st88.mine';

/** The pack sounds of your own live in, so a cue can name them like any other. */
export const MINE_ID = 'mine';
