import type { AudioEngine } from './audio/engine.ts';
import { mono } from './audio/listen.ts';
import { bufferAt, decodeSample, sampleById } from './audio/samples.ts';
import { expectedSeconds, LONG_SECONDS, measured } from './audio/separate/dsp.ts';
import { drumHits } from './audio/separate/hits.ts';
import type { Separation, Separator, StemPart } from './audio/separate/types.ts';
import { encodeWav } from './export/wav.ts';
import { fileStem, saveBlob } from './export/save.ts';
import type { SoundDesignSession } from './sound-design-session.ts';
import { emptySeparation, type Separation as SeparationState, type Stem, type Store } from './store.ts';

/**
 * Taking a beat apart, and handing the parts to the piece.
 *
 * The screen never talks to `audio/separate/` and `audio/separate/` never talks
 * to the store, which is the same rule the rest of the app is built on. This is
 * where the two meet: it decodes a file, drives the separator, turns what comes
 * back into recordings the app already knows how to handle, and holds the four
 * ways a part reaches the timeline.
 *
 * The one decision worth reading is what happens to the audio. A separated part is
 * registered as a recording the moment it is made — the same kind of recording
 * somebody drags in — rather than being held here as samples. That is what makes
 * four parts of a three minute track affordable, since the browser holds them as
 * files and decodes one when something asks to hear it, and it is what makes every
 * part placeable, exportable and findable in the picker without any of that being
 * written a second time.
 *
 * They are registered on loan, though, and not written down until one is used.
 * Four parts of a three minute track is a couple of hundred megabytes, and putting
 * all of that into the browser's own store the moment it exists — before anybody
 * has said they want any of it — is slow and mostly wasted. Placing one settles
 * it, and from then on it is a recording like any other.
 */
export class SeparateSession {
  #engine: AudioEngine;
  #store: Store;
  #design: SoundDesignSession;

  /**
   * Which separator is in use.
   *
   * One today, and the field is the reason there could be another: nothing in
   * this file names the arithmetic in `dsp.ts`, only the shape in `types.ts`.
   */
  #separator: Separator = measured;

  /**
   * The parts as the separator gave them, with their audio, for taking further.
   *
   * Held only while a separation is on screen, and only for the four: opening one
   * needs its samples again, and going back to the file to decode them would be
   * a second decode of something that was in hand a moment ago. Cleared with
   * everything else, because four AudioBuffers is the largest thing this app
   * holds and holding them for a separation nobody is looking at is how a tab
   * runs out of room.
   */
  #held = new Map<string, StemPart>();

  /** What is sounding on this screen, so it can be stopped. */
  #playing: AudioBufferSourceNode[] = [];

  constructor(engine: AudioEngine, store: Store, design: SoundDesignSession) {
    this.#engine = engine;
    this.#store = store;
    this.#design = design;
  }

  get state(): SeparationState {
    return this.#store.state.separation;
  }

  #set(patch: Partial<SeparationState>): void {
    this.#store.set({ separation: { ...this.state, ...patch } });
  }

  /**
   * Take a file apart.
   *
   * Nothing is uploaded: the browser decodes it, the app measures it, and it
   * never leaves the machine — the same as the video, and for the same reason.
   */
  async takeApart(file: File): Promise<void> {
    // A gesture has happened, so this is the moment the engine can be started —
    // and it has to be, because decoding needs a context.
    this.#engine.start();
    this.#store.set({ ready: true });

    this.clear();
    this.#set({ busy: 'reading the file…', from: file.name });

    const buffer = await this.#decode(file);
    if (!buffer) {
      this.#set({ busy: null, from: null });
      this.#store.set({ status: `${file.name} could not be read as sound` });
      return;
    }

    const seconds = buffer.duration;
    const expected = expectedSeconds(seconds);
    this.#set({
      busy: 'separating…',
      seconds,
      secondsLeft: seconds > LONG_SECONDS ? expected : null,
      progress: 0,
    });
    // A turn of the loop, so the message is on screen before the work starts.
    await new Promise((wake) => setTimeout(wake, 0));

    let done: Separation;
    try {
      done = await this.#separator.separate(
        buffer,
        { lean: this.state.lean },
        (at, of, what) => {
          const along = of > 0 ? at / of : 0;
          this.#set({
            busy: `${what}…`,
            progress: along,
            secondsLeft: seconds > LONG_SECONDS ? Math.round(expected * (1 - along)) : null,
          });
        },
      );
    } catch (fault) {
      this.#set({ busy: null, from: null, seconds: 0 });
      this.#store.set({ status: fault instanceof Error ? fault.message : 'that could not be separated' });
      return;
    }

    const stems = this.#adopt(done.parts, file.name);
    this.#set({
      busy: null,
      progress: 1,
      secondsLeft: null,
      stems,
      notes: done.notes,
      opened: [],
      chosen: stems[0]?.id ?? null,
    });
    this.#store.set({
      status:
        `${file.name} came apart into ${stems.length} parts in ` +
        `${done.notes.took.toFixed(1)}s · they add back up to the recording`,
    });
  }

  /** Take one of the parts further, into what is inside it. */
  async open(id: string): Promise<void> {
    if (this.state.opened.includes(id)) return;
    const part = this.#held.get(id);
    if (!part) return;
    if (!this.#separator.refine) {
      this.#store.set({ status: 'this separator cannot go any deeper' });
      return;
    }

    this.#set({ busy: `looking inside the ${part.name.toLowerCase()}…`, progress: 0 });
    await new Promise((wake) => setTimeout(wake, 0));

    const inside = await this.#separator.refine(
      part,
      part.audio.sampleRate,
      { lean: this.state.lean },
      (at, of, what) => {
        this.#set({ busy: `${what}…`, progress: of > 0 ? at / of : 0 });
      },
    );
    if (!inside.length) {
      this.#set({ busy: null });
      this.#store.set({ status: `nothing separable inside the ${part.name.toLowerCase()}` });
      return;
    }

    const made = this.#adopt(inside, this.state.from ?? part.name);
    // Straight after the part they came out of, which is what makes the list a
    // tree rather than a heap.
    const stems = [...this.state.stems];
    const at = stems.findIndex((one) => one.id === id);
    stems.splice(at + 1, 0, ...made);

    this.#set({ busy: null, progress: 1, stems, opened: [...this.state.opened, id] });
    this.#store.set({ status: `${part.name} came apart into ${made.length} more` });
  }

  /** Fold a part back up. Its files stay in the library; only the rows go. */
  close(id: string): void {
    if (!this.state.opened.includes(id)) return;
    this.#set({
      opened: this.state.opened.filter((one) => one !== id),
      stems: this.state.stems.filter((one) => one.under !== id),
      muted: this.state.muted.filter((one) => !one.startsWith(`${id}.`)),
      solo: this.state.solo?.startsWith(`${id}.`) ? null : this.state.solo,
      chosen: this.state.chosen?.startsWith(`${id}.`) ? id : this.state.chosen,
    });
  }

  /**
   * Arm a part, so clicking the timeline places it.
   *
   * Armed rather than played, which is the opposite of what choosing a sound in
   * the library does. A library sound is half a second long and hearing it is the
   * point of touching it; a separated part is the whole recording, and starting
   * three minutes of it every time a row is clicked would make the screen unusable.
   * Hearing one is its own button, with a way to stop.
   */
  choose(id: string): void {
    const stem = this.#stem(id);
    if (!stem) return;
    this.#set({ chosen: id });
    this.#design.setSource({ kind: 'sample', name: stem.sampleId });
  }

  /**
   * Play a part, or all of them together, from the start.
   *
   * Its own path rather than the timeline's, because these are not on the
   * timeline: they are a recording being examined, and what somebody wants here is
   * to hear one against the others. Everything already playing stops first, so
   * pressing two rows in turn compares them rather than piling them up.
   *
   * Straight into the engine's cue bus, so a part is heard through the same chain
   * as everything else and nothing has to be balanced twice.
   */
  async hear(id: string | 'all'): Promise<void> {
    const ctx = this.#engine.start();
    this.#store.set({ ready: true });
    this.stop();

    const wanted =
      id === 'all'
        ? this.listed().filter(
            (stem) =>
              !this.state.muted.includes(stem.id) &&
              (!this.state.solo || this.state.solo === stem.id),
          )
        : this.listed().filter((stem) => stem.id === id);
    if (!wanted.length) return;

    for (const stem of wanted) {
      const buffer = await this.#audioOf(stem);
      if (!buffer) continue;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.#engine.cueDestination);
      source.start();
      this.#playing.push(source);
    }
    // Only after the decoding, since a part with nothing playable in it should
    // not leave the screen saying it is playing.
    if (this.#playing.length) this.#set({ hearing: id });
  }

  /** Stop whatever is playing here. */
  stop(): void {
    for (const source of this.#playing) {
      try {
        source.stop();
      } catch {
        // Already finished, which is not a failure.
      }
      source.disconnect();
    }
    this.#playing = [];
    if (this.state.hearing !== null) this.#set({ hearing: null });
  }

  /** Silence a part while comparing, without losing it. */
  toggleMute(id: string): void {
    const muted = this.state.muted.includes(id)
      ? this.state.muted.filter((one) => one !== id)
      : [...this.state.muted, id];
    this.#set({ muted });
  }

  /** Hear one part on its own, or stop doing so. */
  toggleSolo(id: string): void {
    this.#set({ solo: this.state.solo === id ? null : id });
  }

  /** Which way the next separation leans between hits and notes. */
  setLean(lean: number): void {
    this.#set({ lean: Math.min(1, Math.max(0, lean)) });
  }

  /* ---------------------------------------------------------- handing it over */

  /**
   * The parts as the screen lists them: the four, with the children of anything
   * opened in place of it.
   *
   * The leaves of the tree, in other words, which is the set that adds back up to
   * the recording. That is why Rest is in it: leaving out the part nothing
   * accounted for would make a set of files that quietly does not sum, and the
   * one thing this whole feature can promise is that it does.
   */
  listed(): Stem[] {
    return this.state.stems.filter((stem) => !this.state.opened.includes(stem.id));
  }

  /** Put every part on a layer of its own, which is how a beat arrives. */
  placeAll(): void {
    const wanted = this.listed().filter((stem) => !this.state.muted.includes(stem.id));
    if (!wanted.length) return;
    this.#design.placeAsLayers(
      wanted.map((stem) => ({ name: stem.name, sampleId: stem.sampleId })),
    );
    this.#store.set({ screen: 'design' });
  }

  /**
   * Read one part back into the palette, as a voice and five numbers per hit.
   *
   * The thing this app is best at, and it never worked on a mix. The finder hears
   * one hit where a kick and a hat played together, and the rebuild then searches
   * for a single voice that is both. On a part that is only the kick there is one
   * sound to match and the search has a chance.
   */
  async rebuild(id: string): Promise<void> {
    const stem = this.#stem(id);
    if (!stem) return;
    const buffer = await this.#audioOf(stem);
    if (!buffer) {
      this.#store.set({ status: `${stem.name} could not be read back` });
      return;
    }
    this.#store.set({ screen: 'design', panelTab: 'sounds' });
    await this.#design.extractFromBuffer(buffer, stem.name);
  }

  /**
   * Put the armed sound on every hit in a part.
   *
   * The audio equivalent of "Find hits" on the picture: a reference beat becomes
   * a list of moments where something belongs. Read off the part rather than off
   * the mix, which is the point — the hits in a drum part are the drums, with
   * nothing else in the way of finding them.
   */
  async placeOnHits(id: string): Promise<void> {
    const stem = this.#stem(id);
    if (!stem) return;
    const buffer = await this.#audioOf(stem);
    if (!buffer) {
      this.#store.set({ status: `${stem.name} could not be read back` });
      return;
    }
    const times = drumHits(mono(buffer), buffer.sampleRate).map((hit) => hit.at);
    if (!times.length) {
      this.#store.set({ status: `no hits found in the ${stem.name.toLowerCase()}` });
      return;
    }
    this.#store.set({ screen: 'design' });
    this.#design.placeOnTimes(times, stem.name.toLowerCase());
  }

  /**
   * Write every listed part out as a file.
   *
   * They were encoded as WAV the moment they were made, so this hands over the
   * bytes that are already there rather than rendering anything again. All the
   * same length, all starting at zero, so they sit on separate tracks and stay in
   * sync — and they add back up to the recording, which is the whole claim.
   */
  saveParts(): void {
    const wanted = this.listed();
    if (!wanted.length) return;
    const stem = fileStem(this.state.from?.replace(/\.[^.]+$/, '') ?? 'separated');
    for (const one of wanted) {
      const sample = sampleById(one.sampleId);
      if (!sample) continue;
      saveBlob(sample.blob, `${stem}-${fileStem(one.name)}.wav`);
    }
    this.#store.set({ status: `${wanted.length} parts written` });
  }

  /**
   * Forget the separation.
   *
   * The parts that were used stay: placing one on the timeline is what writes it
   * down, and after that it is a recording like any other. The rest go, which is
   * the point of their being on loan — a track taken apart and not used should
   * not leave two hundred megabytes behind.
   */
  clear(): void {
    this.stop();
    this.#held.clear();
    this.#store.set({ separation: { ...emptySeparation(), lean: this.state.lean } });
    // After the state is cleared, so that nothing still on screen is counted as
    // in use. See `releaseLoans`.
    this.#design.releaseLoans();
  }

  dispose(): void {
    this.stop();
    this.#held.clear();
  }

  /* -------------------------------------------------------------- the plumbing */

  #stem(id: string): Stem | null {
    return this.state.stems.find((one) => one.id === id) ?? null;
  }

  /**
   * Turn what the separator gave back into recordings the app can hold.
   *
   * Encoded once, here, and the AudioBuffer is let go of straight after — except
   * for the four, which are kept so that opening one does not mean decoding it
   * again. Twenty four bits, matching every other file this app writes: a part is
   * something somebody will put under a voiceover, and the room underneath the
   * quiet detail is the whole reason for the depth.
   */
  #adopt(parts: readonly StemPart[], from: string): Stem[] {
    const out: Stem[] = [];
    for (const part of parts) {
      const seconds = part.audio.duration;
      const sampleId = this.#design.takeOnRecording({
        name: `${part.name} · ${from}`,
        blob: encodeWav(part.audio),
        seconds,
        tags: ['separated', part.under ?? part.id],
        // On loan until one of them is used. Four parts of a three minute track
        // is two hundred megabytes, and writing that into the browser's store
        // before anybody has said they want any of it is slow and mostly wasted.
        keep: false,
      });
      if (!part.under) this.#held.set(part.id, part);
      out.push({
        id: part.id,
        name: part.name,
        about: part.about,
        under: part.under,
        sampleId,
        share: part.share,
        peaks: peaksOf(part.audio),
        seconds,
        // The bass is the low end of what is left, and there is nothing inside
        // "the low end" to find. The other three all have things in them.
        deeper: part.under === null && part.id !== 'bass',
      });
    }
    return out;
  }

  /**
   * A part's audio, decoded from the file it was registered as.
   *
   * The engine is started here rather than assumed. Every caller is a button, so
   * there is a gesture to spend, and without one `bufferAt` has no context to
   * hand a buffer back at — which would make Rebuild and Hits quietly report that
   * a part could not be read on a page where nothing had been played yet.
   */
  async #audioOf(stem: Stem): Promise<AudioBuffer | null> {
    const held = this.#held.get(stem.id);
    if (held) return held.audio;
    const ctx = this.#engine.start();
    this.#store.set({ ready: true });
    if (!(await decodeSample(stem.sampleId, ctx))) return null;
    return bufferAt(ctx, stem.sampleId);
  }

  /** Decode a file, with a context to fall back on if the engine is asleep. */
  async #decode(file: File): Promise<AudioBuffer | null> {
    const decoded = await this.#engine.decode(file);
    if (decoded) return decoded;
    try {
      const into = new OfflineAudioContext(1, 1, 48000);
      return await into.decodeAudioData(await file.arrayBuffer());
    } catch {
      return null;
    }
  }
}

/** How many points a waveform is drawn from. */
const PEAKS = 700;

/**
 * The loudest sample in each slice of a part, for drawing it.
 *
 * Kept because the audio is not. A waveform is seven hundred numbers and the
 * sound it came from is tens of megabytes, and the screen redraws far more often
 * than anybody plays anything.
 *
 * The loudest rather than the average, because an average of a waveform is
 * roughly nothing however loud it is: a drum part drawn from its mean would be a
 * flat line with the odd bump.
 */
export function peaksOf(buffer: AudioBuffer, count = PEAKS): Float32Array {
  const out = new Float32Array(count);
  const lanes: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) lanes.push(buffer.getChannelData(c));
  const per = buffer.length / count;

  for (let at = 0; at < count; at++) {
    const from = Math.floor(at * per);
    const to = Math.min(buffer.length, Math.floor((at + 1) * per));
    let most = 0;
    for (const lane of lanes) {
      for (let i = from; i < to; i++) {
        const value = Math.abs(lane[i]);
        if (value > most) most = value;
      }
    }
    out[at] = Math.min(1, most);
  }
  return out;
}
