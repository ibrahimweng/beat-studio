import type { BankKey, Lane, LaneKey, PadName, View } from './types.ts';

/** Sequencer lanes, top to bottom. */
export const LANES: readonly Lane[] = [
  { key: 'kick', label: 'Kick', pad: 'kick', midi: 36 },
  { key: 'snare', label: 'Snare', pad: 'snare', midi: 38 },
  { key: 'hhc', label: 'HH closed', pad: 'hhc', midi: 42 },
  { key: 'hho', label: 'HH open', pad: 'hho', midi: 46 },
  { key: 'tom1', label: 'Tom 1', pad: 'tom1', midi: 48 },
  { key: 'tom2', label: 'Tom 2', pad: 'tom2', midi: 45 },
  { key: 'crash', label: 'Crash', pad: 'crash2', midi: 49 },
  { key: 'ride', label: 'Ride', pad: 'ride', midi: 51 },
];

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

/** Two computer-keyboard rows, each covering one chromatic octave. */
export const KEY_ROWS: readonly { row: string; semis: readonly number[]; oct: number }[] = [
  { row: 'zsxdcvgbhnjm', semis: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], oct: 0 },
  { row: 'q2w3er5t6y7u', semis: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], oct: 1 },
];

/** Pitch-class names, index = semitone. */
export const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Strummable chord voicings, low string to high. */
export const CHORDS: readonly { name: string; notes: readonly number[] }[] = [
  { name: 'Em', notes: [40, 47, 52, 55, 59, 64] },
  { name: 'G', notes: [43, 47, 50, 55, 59, 67] },
  { name: 'C', notes: [48, 52, 55, 60, 64] },
  { name: 'D', notes: [50, 57, 62, 66] },
  { name: 'Am', notes: [45, 52, 57, 60, 64] },
  { name: 'F', notes: [41, 48, 53, 57, 60, 65] },
];

/** Standard tuning as MIDI notes, high E first — index matches the string rows. */
export const G_TUNING = [64, 59, 55, 50, 45, 40] as const;

/** The starter groove loaded into bank A on a first run, and by "Seed beat". */
export const SEED: Partial<Record<LaneKey, number[]>> = {
  kick: [0, 6, 10],
  snare: [4, 12],
  hhc: [0, 2, 4, 6, 8, 10, 12, 14],
  hho: [14],
  tom1: [],
  tom2: [11],
  crash: [],
  ride: [],
};

export const BANK_KEYS: readonly BankKey[] = ['A', 'B', 'C', 'D'];

/** Stage heading per view. */
export const TITLES: Record<View, string> = {
  drums: 'Drum kit',
  keys: '88‑key grand',
  guitar: 'Steel guitar',
};

/** Every lane stores 32 slots so switching 16 <-> 32 steps never loses edits. */
export const MAX_STEPS = 32;

/** Frets drawn on the guitar board. */
export const FRET_COUNT = 15;

/** Frets that get an inlay dot. */
export const FRET_DOTS = [3, 5, 7, 9, 12, 15];

/** Lowest and highest key on an 88-key piano. */
export const PIANO_LOW = 21;
export const PIANO_HIGH = 108;

export const BPM_MIN = 40;
export const BPM_MAX = 220;

export const STORAGE_KEY = 'toolcraft.st88.v2';
