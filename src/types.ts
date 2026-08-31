

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

/** Continuous master controls. */
export type KnobName = 'reverb' | 'tone';
export type SliderName = 'vol' | 'low' | 'mid' | 'high';

