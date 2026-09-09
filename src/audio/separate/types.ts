/**
 * What a separation is, said once so that nothing has to guess.
 *
 * The shape here is the seam. Everything above it — the screen, the session,
 * the four ways a stem reaches the timeline — is written against these types
 * and not against the arithmetic that produces them, so a different way of
 * separating a recording can be dropped in without any of that changing.
 * There is one implementation today, in `dsp.ts`, and it does its work with
 * medians and Fourier transforms rather than with a trained model. If a model
 * ever goes in beside it, this is the interface it has to satisfy.
 *
 * Nothing here touches the page.
 */

/** The four parts a mix is cut into, in the order they are shown. */
export const PARTS = ['drums', 'bass', 'lead', 'tonal'] as const;

export type PartId = (typeof PARTS)[number];

/**
 * A separated part's audio, which is a file before it is ever samples.
 *
 * Not an AudioBuffer, and the reason is arithmetic rather than taste. Four
 * parts of a recording held as floating point are four times the size of the
 * recording, and the encoded files are three quarters of that again on top,
 * because both exist at once while the parts are being written out. Held this
 * way there is one copy of each part and the working set is one block wide,
 * which is what decides how long a recording can be taken apart at all.
 *
 * A separator that produced whole buffers can satisfy this by wrapping them.
 * The one here does not have to: it writes each stretch as it becomes final.
 */
export interface PartAudio {
  readonly rate: number;
  readonly channels: number;
  /** In samples. */
  readonly length: number;
  readonly duration: number;
  /**
   * Total energy, which is what every share a part reports is a share of.
   *
   * Counted as the part is written rather than measured afterwards, because
   * measuring it afterwards means reading every sample back.
   */
  readonly energy: number;
  /** The loudest sample in each slice of it, for drawing. */
  readonly peaks: Float32Array;
  /** The part as a file, which is how it reaches everything else in the app. */
  wav(): Blob;
  /**
   * The samples, read back out.
   *
   * Allocates the whole part, so it is a method and not a field, and an
   * implementation is allowed to refuse once {@link wav} has taken the bytes.
   * Nothing on the screen calls it.
   */
  samples(): AudioBuffer;
}

/**
 * One separated part of a recording.
 *
 * Every part is exactly as long as the recording and at the same rate, so they
 * sit on separate tracks and stay in sync — the same promise the export makes
 * about its stems, and true here for the same reason.
 */
export interface StemPart {
  /** Unique, and readable: `drums`, or `drums.kick` for one taken further. */
  id: string;
  name: string;
  /** What it is, in one line, for the screen. */
  about: string;
  /** The part this came out of, or null for one of the four. */
  under: string | null;
  audio: PartAudio;
  /**
   * How much of the recording's energy it holds, nought to one.
   *
   * The shares of the four add to about one and not exactly to one, because
   * energy is not additive across parts that overlap: two parts that cancel
   * where they meet hold more between them than the mix does. Shown as a
   * proportion rather than a percentage of a total for that reason.
   */
  share: number;
}

/**
 * What the measurements found, so the screen can say what it did rather than
 * only what came out.
 *
 * This exists because the honest thing to report about a separation is the
 * evidence, not a score. Whether there was a loop and how strong it was, and
 * whether there were two different channels to compare, are the two facts that
 * decide how much of the work each measurement did — and somebody looking at
 * four stems has no other way to know that a mono file was split on repetition
 * alone.
 */
export interface SeparationNotes {
  /** The loop's length in seconds, or null when nothing repeated. */
  loop: number | null;
  /** How far the loop's peak stood above its surroundings. */
  loopStrength: number;
  /** Whether the two channels differed enough to read a position from. */
  stereo: boolean;
  /** How far apart the channels are overall, nought to one. */
  width: number;
  /** How long the work took, in seconds. */
  took: number;
}

export interface Separation {
  /** Which separator did it. */
  by: string;
  rate: number;
  /** In samples. */
  length: number;
  channels: number;
  parts: StemPart[];
  notes: SeparationNotes;
}

export interface SeparateOptions {
  /**
   * Which way to lean between hits and notes, nought to one, a half neutral.
   *
   * The one control worth exposing, because the right answer is not the same
   * for every recording: a heavily compressed mix has drums smeared across
   * time until they look partly like notes, and an acoustic recording has a
   * piano attack that looks partly like a drum.
   */
  lean?: number;
  /**
   * Where the bass ends and the rest begins, in hertz.
   *
   * A crossover rather than a line, and it is the crudest thing in the whole
   * pipeline: a bass part is the low end of what is left after the drums are
   * taken out, which is right about the fundamentals and wrong about
   * everything a bass does above them. Said plainly here rather than implied
   * by a number nobody can see.
   */
  bassTo?: number;
  /** Look for a loop at all. Off is faster and gives up the foreground split. */
  useLoop?: boolean;
}

/** Told how far along it is, and what it is doing. */
export type Progress = (done: number, of: number, what: string) => void;

/**
 * Something that can take a recording apart.
 *
 * `refine` is optional and is what makes the tree two deep: given one of the
 * four parts back, it returns the parts inside it — the kick, the snare and
 * the hats out of the drums, the separate lines out of what is left. It is
 * separate from `separate` because it is worth doing on demand rather than
 * always: most of the time somebody wants the drums, and working out which
 * hits in them are the snare costs as much again.
 */
export interface Separator {
  readonly id: string;
  readonly name: string;
  /** What it can and cannot do, for the screen to say without being asked. */
  readonly about: string;
  separate(
    input: AudioBuffer,
    options?: SeparateOptions,
    onStep?: Progress,
  ): Promise<Separation>;
  refine?(
    part: StemPart,
    /**
     * The part's samples, decoded by the caller.
     *
     * Passed in rather than read off `part`, because by the time anybody asks
     * to go deeper the part has been handed over as a file and its samples with
     * it. The caller has to decode one part; this would otherwise have to hold
     * all four.
     */
    audio: AudioBuffer,
    options?: SeparateOptions,
    onStep?: Progress,
  ): Promise<StemPart[]>;
}
