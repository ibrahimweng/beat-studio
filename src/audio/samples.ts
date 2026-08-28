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
