/**
 * Rooms.
 *
 * Every sound in the app went through decaying white noise, in two different
 * places that had drifted into being two different rooms: the master send
 * multiplied by `noise * (1 - i/len)^decay`, and a placed sound's own Space
 * control by `noise * exp(-i/(len*0.28))` with a one-pole filter over the top.
 * Neither is a room. Decaying noise is the sound of a reverb from 1982, and it
 * is why a hit put in a "hall" here came back with hiss on it rather than
 * somewhere.
 *
 * Three things separate a real space from noise that fades, and the first one
 * matters most.
 *
 * **Early reflections.** The first few dozen milliseconds are not noise, they
 * are a handful of distinct echoes off the nearest walls. Their timing is
 * almost the whole of what tells you how big a space is and how far you are
 * from its surfaces; a listener locates a room from these long before the tail
 * arrives. Decaying noise has none, and a room with no early reflections reads
 * as an effect applied to a sound rather than a place the sound is in.
 *
 * **Density that builds.** Echoes in a room arrive at a rate that grows with
 * time, because the number of paths of a given length grows with the volume
 * the sound has reached. So a real tail starts sparse and thickens. White
 * noise is at full density from its first sample, which is the "shhh" that
 * makes a synthetic tail obvious.
 *
 * **A top end that goes first.** Air absorbs high frequencies, and so does
 * everything a wall is made of. A real hall's tail is measurably shorter at
 * 8 kHz than at 250 Hz — usually by a factor of two or three — which is why a
 * long room sounds warm rather than bright. A single decay rate for the whole
 * spectrum keeps the hiss alive for exactly as long as the body, and gets the
 * one part of a tail people describe without prompting the wrong way round.
 *
 * All three are cheap. This runs once per room, not per sound.
 *
 * ---
 *
 * Built from a seeded stream like everything else here, so a room is the same
 * room while working, while auditioning, and in the exported file. Two rooms
 * of the same description are the same buffer, which is what lets one be
 * built once and shared by every voice that asks for it.
 *
 * `tools/room-check.html` measures the three claims above: decay per band,
 * how the echo density climbs, and where the early reflections land.
 */

/** A space, described by what a listener would say about it. */
export interface RoomSpec {
  /** How long the tail takes to fall away, in seconds, in the middle. */
  seconds: number;
  /** How much the walls eat the top end, 0 to 1. */
  damping: number;
  /**
   * How far away the walls are, 0 to 1.
   *
   * Sets when the early reflections arrive and how far they spread, which is
   * the part a listener hears as size. Separate from `seconds`, because a
   * small tiled room rings for a long time and a big draped one does not.
   */
  size: number;
  /**
   * How loud the discrete early reflections are against the tail, 0 to 1.
   *
   * Zero is a plate: no walls, so no distinct arrivals, dense from the start.
   * That is a real and useful room rather than a degenerate case, which is why
   * this is a setting and not always on.
   */
  early: number;
}

/** The rooms offered by name. */
export const ROOMS = {
  booth: { seconds: 0.28, damping: 0.55, size: 0.06, early: 0.9 },
  room: { seconds: 0.62, damping: 0.42, size: 0.18, early: 0.8 },
  plate: { seconds: 1.9, damping: 0.12, size: 0.02, early: 0 },
  chamber: { seconds: 1.35, damping: 0.34, size: 0.38, early: 0.6 },
  hall: { seconds: 2.6, damping: 0.28, size: 0.72, early: 0.45 },
  cathedral: { seconds: 5, damping: 0.2, size: 1, early: 0.3 },
} as const satisfies Record<string, RoomSpec>;

export type RoomName = keyof typeof ROOMS;

/** The rooms in the order they should be offered, smallest first. */
export const ROOM_NAMES: readonly RoomName[] = [
  'booth',
  'room',
  'plate',
  'chamber',
  'hall',
  'cathedral',
];

/**
 * Total energy every room is scaled to.
 *
 * A convolver's output level follows the energy of its impulse, so without
 * this a cathedral would be far louder than a booth at the same send and
 * changing room would mean re-riding the mixer. Normalising the energy rather
 * than the peak is what keeps the *output* level steady, since that is what
 * the convolution actually multiplies by.
 */
const ENERGY = 1.6;

/** One-pole smoothing coefficient for a cutoff, at a rate. */
function pole(freq: number, rate: number): number {
  return Math.exp((-2 * Math.PI * freq) / rate);
}

/**
 * Amplitude of a tail at time `t`, given the time it takes to fall 60 dB.
 *
 * -60 dB is a factor of a thousand, so the exponent is `-3` decades over the
 * time named.
 */
function fade(t: number, rt60: number): number {
  return Math.pow(10, (-3 * t) / Math.max(0.01, rt60));
}

/**
 * How long the bottom and the middle ring, from one mid-band time.
 *
 * Bass outlasts the middle in every real space. The top is not here because it
 * is not set by an envelope: it dies as the closing filter in {@link buildRoom}
 * takes it away, which is both what happens and what measures right.
 */
function bandTimes(spec: RoomSpec): { low: number; mid: number } {
  return {
    low: spec.seconds * 1.22,
    mid: spec.seconds,
  };
}

/**
 * The discrete arrivals off the nearest surfaces.
 *
 * Spaced so that they get *closer together* as they go on. That is the way
 * round it happens: the number of paths of a given length grows with the
 * volume the sound has swept, so echoes crowd as the tail develops. An
 * exponent below one on evenly spaced steps gives exactly that, and the
 * jitter on top is what stops a regular pattern turning into the metallic
 * ring of a flutter echo.
 */
function early(
  data: Float32Array,
  rate: number,
  spec: RoomSpec,
  random: () => number,
): void {
  if (spec.early <= 0) return;

  // The nearest wall. A booth answers in under two milliseconds, a cathedral
  // takes twenty-five, and that gap is most of what "big" means to a listener.
  const first = 0.0016 + spec.size * 0.023;
  const last = spread(spec);
  const taps = 18;

  for (let k = 1; k <= taps; k++) {
    const along = Math.pow(k / taps, 0.72);
    // Up to a fifth of the way to the next tap, so no two rooms share a comb.
    const jitter = 1 + (random() * 2 - 1) * 0.2;
    const at = (first + (last - first) * along) * jitter;
    const index = Math.round(at * rate);
    if (index < 1 || index >= data.length) continue;

    // Falling off with distance, as a wavefront does, and flipping polarity
    // the way a reflection off a denser surface does.
    const level = Math.pow(first / at, 0.9) * (0.75 + random() * 0.5);
    data[index] += (random() < 0.5 ? -1 : 1) * level * spec.early;
  }
}

/** How long the early reflections go on for before the tail has taken over. */
function spread(spec: RoomSpec): number {
  return 0.008 + spec.size * 0.062;
}

/**
 * One room, as a buffer a convolver can multiply a sound by.
 *
 * `random` is the caller's seeded stream, so the same description gives the
 * same room every time and an export matches what was heard.
 */
export function buildRoom(
  ctx: BaseAudioContext,
  spec: RoomSpec,
  random: () => number,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const seconds = Math.max(0.02, spec.seconds);
  /*
   * Long enough for the slowest band, not for the nominal one.
   *
   * The bottom rings for {@link bandTimes} longer than the middle, so a buffer
   * cut at the named length ends while the bass is still going: a tail that
   * stops rather than fades, which is a click at the end of every room. Caught
   * by measuring — every band's decay came out clamped to the buffer length,
   * and the top's shorter life read as 0.83 of the bottom's when the curves
   * themselves were a good half.
   */
  const length = Math.ceil(rate * seconds * 1.3);
  const buffer = ctx.createBuffer(2, length, rate);
  const rt = bandTimes(spec);

  // Where the tail has reached full density. Before this it is thickening,
  // which is the part that stops it sounding like noise from sample zero.
  const build = spread(spec) * 2.2;
  const lowPole = pole(250, rate);

  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);

    /*
     * The tail, as noise that arrives gradually.
     *
     * `thickness` is how likely any one sample is to carry an arrival, and it
     * climbs as the square of how far into the build we are — the same growth
     * as the number of paths available. Dividing by its square root holds the
     * energy steady while the density rises, so the tail thickens without
     * also getting louder, which would be heard as a swell rather than a room.
     */
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const thickness = Math.min(1, Math.pow(t / build, 2));
      if (random() >= Math.max(thickness, 0.004)) continue;
      data[i] = (random() * 2 - 1) / Math.sqrt(Math.max(thickness, 0.004));
    }

    /*
     * The tail darkening as it goes, rather than three bands with three
     * envelopes.
     *
     * Splitting into bands and giving each its own decay was the obvious way
     * and it measured badly: one-pole crossovers slope at 6 dB an octave, so
     * the "high" band still carries most of the low end and decays with it.
     * Designed for a top that lasts 0.53 of the bottom, the hall measured
     * 0.84 — the effect was there and almost entirely diluted.
     *
     * A filter that closes over the length of the tail has no crossover to
     * leak through, and is closer to the thing being modelled anyway: a late
     * reflection is late because it went further, through more air and off
     * more soft surfaces, and each of those took the top off again. So the
     * cutoff falls as the tail runs, and the top end dies because it is being
     * removed rather than because a separate envelope says so.
     *
     * The coefficient moves every 64 samples rather than every sample. That
     * is 1.3 ms at 48 kHz, far below anything audible in a reverb tail, and
     * it takes the exponential out of the inner loop.
     */
    const open = 18000;
    const shut = 380 + (1 - spec.damping) * 1250;
    const close = seconds * (0.34 - 0.2 * spec.damping);
    let lowA = 0;
    let lowB = 0;
    let lowC = 0;
    let toneA = 0;
    let toneB = 0;
    let coefficient = pole(open, rate);

    for (let i = 0; i < length; i++) {
      const t = i / rate;
      if ((i & 63) === 0) {
        const cutoff = shut + (open - shut) * Math.exp(-t / Math.max(0.02, close));
        coefficient = pole(cutoff, rate);
      }
      const sample = data[i];

      // Twice, for 12 dB an octave. Once was 6, and at 6 the tail measured
      // 0.91 of the bottom's life in the top octave when it was meant to be
      // about half: a single pole a couple of kHz down barely dims anything.
      toneA = sample * (1 - coefficient) + toneA * coefficient;
      toneB = toneA * (1 - coefficient) + toneB * coefficient;
      /*
       * Three poles, not one.
       *
       * With one, this path was 30 dB down at 8 kHz and no further — enough
       * top end leaking into the slowest-decaying part of the tail to floor
       * the whole measurement. The top octave came out at 0.85 of the
       * bottom's life however hard the closing filter worked, because what
       * was left ringing up there had arrived through the bass path.
       */
      lowA = sample * (1 - lowPole) + lowA * lowPole;
      lowB = lowA * (1 - lowPole) + lowB * lowPole;
      lowC = lowB * (1 - lowPole) + lowC * lowPole;

      /*
       * The bottom put back with a longer life of its own. Bass outlives the
       * rest of a real tail, and a closing filter alone cannot say that — it
       * can only take things away.
       */
      data[i] =
        toneB * fade(t, rt.mid) +
        lowC * 3.2 * (fade(t, rt.low) - fade(t, rt.mid));
    }

    // The walls, on top of the tail rather than filtered with it: a discrete
    // reflection has not been in the air long enough to have lost its top.
    early(data, rate, spec, random);
  }

  normalise(buffer);
  return buffer;
}

/** Scale a room so every room drives the convolver equally hard. */
function normalise(buffer: AudioBuffer): void {
  let sum = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  }
  if (sum <= 0) return;
  const by = ENERGY / Math.sqrt(sum);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i] *= by;
  }
}

/**
 * A room of a given length, for callers who have a tail length and not much
 * else — the Space control on a placed sound, which is one number.
 *
 * Size follows length here, because a listener turning up one control expects
 * the walls to move out as the tail grows, and a long tail in a small box is
 * a specific and unusual room rather than the obvious reading of "more".
 */
export function roomOfLength(
  ctx: BaseAudioContext,
  seconds: number,
  damping: number,
  random: () => number,
): AudioBuffer {
  const size = Math.min(1, Math.max(0, (seconds - 0.2) / 3));
  return buildRoom(
    ctx,
    { seconds, damping, size, early: 0.55 + size * 0.2 },
    random,
  );
}
