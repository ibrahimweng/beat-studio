/**
 * Taking one part further: which drum each hit is, and which line each note is.
 *
 * The four parts in `dsp.ts` are as far as three readings of a spectrogram can
 * get. This is the second level, and it works differently: instead of dividing
 * every cell by a measurement, it finds the *things* in a part — the hits in the
 * drums, the held lines in what is left — describes each one, and divides the
 * cells between those descriptions.
 *
 * That is a real distinction and it is why this is a separate file. A measurement
 * has an answer for every cell whether or not anything is happening there.  A
 * description does not: what no hit and no line accounts for goes to a part
 * called Rest, and how much ends up in Rest is the most honest single number
 * about how well this worked.
 *
 * Done on demand rather than always. Most of the time somebody wants the drums,
 * and working out which of them is the snare costs as much again as separating
 * the mix did.
 */

import { NAMES as PITCH_NAMES } from '../../constants.ts';
import { mono } from '../listen.ts';
import { energyOf, inBlocks, type Block, type HowFinely } from './blocks.ts';
import { BANDS, drumHits, type BandId, type DrumHit, type DrumKind } from './hits.ts';
import { binHz, HOP, SIZE } from './stft.ts';
import type { PartAudio, Progress, Refinable, StemPart } from './types.ts';

/* ---------------------------------------------------------------- the drums */

const DRUM_ORDER: readonly DrumKind[] = ['kick', 'snare', 'tom', 'hat', 'cymbal'];

const DRUM_NAMES: Record<DrumKind, string> = {
  kick: 'Kick',
  snare: 'Snare',
  tom: 'Toms',
  hat: 'Hats',
  cymbal: 'Cymbals',
};

const DRUM_ABOUT: Record<DrumKind, string> = {
  kick: 'The low hits: nearly all of their weight under a couple of hundred hertz',
  snare: 'Hits with a body and a rattle over it, in the middle of the spectrum',
  tom: 'Tuned hits that ring: lower than a snare, longer than a kick',
  hat: 'Short and bright, almost all of it above three kilohertz',
  cymbal: 'Bright and long: crashes, rides, and a hat left open',
};

/**
 * How long a hit is taken to go on ringing, from the length that was measured.
 *
 * An exponential decay reaching about sixty two decibels down in `length`
 * seconds has a time constant of `length` over 62 divided by 8.686, so this is
 * that arithmetic rather than a tuned number. Sixty two decibels is where the
 * app's own length control puts the end of a sound, which is worth matching: a
 * hit taken out of a recording and a hit the app makes should mean the same thing
 * by the word.
 */
const DECAY_OVER = 62 / 8.686;

/**
 * The shortest a hit's decay may be reckoned to be, as a share of a window.
 *
 * A closed hat is over in seventy milliseconds, which at this hop is under two
 * frames — and a window is four hops wide, so however short the hit really is the
 * spectrogram has smeared it over four frames. A prediction shorter than the
 * window cannot claim its own smear, and what it does not claim goes to Rest.
 *
 * This is reasoning about the transform rather than a measurement: on the plain
 * pattern in `refine.test.ts` the split comes out the same either way, because a
 * hat there has nothing else competing for the top of the spectrum. It is kept
 * because on material where something else is up there, the difference is which of
 * the two gets the cell.
 */
const AT_LEAST_WINDOWS = 1;

/** How far back a hit before the block can still be ringing into it. */
const RINGS_FOR = 4;

/**
 * Split a drum part into the kick, the snare, the toms, the hats and the
 * cymbals.
 *
 * Every hit is found, described, and then predicted: a hit is taken to be the
 * spectrum measured at its own attack, weighted towards the band it was found in,
 * decaying at its own measured rate. Those predictions are what the cells are
 * divided between, and whatever they do not account for goes to Rest.
 *
 * The alternative — cutting the part into time slices, one per hit — was the first
 * thought and is worse in a way that matters. A hat ringing under a kick is in the
 * same slice as the kick, so it goes into the kick's file. Predicting each hit's
 * own spectrum is what lets two hits at the same moment come apart at all.
 */
export async function refineDrums(
  part: Refinable,
  audio: AudioBuffer,
  onStep?: Progress,
): Promise<StemPart[]> {
  const rate = audio.sampleRate;
  const hits = drumHits(mono(audio), rate);
  if (!hits.length) return [];

  const kinds = hits.map((hit) => hit.kind);
  // Only the kinds that are actually in this part, so a pattern with no toms in
  // it does not come back with an empty toms file.
  const present = DRUM_ORDER.filter((kind) => kinds.includes(kind));
  if (!present.length) return [];

  const channels = Math.min(2, audio.numberOfChannels);
  const inside = await inBlocks(
    audio,
    channels,
    present.length + 1,
    (block) => divideByHits(block, hits, kinds, present, rate),
    onStep,
    'reading the drums',
  );

  const counted = present.map((kind) => kinds.filter((one) => one === kind).length);
  const shareOf = sharesWithin(part, inside, audio, channels);

  const parts: StemPart[] = present.map((kind, at) => ({
    id: `${part.id}.${kind}`,
    name: DRUM_NAMES[kind],
    about: `${DRUM_ABOUT[kind]} · ${counted[at]} hit${counted[at] === 1 ? '' : 's'}`,
    under: part.id,
    audio: inside[at],
    share: shareOf(at),
  }));
  parts.push({
    id: `${part.id}.rest`,
    name: 'Rest',
    about: 'What no hit accounted for: the room, the bleed, and anything missed',
    under: part.id,
    audio: inside[present.length],
    share: shareOf(present.length),
  });
  return parts;
}

/**
 * How much of the spectrum a hit found in one band claims.
 *
 * Not only its own band. A kick has harmonics well above two hundred hertz and a
 * cymbal has a low body, so a hit confined to the band it was found in would leave
 * most of itself in Rest. But not evenly either, because claiming the whole
 * spectrum is what puts a coincident kick and hat back into one file.
 *
 * So: all of its own band, and a taper across an octave either side down to a
 * fraction. The fraction is what decides a cell both of them want, and since the
 * masks are worked out against what is actually there, a kick with nothing above
 * a kilohertz claims nothing there however generous its taper.
 */
const OUTSIDE_SHARE = 0.12;
const TAPER_OCTAVES = 1.5;

function bandWeights(band: BandId, bins: number, size: number, rate: number): Float32Array {
  const edge = BANDS.find((one) => one.id === band) ?? BANDS[0];
  const out = new Float32Array(bins);
  const fade = (away: number): number => {
    // A raised cosine over an octave and a half, in octaves, so the handover is
    // even in pitch rather than in hertz.
    const along = Math.min(1, Math.max(0, away / TAPER_OCTAVES));
    return OUTSIDE_SHARE + (1 - OUTSIDE_SHARE) * (0.5 + 0.5 * Math.cos(Math.PI * along));
  };
  for (let k = 0; k < bins; k++) {
    const hz = Math.max(1, binHz(k, size, rate));
    if (hz >= edge.from && hz <= edge.to) out[k] = 1;
    else if (hz < edge.from) out[k] = fade(Math.log2(edge.from / hz));
    else out[k] = fade(Math.log2(hz / edge.to));
  }
  return out;
}

/**
 * Divide a block's cells between the hits that are sounding in it.
 *
 * A hit is predicted as the spectrum measured at its own attack, weighted towards
 * its own band, decaying at its own measured rate. Everything the predictions do
 * not account for is Rest, and the shares add to one because Rest is defined as
 * the difference rather than as a part in its own right: where the predictions
 * come to more than there is sound, they are scaled back between themselves and
 * Rest is nothing.
 */
function divideByHits(
  block: Block,
  hits: readonly DrumHit[],
  kinds: readonly DrumKind[],
  present: readonly DrumKind[],
  rate: number,
): Float32Array[] {
  const { mag, frames, bins, from, specs } = block;
  const cells = frames * bins;
  const masks = present.map(() => new Float32Array(cells));
  const rest = new Float32Array(cells);
  const perFrame = HOP / rate;
  const size = specs[0].size;

  const weights = new Map<BandId, Float32Array>();
  for (const band of BANDS) weights.set(band.id, bandWeights(band.id, bins, size, rate));

  /*
   * Which hits reach into this block, and where their attack falls in it.
   *
   * A hit that started before the block can still be ringing through it, so the
   * search reaches back a few seconds. Its attack frame then comes out negative,
   * which is correct and is what the decay is measured from — cutting it off at the
   * block edge would restart every ringing cymbal at full level on every seam.
   */
  const sounding: { at: number; tau: number; part: number; band: BandId }[] = [];
  for (const [index, hit] of hits.entries()) {
    if (hit.at > block.to / rate) break;
    if (hit.at + hit.length < from / rate - RINGS_FOR) continue;
    const part = present.indexOf(kinds[index]);
    if (part < 0) continue;
    sounding.push({
      at: (hit.at * rate - from) / HOP,
      tau: Math.max(AT_LEAST_WINDOWS * (size / HOP), hit.length / DECAY_OVER / perFrame),
      part,
      band: hit.band,
    });
  }
  if (!sounding.length) {
    // Nothing is sounding, so all of it is Rest. Which is the truth: this is a
    // gap between hits.
    rest.fill(1);
    return [...masks, rest];
  }

  /*
   * Each hit's own spectrum, read at its attack and leaning on its own band.
   *
   * The loudest of the three frames from the attack on, rather than the attack
   * frame alone, because a window straddling the onset holds as much of the
   * silence before it as of the hit.
   */
  const spectra = sounding.map((hit) => {
    const out = new Float32Array(bins);
    const weight = weights.get(hit.band) as Float32Array;
    const first = Math.max(0, Math.round(hit.at));
    for (let f = first; f < Math.min(frames, first + 3); f++) {
      const row = f * bins;
      for (let k = 0; k < bins; k++) out[k] = Math.max(out[k], mag[row + k]);
    }
    for (let k = 0; k < bins; k++) out[k] *= weight[k];
    return out;
  });

  const predicted = new Float32Array(bins);
  const shares = new Float32Array(sounding.length);
  for (let f = 0; f < frames; f++) {
    const row = f * bins;
    predicted.fill(0);
    let any = false;
    for (let h = 0; h < sounding.length; h++) {
      const since = f - sounding[h].at;
      // A frame before the attack, allowing one for the window straddling it.
      if (since < -1) {
        shares[h] = 0;
        continue;
      }
      const level = Math.exp(-Math.max(0, since) / sounding[h].tau);
      shares[h] = level;
      if (level > 1e-4) any = true;
    }
    if (!any) {
      for (let k = 0; k < bins; k++) rest[row + k] = 1;
      continue;
    }

    for (let h = 0; h < sounding.length; h++) {
      const level = shares[h];
      if (level <= 1e-4) continue;
      const own = spectra[h];
      for (let k = 0; k < bins; k++) predicted[k] += own[k] * level;
    }

    for (let k = 0; k < bins; k++) {
      const here = mag[row + k];
      const claimed = predicted[k];
      if (claimed <= 1e-20) {
        rest[row + k] = 1;
        continue;
      }
      // Never more than there is: where the predictions overshoot they are
      // scaled back between themselves and Rest gets nothing.
      const scale = Math.min(1, here / claimed) / claimed;
      let given = 0;
      for (let h = 0; h < sounding.length; h++) {
        const level = shares[h];
        if (level <= 1e-4) continue;
        const mine = spectra[h][k] * level * scale;
        masks[sounding[h].part][row + k] += mine;
        given += mine;
      }
      rest[row + k] = Math.max(0, 1 - given);
    }
  }

  return [...masks, rest];
}

/**
 * What share of the whole recording each piece of a part holds.
 *
 * Of the recording, not of the part it came out of, and the difference is the
 * kind of thing that reads as nonsense on screen: the drums holding seven per
 * cent of a track with the toms inside them holding sixty five. Both numbers were
 * true and they were shares of different things. Every number in the tree now
 * means the same thing, so a part and everything inside it come to the same total.
 */
function sharesWithin(
  part: Refinable,
  inside: readonly PartAudio[],
  audio: AudioBuffer,
  channels: number,
): (at: number) => number {
  // Of the samples that were handed over, rather than of a number the part is
  // carrying: those are the samples these pieces were cut out of, and a part
  // read back out of a kept separation has no number to carry.
  const total = energyOf(audio, channels);
  return (at) => (total > 0 ? part.share * (inside[at].energy / total) : 0);
}

/* ------------------------------------------------------------- the tonal part */

/**
 * A longer window for following lines than for anything else here.
 *
 * Four times the usual, which puts the bins six hertz apart rather than
 * twenty three. See `HowFinely` in `blocks.ts` for what the short window did to a
 * steady tone at a hundred and fifty hertz.
 */
const FOR_LINES: HowFinely = { size: SIZE * 4, hop: HOP * 4 };

/**
 * The register a line is in, which is what the lines are named by.
 *
 * Not "the violin". Nothing here recognises an instrument, and labelling a line
 * with a name it cannot support would be the one dishonest thing in this folder.
 * What it can say is where a line sits and how long it went on for, and a
 * separate file per register is what makes a melody that sits above the chords
 * come out on its own.
 *
 * The two boundaries are middle C and the C above it, which are notes rather than
 * round numbers of hertz. That is not decoration: pitch is searched a semitone at
 * a time, so a boundary between two semitones puts a line one step either side of
 * it into a different file depending on which step the tracker happened to settle
 * on. Measured, a tone at 900 hertz landed on 848 or 898 from one run to the next,
 * either side of a boundary that had been set at 850.
 *
 * Each part still says the range it actually holds, which is the useful number:
 * "held notes from G4 to D5" says more than the name of the file it is in.
 */
const REGISTERS = [
  { id: 'low', name: 'Low line', below: 261.63 },
  { id: 'middle', name: 'Middle line', below: 523.25 },
  { id: 'high', name: 'High line', below: Infinity },
] as const;

/**
 * The lowest and highest pitch a line is looked for at, in hertz.
 *
 * On the equal-tempered grid rather than at a round number, which matters
 * because the steps below are semitones counted from here. Starting at eighty
 * hertz puts every step between two real notes — measured, a tone at 392 hertz,
 * which is G4 exactly, came back as F♯4, because the nearest step to it was
 * 382.5 and that rounds down. E2 is 440 divided by two, five times, and then
 * down a minor third, so every step from it is a note somebody could name.
 */
const PITCH_FROM = 440 * Math.pow(2, -32 / 12);
const PITCH_TO = 440 * Math.pow(2, 24 / 12);

/**
 * How finely pitch is searched: steps per octave.
 *
 * A semitone, matched to how finely the spectrum can actually be read. Half
 * semitones were tried first and are worse than useless: two neighbouring
 * candidates land in the same bins, so the evidence for them is identical, and
 * peak-picking over a flat run is decided by whatever noise is in it.
 */
const PER_OCTAVE = 12;

/**
 * How many harmonics of a candidate pitch are added up, and how much each counts.
 *
 * One over the harmonic number. This is the whole of the octave problem: a
 * candidate an octave below a real note borrows that note's harmonics as its
 * own even numbers, so it always scores something, and how much depends entirely
 * on how fast the weights fall away. With weights falling by a tenth each time —
 * which was the first version — a tone at 150 hertz scored 0.435 and the octave
 * below it scored 0.379, a margin of fifteen per cent that any noise closes. With
 * one over the harmonic number they are 0.375 and 0.1875, exactly two to one.
 */
const HARMONICS = 6;

/**
 * How present a candidate's own fundamental has to be, against its strongest
 * harmonic.
 *
 * The weights above make the octave below a note score half of it, which is
 * enough on a clean tone and not enough in a mix. This is the second guard: a
 * pitch whose own fundamental is nearly absent, while its harmonics are loud, is
 * not a note — it is the note above it, seen from underneath.
 */
const OWN_FUNDAMENTAL = 0.15;

/** How many lines can sound at once. */
const AT_ONCE = 3;

/** How long a line has to hold to count as one, in frames. */
const HOLDS_FOR = 8;

/** How far a line may move between frames and still be the same line, in steps. */
const MOVES_BY = 2;

/** How wide a harmonic's claim on the spectrum is, in bins. */
const CLAIM_WIDE = 1.5;

/**
 * How far either side of a step's own frequency a harmonic is looked for.
 *
 * Half a step, in proportion, which is what makes the grid cover the whole range
 * rather than fifty six points in it. A fixed neighbourhood of a bin or two was
 * the first version and it works at the bottom and fails at the top: at 150 hertz
 * a semitone is nine hertz, or a bin and a half, so a note between two steps is
 * still caught by both. At 900 hertz a semitone is fifty two hertz, or nine bins,
 * and a note between two steps is caught by neither. Measured, a steady tone at
 * 900 hertz was not found at all while one at 150 was found immediately.
 */
const HALF_STEP = Math.pow(2, 1 / (2 * PER_OCTAVE)) - 1;

/** The bins a harmonic of a step could be in, given that. */
function reachFor(bin: number, bins: number): { from: number; to: number } {
  const away = Math.max(1, bin * HALF_STEP);
  return { from: Math.max(1, Math.floor(bin - away)), to: Math.min(bins - 1, Math.ceil(bin + away)) };
}

/**
 * The frequency of a peak, to better than a bin.
 *
 * A parabola through the peak and its two neighbours, which is the standard way of
 * reading a maximum that falls between two samples. It is here for one reason:
 * what a line is called. The grid is a semitone and a note can be a quarter tone
 * off it, so the step a line settles on is not its pitch — measured, a tone at 150
 * hertz settled on 146.8 or 155.6 from one run to the next, which is D3 or D♯3 for
 * the same note. The bins are five and a half hertz apart at this window, which is
 * not enough on its own either. Between the two, the reported note is right.
 */
function peakHz(
  mag: Float32Array,
  row: number,
  bin: number,
  bins: number,
  size: number,
  rate: number,
): number {
  if (bin <= 0 || bin >= bins - 1) return (bin * rate) / size;
  const before = mag[row + bin - 1];
  const here = mag[row + bin];
  const after = mag[row + bin + 1];
  const curve = before - 2 * here + after;
  const shift = curve < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (before - after)) / curve)) : 0;
  return ((bin + shift) * rate) / size;
}

/** The strongest bin in a run, which is where the harmonic actually is. */
function loudestIn(mag: Float32Array, row: number, from: number, to: number): { at: number; value: number } {
  let at = from;
  let value = -1;
  for (let k = from; k <= to; k++) {
    if (mag[row + k] > value) {
      value = mag[row + k];
      at = k;
    }
  }
  return { at, value };
}

/**
 * Split what is left into the lines that are in it.
 *
 * Held notes are found by looking for pitches whose harmonics are all present,
 * followed from frame to frame while they hold, and then each one claims its own
 * harmonics back out of the spectrum. Lines are grouped by register rather than
 * kept separately, because a line's identity has to be the same in every block
 * for the files to mean anything, and "the third strongest line in this sixteen
 * seconds" is not the same thing as "the third strongest line in the next
 * sixteen".
 *
 * What this does and does not do. A melody sitting above a bed of chords comes
 * out on its own, which is the case it is here for. Two instruments playing in
 * the same register do not, and two playing the same note never will — they share
 * the same harmonics, and there is nothing in one spectrogram that says which of
 * them a given one belongs to.
 */
export async function refineTonal(
  part: Refinable,
  audio: AudioBuffer,
  onStep?: Progress,
): Promise<StemPart[]> {
  const channels = Math.min(2, audio.numberOfChannels);
  const seen: Line[] = REGISTERS.map(() => ({
    frames: 0,
    low: Infinity,
    high: 0,
    bright: 0,
    weight: 0,
    turns: 0,
    last: 0,
    up: null,
  }));

  const inside = await inBlocks(
    audio,
    channels,
    REGISTERS.length + 1,
    (block) => divideByLines(block, seen),
    onStep,
    'following the lines',
    FOR_LINES,
  );

  const perFrame = FOR_LINES.hop / audio.sampleRate;
  const shareOf = sharesWithin(part, inside, audio, channels);

  const parts: StemPart[] = [];
  REGISTERS.forEach((register, at) => {
    const held = seen[at];
    // A register nothing was found in is left out rather than written empty.
    if (!held.frames) return;
    parts.push({
      id: `${part.id}.${register.id}`,
      name: register.name,
      about:
        `Held notes from ${noteFor(held.low)} to ${noteFor(held.high)}, ` +
        `sounding for ${(held.frames * perFrame).toFixed(1)}s in total · ` +
        soundsLike(held, held.frames * perFrame, audio.duration),
      under: part.id,
      audio: inside[at],
      share: shareOf(at),
    });
  });
  if (!parts.length) return [];

  parts.push({
    id: `${part.id}.rest`,
    name: 'Rest',
    about: 'What no line accounted for: noise, decays, and anything too short to follow',
    under: part.id,
    audio: inside[REGISTERS.length],
    share: shareOf(REGISTERS.length),
  });
  return parts;
}

/**
 * What a line sounds like, said from what was measured of it.
 *
 * Not what instrument it is. That needs a model trained on instruments, which is
 * the one thing this whole folder is built not to need, and a guess dressed up
 * as a label would be worse than no label — somebody would believe it. What can
 * be measured honestly is how bright the line is and whether its pitch is
 * steady, and both are useful for the actual job, which is deciding what to call
 * it. The name is the person's to give; this is the evidence for giving it.
 *
 * Missing on purpose is how each note starts. Struck or plucked against bowed or
 * blown is the strongest cue of the three, and it cannot be had here: lines are
 * followed through a window four times the usual length, which puts a frame every
 * forty three milliseconds, and the difference between a plucked attack and a
 * bowed one is most of one frame. It would be a coin toss with a confident name
 * on it.
 */
function soundsLike(line: Line, sounding: number, seconds: number): string {
  const centroid = line.weight > 0 ? line.bright / line.weight : 1;
  const colour = centroid < WARM ? 'nearly a pure tone' : centroid < BRIGHT ? 'warm' : 'bright';

  /*
   * A register that sounded for longer than the recording had two lines in it.
   *
   * Exact rather than a threshold, which is why it is asked first. Every other
   * reading here describes one line and none of them mean anything about two: a
   * pitch jumping between a pair of notes turns round on nearly every frame,
   * which looks exactly like a very fast waver and is nothing of the kind.
   *
   * Measured on a tone with three harmonics, whose second and third were tracked
   * as lines of their own and landed in the same register: it turned 23 times a
   * second, against 15.3 for the fastest vibrato anybody plays. Those two are too
   * close to separate. The sounding time was 8.1 seconds of a four second
   * recording, which is not close at all.
   */
  if (sounding > seconds * MORE_THAN_ONE) return `${colour} — and more than one line at once`;

  const turns = sounding > 0 ? line.turns / sounding : 0;
  return turns > A_WAVER_A_SECOND ? `${colour}, with a waver in the pitch` : `${colour}, and steady`;
}

/**
 * Where the average harmonic has to sit for a line to read as warm, then bright.
 *
 * Measured on tones built to be unambiguous: a sine comes out at 1.00, three
 * harmonics falling as one over h at 1.61, and six of them — which is a sawtooth,
 * and sounds like one — at 2.41.
 */
const WARM = 1.4;
const BRIGHT = 2.2;

/**
 * How many times a second a pitch has to turn round to read as a waver.
 *
 * Measured: vibrato at five and a half hertz turns 10.4 times a second and at
 * eight hertz, which is as fast as anybody plays one, 15.3. A melody stepping
 * every half second turns 0.4 times a second, and a held tone does not turn at
 * all. Four is in the gap and nowhere near either edge of it.
 */
const A_WAVER_A_SECOND = 4;

/**
 * How much longer than the recording a register can sound before it is two lines.
 *
 * Not one, because the blocks overlap by half a second in sixteen and a note
 * running through a join is counted in both — measured, a single held tone comes
 * out at 1.03 times the length of the recording. A register holding two lines
 * came out at 2.03, so anything in between is a line and a half, which is not a
 * thing that exists.
 */
const MORE_THAN_ONE = 1.3;

/** The nearest note name to a frequency, for saying where a line sat. */
export function noteFor(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return '—';
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${PITCH_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * Divide a block's cells between the held lines in it, by register.
 *
 * `seen` is written into as it goes, so that the panel can say what register
 * each file actually holds rather than repeating the boundaries it was defined
 * by.
 */
function divideByLines(block: Block, seen: Line[]): Float32Array[] {
  const { mag, frames, bins, rate, specs } = block;
  const cells = frames * bins;
  const masks = REGISTERS.map(() => new Float32Array(cells));
  const rest = new Float32Array(cells);
  const size = specs[0].size;

  const steps = Math.round(PER_OCTAVE * Math.log2(PITCH_TO / PITCH_FROM));
  const pitchOf = (step: number): number => PITCH_FROM * Math.pow(2, step / PER_OCTAVE);

  const tracks = follow(mag, frames, bins, size, rate, steps, pitchOf);

  const claim = new Float32Array(bins);
  const belongs = new Int8Array(bins);
  for (let f = 0; f < frames; f++) {
    const row = f * bins;
    const here = tracks[f];
    if (!here.length) {
      for (let k = 0; k < bins; k++) rest[row + k] = 1;
      continue;
    }

    claim.fill(0);
    belongs.fill(-1);
    for (const step of here) {
      const nominal = pitchOf(step);
      /*
       * Where the note actually is, rather than which step it settled on.
       *
       * Both the register it goes in and the range the part reports are read from
       * this, because a step is a semitone-wide statement about a note that can be
       * a quarter tone off it — and a file called "Middle line" whose contents are
       * a semitone from what it says is worse than no label.
       */
      const own = reachFor((nominal * size) / rate, bins);
      const hz = peakHz(mag, row, loudestIn(mag, row, own.from, own.to).at, bins, size, rate);
      const at = registerOf(hz);
      const note = seen[at];
      note.frames++;
      note.low = Math.min(note.low, hz);
      note.high = Math.max(note.high, hz);
      wavered(note, hz);

      for (let h = 1; h <= HARMONICS; h++) {
        const where = (hz * h * size) / rate;
        if (where >= bins - 1) break;
        /*
         * Centred on where the harmonic actually is, not on where the grid step
         * says it should be. A note is rarely on a step — the grid is a semitone
         * and a note can be a quarter tone off it — and a claim centred on the
         * step is a claim on the bins either side of the note rather than on it.
         */
        const reach = reachFor(where, bins);
        const bin = loudestIn(mag, row, reach.from, reach.to).at;
        /*
         * Where the energy sits along the comb, counted while walking it.
         *
         * A sine has all of itself on its first harmonic and nothing above; a
         * reedy or bowed sound has as much on the third and fourth as on the
         * first. So the average harmonic number, weighted by how loud each one
         * is, is a plain measure of how bright a line is — one for a pure tone,
         * and upwards from there. It costs an add per harmonic, because the
         * loudest bin of each has already been found for other reasons.
         */
        note.bright += mag[row + bin] * h;
        note.weight += mag[row + bin];
        const first = Math.max(0, Math.floor(bin - CLAIM_WIDE));
        const last = Math.min(bins - 1, Math.ceil(bin + CLAIM_WIDE));
        for (let k = first; k <= last; k++) {
          // A raised cosine across the harmonic's width, so a bin at its edge is
          // shared rather than taken whole.
          const away = Math.abs(k - bin) / CLAIM_WIDE;
          const weight = away >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * away);
          if (weight > claim[k]) {
            claim[k] = weight;
            belongs[k] = at;
          }
        }
      }
    }

    for (let k = 0; k < bins; k++) {
      const mine = belongs[k];
      if (mine < 0 || claim[k] <= 0) {
        rest[row + k] = 1;
        continue;
      }
      masks[mine][row + k] = claim[k];
      rest[row + k] = 1 - claim[k];
    }
  }

  return [...masks, rest];
}

/**
 * What a register's line turned out to be, gathered as the blocks go past.
 *
 * Written into rather than worked out at the end, because the spectrogram it is
 * read from is thrown away one block at a time and nothing keeps the whole of it.
 */
interface Line {
  frames: number;
  low: number;
  high: number;
  /** Energy weighted by which harmonic it sat on, and the plain total. */
  bright: number;
  weight: number;
  /** How often the pitch turned round, and what it was doing when last seen. */
  turns: number;
  last: number;
  up: boolean | null;
}

/**
 * How far the pitch has to move to count as having moved.
 *
 * A tenth of a semitone. The pitch of a steady tone still wanders from frame to
 * frame by a hundredth or two, because it is read from a parabola through three
 * bins of a spectrum with noise in it, and counting that as movement would make
 * every held note look like it was wavering.
 */
const A_WAVER = 0.1;

/**
 * Count the times a line's pitch turns round.
 *
 * Vibrato and a melody both move; what tells them apart is that vibrato comes
 * back. A note played with vibrato turns round five or six times a second, and a
 * melody turns when it changes direction, which is once a bar if that. Counting
 * turns rather than movement is what separates them, and it needs nothing kept
 * except which way the line was last going.
 *
 * Two notes in the same register in the same frame confuse this, because they
 * share one counter and each looks to the other like a jump. It is left as it
 * is: a register holding two lines at once has already lost the thing this would
 * be describing.
 */
function wavered(note: Line, hz: number): void {
  if (note.last > 0) {
    const moved = Math.log2(hz / note.last) * PER_OCTAVE;
    if (Math.abs(moved) > A_WAVER) {
      const up = moved > 0;
      if (note.up !== null && note.up !== up) note.turns++;
      note.up = up;
    }
  }
  note.last = hz;
}

/** Which register a pitch falls in. */
function registerOf(hz: number): number {
  for (let at = 0; at < REGISTERS.length; at++) {
    if (hz < REGISTERS[at].below) return at;
  }
  return REGISTERS.length - 1;
}

/**
 * The pitches held from frame to frame, as a list per frame.
 *
 * Two steps. First, how much evidence there is for every candidate pitch in
 * every frame, by adding up what is at each of its harmonics — a note is not one
 * peak, it is a comb of them, and adding along the comb is what tells a
 * fundamental from its own second harmonic. Then the peaks are followed: a pitch
 * that carries on from the frame before, within a semitone, is the same line, and
 * a run too short to be a note is dropped.
 *
 * Dropping the short runs is the whole point. Every frame of every recording has
 * a strongest pitch in it, so keeping them all would put a line through the
 * noise between two notes and claim its harmonics out of the drums.
 */
function follow(
  mag: Float32Array,
  frames: number,
  bins: number,
  size: number,
  rate: number,
  steps: number,
  pitchOf: (step: number) => number,
): number[][] {
  /*
   * Which bins each step's harmonics could be in, worked out once for all frames.
   *
   * A run rather than a bin, and a run that grows with the frequency: half a step
   * either side, so that every note between two steps is caught by both of them
   * rather than by neither. See {@link HALF_STEP}.
   */
  const combs: { from: Int32Array; to: Int32Array }[] = [];
  for (let step = 0; step <= steps; step++) {
    const hz = pitchOf(step);
    const from = new Int32Array(HARMONICS);
    const to = new Int32Array(HARMONICS);
    for (let h = 1; h <= HARMONICS; h++) {
      const bin = (hz * h * size) / rate;
      if (bin >= bins - 1) {
        from[h - 1] = -1;
        continue;
      }
      const reach = reachFor(bin, bins);
      from[h - 1] = reach.from;
      to[h - 1] = reach.to;
    }
    combs.push({ from, to });
  }

  const found: number[][] = [];
  const salience = new Float64Array(steps + 1);
  for (let f = 0; f < frames; f++) {
    const row = f * bins;
    let loudest = 0;
    for (let step = 0; step <= steps; step++) {
      let sum = 0;
      let own = 0;
      let strongest = 0;
      const comb = combs[step];
      for (let h = 0; h < HARMONICS; h++) {
        if (comb.from[h] < 0) break;
        // The strongest bin in the run, so a note off the grid still adds up
        // rather than falling between two steps.
        const most = loudestIn(mag, row, comb.from[h], comb.to[h]).value;
        if (h === 0) own = most;
        strongest = Math.max(strongest, most);
        sum += most / (h + 1);
      }
      // A candidate whose own fundamental is missing is the note above it seen
      // from underneath, whatever its harmonics add up to.
      if (strongest > 0 && own < strongest * OWN_FUNDAMENTAL) sum = 0;
      salience[step] = sum;
      loudest = Math.max(loudest, sum);
    }

    const picked: number[] = [];
    if (loudest > 0) {
      // A fifth of the strongest, so a frame with one note in it does not come
      // back with three.
      const bar = loudest * 0.2;
      const peaks: { step: number; value: number }[] = [];
      for (let step = 1; step < steps; step++) {
        const value = salience[step];
        if (value < bar) continue;
        if (value < salience[step - 1] || value < salience[step + 1]) continue;
        peaks.push({ step, value });
      }
      peaks.sort((a, b) => b.value - a.value);
      for (const peak of peaks) {
        if (picked.length >= AT_ONCE) break;
        // Not within a semitone of one already taken, which would be the same
        // note twice.
        if (picked.some((step) => Math.abs(step - peak.step) <= MOVES_BY)) continue;
        picked.push(peak.step);
      }
    }
    found.push(picked);
  }

  return holding(found, frames);
}

/**
 * Only the pitches that held for long enough, frame by frame.
 *
 * A run is a pitch that carries on from the frame before within a couple of
 * steps. Runs shorter than a tenth of a second are dropped: they are the noise
 * between notes rather than notes, and a line drawn through them claims
 * harmonics out of whatever else was there.
 */
function holding(found: readonly number[][], frames: number): number[][] {
  const out: number[][] = Array.from({ length: frames }, () => []);
  const open: { step: number; since: number; at: number[] }[] = [];

  const close = (run: { since: number; at: number[] }, upTo: number): void => {
    if (upTo - run.since < HOLDS_FOR) return;
    for (let f = run.since; f < upTo; f++) out[f].push(run.at[f - run.since]);
  };

  for (let f = 0; f < frames; f++) {
    const here = [...found[f]];
    for (let i = open.length - 1; i >= 0; i--) {
      const run = open[i];
      let nearest = -1;
      let away = Infinity;
      for (const [at, step] of here.entries()) {
        const gap = Math.abs(step - run.step);
        if (gap <= MOVES_BY && gap < away) {
          away = gap;
          nearest = at;
        }
      }
      if (nearest < 0) {
        close(run, f);
        open.splice(i, 1);
        continue;
      }
      run.step = here[nearest];
      run.at.push(here[nearest]);
      here.splice(nearest, 1);
    }
    for (const step of here) open.push({ step, since: f, at: [step] });
  }
  for (const run of open) close(run, frames);

  return out;
}
