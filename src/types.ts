

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

