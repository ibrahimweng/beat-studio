/**
 * Recorded sound, placed on the timeline like everything else.
 *
 * Until now every sound the app could place was one it made: forty design
 * voices, a drum kit, two pitched instruments, and a pack, which is a
 * description of a sound rather than a recording of one. There was no way to
 * put an actual file on the timeline at all.
 *
 * That is the gap this fills, and it is a gap before it is a feature. A
 * synthesised palette is editable in a way a recording never is — a hit is a
 * voice and five numbers, so it can be lengthened, tuned, put in another room
 * and stacked — but there are sounds nobody synthesises convincingly, and the
 * answer to those has always been to record them. Both belong in the same
 * timeline, mixed through the same chain, exported in the same file.
 *
 * A recording goes through everything a placed sound goes through: its level,
 * its room, its push, where it lands, and the layer's automation over the top.
 * The two things it cannot do are the two a recording never could. Tune moves
 * it the way a sampler does, by playing it faster or slower, so pitch and
 * length go together. Length decides how much of it is heard, not how long it
 * takes: a recording stretched to twice its length is a job for a phase
 * vocoder and sounds like one.
 *
 * ---
 *
 * Held by id rather than in the description, which matters more than it looks.
 * A {@link VoiceSpec} is plain data — that is what lets it be written to a
 * patch file, saved in a session and rendered offline — and an AudioBuffer in
 * one would end all three. So a spec names a recording and this is where the
 * audio for that name lives, exactly as `pack.ts` holds the sounds a pack's
 * specs name.
 */

/**
 * Where a recording came from, and what may be done with it.
 *
 * Not decoration. A library assembled from Freesound is a mix of licences —
 * CC0 asks for nothing, CC-BY requires the author be credited wherever the
 * work is used, and some sounds are non-commercial only. The BBC archive is
 * personal, educational and research use only, whatever it is mixed into.
 * Someone laying four hundred effects against a client's video cannot hold
 * that in their head, and an app that drops the information on import has
 * made the obligation impossible to meet rather than removed it.
 *
 * So it travels with the sound, and {@link creditLine} can write it out.
 */
export interface Credit {
  /** Who made it. */
  author?: string;
  /** The licence, as the archive names it. */
  licence?: string;
  /** Where it came from, to find it again and to link it. */
  url?: string;
  /** Which archive. */
  from?: string;
}

/** A recording the app has been given, and what is known about it. */
export interface Sample {
  /** How a spec names it. Stable for as long as the sample exists. */
  id: string;
  /** What to call it on screen. */
  name: string;
  /** Seconds. */
  duration: number;
  /** The file it arrived as, for keeping it between visits. */
  blob: Blob;
  /** Who to credit, if anyone. */
  credit?: Credit;
  /**
   * What it is, for finding it again.
   *
   * Taken from the folders it sat in, because that is where a sound library
   * keeps its categories: a file at `Foley/Doors/oak-slam.wav` is already
   * filed under doors by whoever built the archive, and throwing that away on
   * import means asking someone to re-file four hundred sounds by hand.
   */
  tags?: readonly string[];
}

/**
 * What a Freesound download is called, and what that tells us.
 *
 * Freesound names every download `<id>__<username>__<name>`, which carries the
 * author and a permanent link without needing the API or the readme that comes
 * with a pack. A library assembled by hand from the site therefore arrives
 * already knowing who to credit, which is the difference between attribution
 * being automatic and being a chore nobody does.
 *
 * The licence is not in the name, so it stays unset: Freesound is a mix of
 * CC0, CC-BY and non-commercial, and guessing which would be worse than
 * admitting the file did not say.
 */
const FREESOUND = /^(\d+)__([^_]+(?:_[^_]+)*?)__(.+)$/;

export function creditFromName(path: string): { name: string; credit?: Credit } {
  const file = path.split('/').pop() ?? path;
  const stem = file.replace(/\.[^.]+$/, '');
  const found = FREESOUND.exec(stem);
  if (!found) return { name: stem.slice(0, 60) };
  return {
    name: found[3].replace(/[_-]+/g, ' ').trim().slice(0, 60),
    credit: {
      author: found[2],
      url: `https://freesound.org/s/${found[1]}/`,
      from: 'Freesound',
    },
  };
}

/** The folders a file sat in, as what it is. */
export function tagsFromPath(path: string): string[] {
  return path
    .split('/')
    .slice(0, -1)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0 && part.length < 32 && part !== '.');
}

/**
 * Whether a licence asks to be credited.
 *
 * Written as "does it need attribution" rather than "is it CC0", because the
 * first version tested the start of the string for `cc0` and Freesound writes
 * it as "Creative Commons 0" — so every public domain sound in the library was
 * about to be listed as owing a credit it does not owe. Matching anywhere, and
 * on all the spellings the two archives actually use.
 */
function owesCredit(licence: string): boolean {
  if (!licence.trim()) return true;
  return !/(cc-?0|creative commons 0|public ?domain|no rights reserved)/i.test(licence);
}

/**
 * One line of credit, or nothing when none is owed.
 *
 * CC0 and public domain ask for nothing, so they produce no line: a credits
 * file padded with sounds that did not need crediting is one nobody reads.
 * A sound whose licence was never recorded does produce one, because an
 * unknown licence is a reason to check rather than a reason to assume.
 */
export function creditLine(sample: Sample): string | null {
  const credit = sample.credit;
  if (!credit) return null;
  const licence = credit.licence ?? '';
  if (!owesCredit(licence)) return null;
  const parts = [sample.name];
  if (credit.author) parts.push(`by ${credit.author}`);
  if (licence) parts.push(`(${licence})`);
  if (credit.from) parts.push(`— ${credit.from}`);
  if (credit.url) parts.push(credit.url);
  return parts.join(' ');
}

/**
 * The decoded audio, by id.
 *
 * Separate from the list above because it is the one part that cannot be
 * written down: it is made again by decoding the blob, and it is made lazily,
 * because decoding needs an audio context and a browser will not give one
 * until something has been clicked.
 */
const audio = new Map<string, AudioBuffer>();

/** What the app knows about, in the order it was given. */
let held: Sample[] = [];

/** Every recording available to be placed. */
export function samples(): readonly Sample[] {
  return held;
}

export function sampleById(id: string): Sample | null {
  return held.find((s) => s.id === id) ?? null;
}

/** The decoded audio for a recording, or null if it has not been decoded yet. */
export function sampleBuffer(id: string): AudioBuffer | null {
  return audio.get(id) ?? null;
}

/**
 * Take on a recording.
 *
 * The duration comes from the decoded audio when there is any and from what
 * was written down otherwise, because a sample restored from last time is
 * known about long before it is decoded and the timeline needs its length to
 * draw it.
 */
export function addSample(sample: Sample, buffer: AudioBuffer | null): void {
  if (buffer) audio.set(sample.id, buffer);
  const at = held.findIndex((s) => s.id === sample.id);
  if (at >= 0) held[at] = sample;
  else held = [...held, sample];
}

export function forgetSample(id: string): void {
  audio.delete(id);
  held = held.filter((s) => s.id !== id);
}

/** Everything, for starting a fresh set. */
export function setSamples(list: readonly Sample[]): void {
  held = [...list];
  for (const id of [...audio.keys()]) {
    if (!held.some((s) => s.id === id)) audio.delete(id);
  }
}

/**
 * Decode a recording, if it has not been already.
 *
 * `ctx` is the live audio context when there is one, so the decoded buffer
 * comes out at the rate everything else plays at and nothing has to be
 * resampled later. There is not always one: a browser withholds an audio
 * context until something has been clicked, and an export is a click on a
 * button that never starts the engine. So a throwaway offline context stands
 * in — `decodeAudioData` needs no gesture — which is the difference between
 * exporting a piece and exporting a hole where its recordings were.
 *
 * Measured before that fallback existed: a fresh page, place a recording,
 * press export, and the file came out silent while the same piece played
 * correctly, because playing had started the engine and exporting had not.
 *
 * Anything the browser cannot decode is reported rather than thrown: a file
 * that turns out not to be audio is a thing that happens, and it should say
 * so and leave everything else alone.
 */
export async function decodeSample(
  id: string,
  ctx: BaseAudioContext | null,
): Promise<boolean> {
  if (audio.has(id)) return true;
  const sample = sampleById(id);
  if (!sample) return false;
  const into = ctx ?? new OfflineAudioContext(1, 1, 48000);
  try {
    const buffer = await into.decodeAudioData(await sample.blob.arrayBuffer());
    audio.set(id, buffer);
    // What was written down when the file arrived can be wrong — a restored
    // sample carries whatever was measured then — so the decoded audio wins.
    addSample({ ...sample, duration: buffer.duration }, buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * A recording, at the rate a rendering context wants it.
 *
 * An `OfflineAudioContext` used for export can run at a different rate from
 * the one playback uses, and a buffer belongs to the rate it was decoded at.
 * Resampling here rather than letting the graph do it, because a buffer made
 * for the wrong rate plays at the wrong pitch and the graph says nothing.
 */
export function bufferAt(ctx: BaseAudioContext, id: string): AudioBuffer | null {
  const source = audio.get(id);
  if (!source) return null;
  if (Math.abs(source.sampleRate - ctx.sampleRate) < 1) return source;

  const step = source.sampleRate / ctx.sampleRate;
  const frames = Math.max(1, Math.round(source.length / step));
  const out = ctx.createBuffer(source.numberOfChannels, frames, ctx.sampleRate);
  for (let c = 0; c < source.numberOfChannels; c++) {
    const from = source.getChannelData(c);
    const to = out.getChannelData(c);
    for (let i = 0; i < frames; i++) {
      // Straight between the two nearest, which is enough for a rate change
      // of a few per cent and is what the graph would have done anyway.
      const at = i * step;
      const a = Math.floor(at);
      const b = Math.min(source.length - 1, a + 1);
      const mix = at - a;
      to[i] = from[a] * (1 - mix) + from[b] * mix;
    }
  }
  return out;
}
