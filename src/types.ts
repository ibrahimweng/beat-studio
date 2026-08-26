/** Which instrument the main stage is showing. */
export type View = 'drums' | 'keys' | 'guitar';

/** Which panel the bottom dock is showing. */
export type Dock = 'seq' | 'takes';

/** Metronome subdivision. */
export type Metro = 'off' | 'beat' | 'sixteenth';

/** Pattern bank name. */
export type BankKey = 'A' | 'B' | 'C' | 'D';

/** Every drum voice the synth can render. */
export type PadName =
  | 'kick'
  | 'kick2'
  | 'snare'
  | 'hhc'
  | 'hho'
  | 'tom1'
  | 'tom2'
  | 'tom3'
  | 'floor'
  | 'crash1'
  | 'crash2'
  | 'splash'
  | 'ride';

/** The eight voices the step sequencer can drive. */
export type LaneKey = 'kick' | 'snare' | 'hhc' | 'hho' | 'tom1' | 'tom2' | 'crash' | 'ride';

/** A sequencer lane: a label, the pad it fires and the MIDI note it exports as. */
export interface Lane {
  key: LaneKey;
  label: string;
  pad: PadName;
  midi: number;
}

/** One bank's step data: 32 slots per lane, regardless of the active step count. */
export type Pattern = Record<LaneKey, boolean[]>;

/** All four pattern banks. */
export type Banks = Record<BankKey, Pattern>;

/** A note captured while recording, in seconds relative to the take start. */
export interface NoteEvent {
  midi: number;
  /** Seconds from the start of the take. */
  t: number;
  /** Duration in seconds. */
  dur: number;
  /** Velocity, 0..1. */
  vel: number;
  /** MIDI channel — 0 piano, 1 guitar, 9 drums. */
  ch: number;
}

/** A landed recording plus everything needed to play, draw and export it. */
export interface Take {
  id: string;
  name: string;
  /** Length in seconds. */
  dur: number;
  blob: Blob;
  /** Decoded audio, absent if the browser could not decode the recording. */
  buffer: AudioBuffer | null;
  /** Normalised peaks, 0..100, for the waveform strip. */
  bars: number[];
  /** Replay this take underneath the next recording. */
  layered: boolean;
  events: NoteEvent[];
  bpm: number;
  meta: string;
}

/** Continuous master controls. */
export type KnobName = 'reverb' | 'tone';
export type SliderName = 'vol' | 'low' | 'mid' | 'high';

/** Which instrument voice a note should be played with. */
export type NoteKind = 'piano' | 'guitar';

/**
 * A sounding synth voice that can be released on key-up.
 *
 * One level per layer rather than one for the voice, because a voice is built
 * from its layers and each carries its own. Letting go of a note means letting
 * go of all of them together.
 */
export interface Voice {
  gains: GainNode[];
  dur: number;
}

/** The shape persisted to localStorage. */
export interface SavedState {
  banks: Banks;
  bpm: number;
  bank: BankKey;
}
