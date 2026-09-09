/**
 * Finding the hits in a drum part, and saying which drum each one is.
 *
 * `listen.ts` already finds the sounds in a recording and does it well. This
 * exists because a drum part asks it two questions it was not built to answer.
 *
 * The first is masking. That finder treats a rise soon after a bigger one as part
 * of the bigger one, which is right for a recording where a hit has a body and
 * then a brighter part of itself coming through — and wrong for a beat, where a hat
 * a quarter of a second after a snare is a hat. Measured on a plain pattern of
 * four kicks, three snares and seven hats, it found ten of the fourteen, and every
 * one it missed was a hat shortly after a snare.
 *
 * The second is coincidence, and it matters more. A kick and a hat on the same
 * eighth are one rise in one spectrogram, so a finder working on the whole
 * spectrum reports one hit — and one hit goes into one file, taking the other drum
 * with it. That is not a detail: a kick and a hat together is the commonest thing
 * in a beat.
 *
 * Both fall out of looking for rises in three bands separately. A hat's rise is
 * small against a snare's overall and large against a snare in the top of the
 * spectrum, so nothing masks it. And a kick and a hat at the same moment are a
 * rise at the bottom and a rise at the top, which is two hits, because that is
 * what they are.
 *
 * What the bands do *not* decide is which drum a hit is. That was the first
 * version and it is wrong in a way worth writing down: the bands are different
 * widths, seven bins at the bottom against four hundred and fifty at the top, so
 * whichever way the rises are scaled to compare them, some drum comes out in the
 * wrong band. Totals put a snare in the top band, because a snare has more of its
 * magnitude above three kilohertz than in the middle. Averages per bin put a snare
 * in the bottom band, because a little low body over seven bins beats a lot of
 * rattle over a hundred and thirty. Both were measured and both got the snare
 * wrong.
 *
 * So the bands find hits and the spectrum names them. Which drum it is comes from
 * the shares of the whole spectrum at the attack, asked as an ordered set of
 * questions rather than as a largest-of-three — see {@link kindOf}.
 *
 * Nothing here touches the page.
 */

import { analyse, magnitudes } from './stft.ts';

/** The three bands a rise is looked for in, in hertz. */
export const BANDS = [
  { id: 'low', from: 40, to: 200 },
  { id: 'mid', from: 200, to: 3300 },
  { id: 'high', from: 3300, to: 14000 },
] as const;

export type BandId = (typeof BANDS)[number]['id'];

/** The five things a hit in a drum part can be. */
export type DrumKind = 'kick' | 'snare' | 'tom' | 'hat' | 'cymbal';

/** Two rises in one band closer together than this are one hit. */
const APART = 0.06;

/** How far either side the moving threshold looks, in seconds. */
const AROUND = 0.4;

/**
 * How far above its surroundings a rise has to stand, above the loudest rise in
 * its own band, and above the loudest rise anywhere.
 *
 * All three, because each on its own fails. A moving average alone reads a quiet
 * passage as full of events, since everything in it stands above its neighbours. A
 * share of the band's own loudest alone lets a band with nothing in it report the
 * noise in it as hits — a tom has no top at all, so any wobble up there is a
 * hundredth of nothing and passes. A share of the loudest rise anywhere is the
 * floor that catches that, and it is why there are three.
 */
const OVER_AROUND = 1.5;
const OVER_OWN_BAND = 0.04;
const OVER_ANYTHING = 0.02;

/**
 * How long a rise casts a shadow over what follows it in the same band, and how
 * much of it the next one has to be.
 *
 * Within one band a real second hit is comparable in strength to the first, so
 * requiring half of it separates a strike from its own tail. Measured on this
 * app's own crash, the finder reported eleven hits for one strike before this.
 */
const SHADOW = 0.25;
const SHADOW_SHARE = 0.5;

/**
 * How much a band's level has to have grown for a rise to be a new hit.
 *
 * The last of the guards, and the one that finally settled a cymbal. A crash's
 * decay is noise, and noise rises again and again as it fades — every one of those
 * rises stands above its surroundings and every one is a decent fraction of the
 * one before. What none of them does is make the band louder than it was a moment
 * ago, because the band is fading. A hit does.
 */
const NEW_LEVEL = 1.25;
const NEW_LEVEL_BACK = 0.03;

/** Rises in different bands this close together are the same moment. */
const TOGETHER = 0.04;

/** Where a band's ring is taken to have stopped, as a share of its own peak. */
const STOPPED_AT = 0.08;

/** How long a hit may be reckoned to ring for, in seconds. */
const RINGS_AT_MOST = 3;

/**
 * How long the shares of the spectrum are read over, in seconds.
 *
 * The whole hit rather than the front of it, capped at the next moment. Reading
 * four windows was the first version and it puts a kick in with the snares: the
 * beater click is the front of a kick, so over forty milliseconds a kick is
 * thirty six hundredths air, against sixteen over its whole length. Every kick came
 * back a snare, and a kick with a hat over it came back a snare as well.
 */
const SHARE_FOR = 0.2;

/** How many windows the peak of a band is looked for over. */
const PEAK_WINDOWS = 4;

/**
 * Where the four shares of the spectrum are cut, in hertz.
 *
 * The first is where a kick lives and little else does. The last is where a hat
 * lives and a snare's body does not. The two in between are a tom and a snare.
 */
const CUTS = [160, 480, 3300] as const;

/** One hit found in a drum part. */
export interface DrumHit {
  /** Seconds from the start. */
  at: number;
  /** Which band's rise this hit is. */
  band: BandId;
  /** Which drum it is. */
  kind: DrumKind;
  /** How long that band goes on ringing after it, in seconds. */
  length: number;
  /** How far the rise stood above its surroundings, as a multiple. */
  rise: number;
  /** The four shares of the whole spectrum at its attack, low to high. */
  shares: readonly [number, number, number, number];
}

/**
 * Every hit in a drum part, with the drum it is.
 *
 * Two hits at the same moment from opposite ends of the spectrum are two hits, and
 * that is the point of this. Two in the same band are one, since a drum does not
 * hit itself twice in sixty milliseconds.
 */
export function drumHits(data: Float32Array, rate: number): DrumHit[] {
  const spec = analyse(data);
  const { frames, bins, size, hop } = spec;
  if (frames < 3) return [];
  const mag = magnitudes(spec);
  const perFrame = hop / rate;

  const edges = BANDS.map((band) => ({
    from: Math.max(1, Math.floor((band.from * size) / rate)),
    to: Math.min(bins - 1, Math.ceil((band.to * size) / rate)),
  }));

  /** How much each band rose, and how loud it is, frame by frame. */
  const rises = edges.map(() => new Float64Array(frames));
  const levels = edges.map(() => new Float64Array(frames));

  for (let f = 0; f < frames; f++) {
    const row = f * bins;
    const before = (f - 1) * bins;
    for (let b = 0; b < edges.length; b++) {
      let rise = 0;
      let level = 0;
      for (let k = edges[b].from; k <= edges[b].to; k++) {
        const now = mag[row + k];
        level += now;
        if (f > 0) rise += Math.max(0, now - mag[before + k]);
      }
      rises[b][f] = rise;
      levels[b][f] = level;
    }
  }

  let anywhere = 0;
  for (const rise of rises) {
    for (const value of rise) anywhere = Math.max(anywhere, value);
  }
  if (anywhere <= 0) return [];

  const perBand = rises.map((rise, b) => peaks(rise, levels[b], perFrame, anywhere));

  /*
   * The frames where something started, and which bands said so.
   *
   * Rises within forty milliseconds of each other are one moment however many
   * bands they came from, because that is a kick and a hat played together rather
   * than a kick and then a hat.
   */
  const moments = gather(perBand, perFrame);

  const cuts = CUTS.map((hz) => Math.min(bins - 1, Math.round((hz * size) / rate)));
  const out: DrumHit[] = [];

  const shareFrames = Math.max(PEAK_WINDOWS, Math.round(SHARE_FOR / perFrame));
  for (const [index, moment] of moments.entries()) {
    const until = Math.min(
      frames,
      moment.frame + shareFrames,
      moments[index + 1]?.frame ?? frames,
    );
    const shares = sharesAt(mag, bins, moment.frame, until, cuts);
    for (const band of bandsFor(moment.rose, shares)) {
      const at = BANDS.findIndex((one) => one.id === band);
      const length = ringFor(
        levels[at],
        moment.frame,
        frames,
        perFrame,
        nextIn(moments, index, band),
      );
      out.push({
        at: moment.frame * perFrame,
        band,
        kind: kindOf(band, shares, length),
        length,
        rise: moment.over,
        shares,
      });
    }
  }
  return out;
}

/** The next moment after this one whose rise included the same band. */
function nextIn(
  moments: readonly { frame: number; rose: Set<BandId>; over: number }[],
  index: number,
  band: BandId,
): number {
  for (let at = index + 1; at < moments.length; at++) {
    if (moments[at].rose.has(band)) return moments[at].frame;
  }
  return Infinity;
}

/**
 * Which drum a hit is, from the four shares of the spectrum at its attack.
 *
 * An ordered set of questions rather than a largest-of-four, because the four are
 * not four points in a space. Is nearly all of it in the bottom two octaves? Then
 * it is a drum, and whether there is a click on the front of it says which one. Is
 * nearly all of it above three kilohertz? Then it is metal, and how long it rings
 * says which. Anything else has a body in the middle, and that is a snare.
 *
 * A largest-of-four was the first version and it puts a snare in with the hats: a
 * snare has more of its magnitude above three kilohertz, in the rattle, than it has
 * in the body everybody would name it by.
 *
 * The numbers are measured. `refine.test.ts` renders all thirteen voices of this
 * app's own drum kit, finds them the same way a recording is found, and checks
 * every one is sorted into the right family — the closest thing to ground truth
 * available without a labelled recording, since the app knows exactly what it made.
 *
 * Two of the boundaries are thin, and pretending otherwise would be the dishonest
 * part.
 *
 * A splash cymbal and a hat left open are separated here by length alone, 0.42
 * second against 0.33 as this app makes them. That will sometimes go the wrong way,
 * and there is nothing in a spectrogram that would settle it — they are the same
 * shape in every band to within a hundredth.
 *
 * A floor tom and a kick are the same shape too, and what separates them here is
 * the click: this app's kick carries a beater transient above three kilohertz and
 * its toms carry none. On a recorded kit a tom is struck with a stick and has a
 * click of its own, so a floor tom will be called a kick. Both are the low hits and
 * the mistake is a benign one; telling them apart properly needs a pitch that holds
 * rather than falls, which is a different measurement from any of these.
 */
export function kindOf(
  band: BandId,
  shares: readonly [number, number, number, number],
  length: number,
): DrumKind {
  if (band === 'low') return shares[3] > AIR_ON_A_KICK ? 'kick' : 'tom';
  if (band === 'high') return length > RINGS_LIKE_METAL ? 'cymbal' : 'hat';
  return 'snare';
}

/** How much top a low hit has to carry to be a kick rather than a tom. */
const AIR_ON_A_KICK = 0.04;

/** How long a bright hit has to ring to be a cymbal rather than a hat. */
const RINGS_LIKE_METAL = 0.18;

/**
 * Which bands a moment counts as, given what rose and what the spectrum says.
 *
 * One, or two when the spectrum genuinely has weight at both ends and both ends
 * said so. Every other pairing is one drum seen twice — a snare is loud in the
 * middle and loud in the top at the same instant, and calling that a snare and a
 * hat would invent a hat on every backbeat.
 */
function bandsFor(
  rose: ReadonlySet<BandId>,
  shares: readonly [number, number, number, number],
): BandId[] {
  const bottom = shares[0] + shares[1];
  const top = shares[3];
  const primary: BandId = bottom > MOSTLY_LOW ? 'low' : top > MOSTLY_HIGH ? 'high' : 'mid';

  /*
   * Two hits, whatever the cascade would have said on its own.
   *
   * A kick with a hat over it is not mostly low and not mostly high, so the
   * cascade calls it a snare — which is the one answer that is certainly wrong. What
   * settles it is that both ends rose and both ends carry real weight, and no
   * single drum does that.
   */
  if (bottom > BOTH_ENDS_LOW && top > BOTH_ENDS_HIGH && rose.has('low') && rose.has('high')) {
    return ['low', 'high'];
  }
  return [primary];
}

/** How much of a hit has to be at the bottom, or at the top, to be that alone. */
const MOSTLY_LOW = 0.7;
const MOSTLY_HIGH = 0.6;

/**
 * How much has to be at each end for a moment to be two hits.
 *
 * Measured against the shape of a bare kick, which carries sixteen hundredths
 * above three kilohertz on its beater click and must not come back as a kick and
 * a hat.
 */
const BOTH_ENDS_LOW = 0.3;
const BOTH_ENDS_HIGH = 0.3;

/** The four shares of the spectrum over the attack, adding to one. */
function sharesAt(
  mag: Float32Array,
  bins: number,
  frame: number,
  to: number,
  cuts: readonly number[],
): [number, number, number, number] {
  const sums = [0, 0, 0, 0];
  for (let f = frame; f < to; f++) {
    const row = f * bins;
    for (let k = 1; k < bins; k++) {
      const at = k < cuts[0] ? 0 : k < cuts[1] ? 1 : k < cuts[2] ? 2 : 3;
      sums[at] += mag[row + k];
    }
  }
  const all = sums[0] + sums[1] + sums[2] + sums[3];
  if (all <= 0) return [0, 0, 0, 0];
  return [sums[0] / all, sums[1] / all, sums[2] / all, sums[3] / all];
}

/**
 * How long a band goes on ringing after a hit, in seconds.
 *
 * Where the level first falls away, not where it last stands above the threshold.
 * The difference is everything on a busy part: taking the last frame above runs the
 * length on through every later hit that keeps the band up, and every hit in a four
 * second pattern came back two and a half seconds long — which then made every one
 * of them a cymbal.
 */
function ringFor(
  level: Float64Array,
  frame: number,
  frames: number,
  perFrame: number,
  nextFrame: number,
): number {
  let peak = 0;
  for (let f = frame; f < Math.min(frames, frame + PEAK_WINDOWS); f++) {
    peak = Math.max(peak, level[f]);
  }
  const most = Math.min(frames, nextFrame, frame + Math.round(RINGS_AT_MOST / perFrame));
  let ends = most - 1;
  for (let f = frame + 1; f < most; f++) {
    if (level[f] <= peak * STOPPED_AT) {
      ends = f;
      break;
    }
  }
  return Math.max(0.02, Math.max(1, ends - frame) * perFrame);
}

/** Rises in the three bands, gathered into moments. */
function gather(
  perBand: readonly { frame: number; over: number }[][],
  perFrame: number,
): { frame: number; rose: Set<BandId>; over: number }[] {
  const flat: { frame: number; band: BandId; over: number }[] = [];
  for (const [b, found] of perBand.entries()) {
    for (const one of found) flat.push({ frame: one.frame, band: BANDS[b].id, over: one.over });
  }
  flat.sort((a, b) => a.frame - b.frame);

  const together = Math.max(1, Math.round(TOGETHER / perFrame));
  const out: { frame: number; rose: Set<BandId>; over: number }[] = [];
  for (const one of flat) {
    const last = out[out.length - 1];
    if (last && one.frame - last.frame <= together) {
      last.rose.add(one.band);
      last.over = Math.max(last.over, one.over);
      continue;
    }
    out.push({ frame: one.frame, rose: new Set([one.band]), over: one.over });
  }
  return out;
}

/**
 * The frames where a run of rises stood out from what was around it.
 *
 * The threshold moves with the material rather than being a number picked in
 * advance, which is the same reasoning as in `listen.ts` and for the same reason: a
 * quiet passage and a loud one are both full of hits.
 */
function peaks(
  rise: Float64Array,
  level: Float64Array,
  perFrame: number,
  anywhere: number,
): { frame: number; over: number }[] {
  const frames = rise.length;
  const near = Math.max(3, Math.round(AROUND / perFrame));
  let loudest = 0;
  for (const value of rise) loudest = Math.max(loudest, value);
  if (loudest <= 0) return [];

  const out: { frame: number; over: number }[] = [];
  const apart = Math.max(1, Math.round(APART / perFrame));
  const shadow = Math.max(apart, Math.round(SHADOW / perFrame));
  const back = Math.max(1, Math.round(NEW_LEVEL_BACK / perFrame));
  let last = -shadow - 1;
  let lastValue = 0;

  for (let f = 1; f < frames - 1; f++) {
    const value = rise[f];
    if (value < rise[f - 1] || value < rise[f + 1]) continue;
    if (value < loudest * OVER_OWN_BAND) continue;
    if (value < anywhere * OVER_ANYTHING) continue;

    let sum = 0;
    const from = Math.max(0, f - near);
    const to = Math.min(frames, f + near);
    for (let j = from; j < to; j++) sum += rise[j];
    const around = sum / (to - from);
    if (value < around * OVER_AROUND) continue;

    if (f - last < apart) continue;
    // Still inside the shadow of a bigger rise in this band: part of that hit's
    // own tail rather than a hit of its own.
    if (f - last < shadow && value < lastValue * SHADOW_SHARE) continue;
    // And the band has to be louder than it was, which a fading one is not.
    const was = level[Math.max(0, f - back)];
    const now = level[Math.min(frames - 1, f + 1)];
    if (was > 0 && now < was * NEW_LEVEL) continue;

    out.push({ frame: f, over: around > 0 ? value / around : value });
    last = f;
    lastValue = value;
  }
  return out;
}
