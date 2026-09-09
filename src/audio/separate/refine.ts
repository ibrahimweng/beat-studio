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
import type { Progress, StemPart } from './types.ts';

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
  part: StemPart,
  rate: number,
  onStep?: Progress,
): Promise<StemPart[]> {
  const hits = drumHits(mono(part.audio), rate);
  if (!hits.length) return [];

  const kinds = hits.map((hit) => hit.kind);
  // Only the kinds that are actually in this part, so a pattern with no toms in
  // it does not come back with an empty toms file.
  const present = DRUM_ORDER.filter((kind) => kinds.includes(kind));
  if (!present.length) return [];

  const channels = Math.min(2, part.audio.numberOfChannels);
  const audio = await inBlocks(
    part.audio,
    channels,
    present.length + 1,
    (block) => divideByHits(block, hits, kinds, present, rate),
    onStep,
    'reading the drums',
  );

  const total = energyOf(part.audio, channels);
  const counted = present.map((kind) => kinds.filter((one) => one === kind).length);

  const parts: StemPart[] = present.map((kind, at) => ({
    id: `${part.id}.${kind}`,
    name: DRUM_NAMES[kind],
    about: `${DRUM_ABOUT[kind]} · ${counted[at]} hit${counted[at] === 1 ? '' : 's'}`,
    under: part.id,
    audio: audio[at],
    share: total > 0 ? energyOf(audio[at], channels) / total : 0,
  }));
  parts.push({
    id: `${part.id}.rest`,
    name: 'Rest',
    about: 'What no hit accounted for: the room, the bleed, and anything missed',
    under: part.id,
    audio: audio[present.length],
    share: total > 0 ? energyOf(audio[present.length], channels) / total : 0,
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
 */
const REGISTERS = [
  { id: 'low', name: 'Low line', below: 300 },
  { id: 'middle', name: 'Middle line', below: 850 },
  { id: 'high', name: 'High line', below: Infinity },
] as const;

/** The lowest and highest pitch a line is looked for at, in hertz. */
const PITCH_FROM = 80;
const PITCH_TO = 2100;

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
  part: StemPart,
  onStep?: Progress,
): Promise<StemPart[]> {
  const channels = Math.min(2, part.audio.numberOfChannels);
  const seen = REGISTERS.map(() => ({ frames: 0, low: Infinity, high: 0 }));

  const audio = await inBlocks(
    part.audio,
    channels,
    REGISTERS.length + 1,
    (block) => divideByLines(block, seen),
    onStep,
    'following the lines',
    FOR_LINES,
  );

  const total = energyOf(part.audio, channels);
  const perFrame = FOR_LINES.hop / part.audio.sampleRate;

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
        `sounding for ${(held.frames * perFrame).toFixed(1)}s in total`,
      under: part.id,
      audio: audio[at],
      share: total > 0 ? energyOf(audio[at], channels) / total : 0,
    });
  });
  if (!parts.length) return [];

  parts.push({
    id: `${part.id}.rest`,
    name: 'Rest',
    about: 'What no line accounted for: noise, decays, and anything too short to follow',
    under: part.id,
    audio: audio[REGISTERS.length],
    share: total > 0 ? energyOf(audio[REGISTERS.length], channels) / total : 0,
  });
  return parts;
}

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
function divideByLines(
  block: Block,
  seen: { frames: number; low: number; high: number }[],
): Float32Array[] {
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
      const hz = pitchOf(step);
      const at = registerOf(hz);
      const note = seen[at];
      note.frames++;
      note.low = Math.min(note.low, hz);
      note.high = Math.max(note.high, hz);

      for (let h = 1; h <= HARMONICS; h++) {
        const bin = (hz * h * size) / rate;
        if (bin >= bins - 1) break;
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
  // Which bin each step's harmonics land in, worked out once for all frames.
  const combs: Int32Array[] = [];
  for (let step = 0; step <= steps; step++) {
    const hz = pitchOf(step);
    const own = new Int32Array(HARMONICS);
    for (let h = 1; h <= HARMONICS; h++) {
      const bin = Math.round((hz * h * size) / rate);
      own[h - 1] = bin < bins ? bin : -1;
    }
    combs.push(own);
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
        const bin = comb[h];
        if (bin < 0) break;
        // The strongest of the bin and its two neighbours, so a note a few
        // cents off the grid still adds up rather than falling between steps.
        let most = mag[row + bin];
        if (bin > 0) most = Math.max(most, mag[row + bin - 1]);
        if (bin + 1 < bins) most = Math.max(most, mag[row + bin + 1]);
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
