import type { AudioEngine } from './audio/engine.ts';
import { mono } from './audio/listen.ts';
import { bufferAt, decodeSample, sampleById } from './audio/samples.ts';
import { expectedSeconds, LONG_SECONDS, measured } from './audio/separate/dsp.ts';
import { drumHits } from './audio/separate/hits.ts';
import type {
  Separation,
  SeparationNotes,
  Separator,
  StemPart,
} from './audio/separate/types.ts';
import { fileStem, saveBlob } from './export/save.ts';
import { heldParts, keepParts as writeDownParts } from './keep.ts';
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
   * The file the parts came out of, kept so a stretch of it can be asked for.
   *
   * The file and not the samples. A decoded recording is four bytes a sample of
   * something already read, and holding it against the chance that somebody
   * narrows the range would put the length this screen can take straight back
   * where it was. A File is a handle to bytes on disk, and reading it a second
   * time costs a second at the front of work that takes a minute.
   */
  #file: File | null = null;

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

    const whole = await this.#decode(file);
    if (!whole) {
      this.#set({ busy: null, from: null });
      this.#store.set({ status: `${file.name} could not be read as sound` });
      return;
    }

    this.#file = file;
    this.#set({ whole: whole.duration, span: null });
    await this.#take(whole, null);
  }

  /**
   * Take the same recording apart again, between two times.
   *
   * The reason to want this is rarely tidiness. A recording longer than this can
   * hold at once is still one somebody wants the drums out of, and eight bars is
   * the part they were going to use anyway — so the length limit stops being a
   * limit on what can be worked with and becomes a limit on how much at a time.
   *
   * And a stretch often separates better than the whole. The measurements that
   * decide the split are made over everything they are given: what repeats, and
   * what sits in the middle. A chorus arriving halfway through a song moves all
   * of them, and the verse on its own is the cleaner question to ask.
   *
   * The file is read again rather than the recording being held. See {@link #file}.
   */
  async takeSpan(from: number, to: number): Promise<void> {
    const file = this.#file;
    if (!file) return;
    const was = this.state.whole;
    const start = Math.max(0, Math.min(from, was));
    const end = Math.max(start, Math.min(to, was));
    if (end - start < LEAST_SPAN) {
      this.#store.set({ status: `a stretch has to be at least ${LEAST_SPAN} seconds long` });
      return;
    }

    this.#engine.start();
    this.#store.set({ ready: true });

    // Asking for all of it is asking for no stretch at all, however it was said.
    const span = start <= 0 && end >= was ? null : { from: start, to: end };

    // The rows go, but the file does not: this is the same recording, read again.
    this.clear();
    this.#file = file;
    this.#set({ busy: 'reading the file…', from: file.name, whole: was, span });

    const whole = await this.#decode(file);
    if (!whole) {
      this.#set({ busy: null, from: null });
      this.#store.set({ status: `${file.name} could not be read as sound` });
      return;
    }
    await this.#take(span ? cut(whole, start, end) : whole, span);
  }

  /**
   * Separate what has been decoded and cut, and adopt what comes back.
   *
   * The half of taking a recording apart that does not care where the samples
   * came from, which is what lets the whole file and a stretch of it share it.
   */
  async #take(input: AudioBuffer, span: { from: number; to: number } | null): Promise<void> {
    const file = this.#file;
    if (!file) return;
    let buffer: AudioBuffer | null = input;
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

    /*
     * The recording is let go of before the parts are handed over as files.
     *
     * Handing over means a Blob is built beside the bytes it is built from, for
     * as long as that takes, and the recording is four bytes a sample of
     * something nothing needs any more. Dropping it first keeps that moment
     * below the peak the separation itself already reached, so the length this
     * will take on is decided by one number rather than two.
     */
    buffer = null;
    const stems = this.#adopt(
      done.parts,
      span ? `${file.name} ${clock(span.from)}–${clock(span.to)}` : file.name,
    );
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
    const part = this.#stem(id);
    if (!part) return;
    if (!this.#separator.refine) {
      this.#store.set({ status: 'this separator cannot go any deeper' });
      return;
    }

    this.#set({ busy: `looking inside the ${part.name.toLowerCase()}…`, progress: 0 });
    await new Promise((wake) => setTimeout(wake, 0));

    /*
     * The row itself is what goes in, and its samples come from its file.
     *
     * Going deeper needs an id, a share and some samples, and a row on this
     * screen has the first two — which is what lets a separation read back out
     * of last week's be opened like any other. See `Refinable`.
     */
    const audio = await this.#audioOf(part);
    if (!audio) {
      this.#set({ busy: null });
      this.#store.set({ status: `the ${part.name.toLowerCase()} could not be read back` });
      return;
    }

    const inside = await this.#separator.refine(
      part,
      audio,
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

  /**
   * Give a part a name of your own.
   *
   * The honest answer to "which instrument is this". The measurements can say a
   * line is bright and steady between G4 and D5, and they cannot say it is a
   * viola — that needs a model trained on instruments, which is the one thing
   * this is built not to need. The person listening knows, in a second, and this
   * is where they write it down.
   *
   * It renames the recording too, because the part and the recording are the same
   * thing under two names — placing it on the timeline puts that name on a layer,
   * and a layer called "Middle line" helps nobody.
   */
  rename(id: string, name: string): void {
    const said = name.trim().slice(0, NAME_AT_MOST);
    const stem = this.#stem(id);
    if (!stem || !said || said === stem.name) return;

    /*
     * The recording is called "<part> · <where it came from>", and only the part
     * of that is being renamed. Split on the separator this file put there rather
     * than assuming the shape of the rest: the tail can be a file name with
     * anything in it, and a stretch of time after that.
     */
    const sample = sampleById(stem.sampleId);
    const at = sample?.name.indexOf(' · ') ?? -1;
    const where = sample && at >= 0 ? sample.name.slice(at) : '';
    this.#design.renameRecording(stem.sampleId, `${said}${where}`);

    this.#set({
      stems: this.state.stems.map((one) => (one.id === id ? { ...one, name: said } : one)),
    });
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
    /*
     * Yours, not Sounds, because that is where the answers appear.
     *
     * Rebuilding writes its rows into the same list that "Take sounds out of a
     * recording" fills, and that list moved to its own panel when the Sounds
     * page was split in two. Sending somebody back to the wrong panel would
     * leave the work done and invisible.
     */
    this.#store.set({ screen: 'design', panelTab: 'yours' });
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
   * Keep these parts, so the screen is here next time.
   *
   * Off by default and a button rather than a setting, because of what it costs.
   * Four parts of a three minute track is a couple of hundred megabytes, and
   * writing that into the browser's store because somebody happened to take a
   * beat apart is not a decision to make for them — which is the whole reason
   * the parts are on loan in the first place. Pressing this is them saying they
   * want it.
   *
   * It settles every loan before it writes the screen. What is written down is
   * ids, and ids pointing at recordings nobody kept come back as a screen full
   * of rows that cannot be played.
   */
  async keepParts(): Promise<void> {
    const stems = this.state.stems;
    if (!stems.length || this.state.kept) return;

    /*
     * The recordings are written first, and waited for.
     *
     * The screen written down here is a list of recording ids, so writing it
     * before those recordings are on disk leaves a screen pointing at nothing —
     * and the next visit drops the whole separation rather than showing rows
     * that cannot be played. That is not theoretical: writing the recordings
     * used to be started and forgotten, this wrote the screen on the next line,
     * and a page reloaded in between lost the lot. It took a CI runner slow
     * enough to open the gap to show it.
     *
     * Which is also why the button only says "Kept" once this has come back:
     * the word has to mean the parts are on disk, not that a write was begun.
     */
    this.#set({ busy: 'keeping them…', progress: 0 });
    const onDisk = await this.#design.keepRecordings(stems.map((one) => one.sampleId));
    this.#set({ busy: null, progress: 1 });
    if (!onDisk) {
      this.#store.set({ status: 'these parts could not be written down — the browser store refused them' });
      return;
    }

    this.#set({ kept: true });
    writeDownParts(written(this.state));
    this.#store.set({
      status: `${stems.length} parts kept · they will be here next time`,
    });
  }

  /**
   * Put back the separation that was kept, if its recordings are still here.
   *
   * Called once, after the sample store has come back, because that is what
   * decides whether this is worth doing at all: a part whose recording is gone —
   * a library cleared, a store evicted by the browser — is a row that draws and
   * cannot be played, which is worse than an empty screen. If any part is
   * missing the whole separation is dropped rather than half of it shown.
   */
  restoreKept(): void {
    if (this.state.stems.length) return;
    const kept = readParts(heldParts());
    if (!kept) return;
    if (kept.stems.some((one) => !sampleById(one.sampleId))) {
      writeDownParts(null);
      return;
    }
    this.#set({ ...kept, kept: true });
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
    this.#file = null;
    // Whatever was kept goes with it. The recordings stay in the library, which
    // is what Forget has always meant here; what goes is the screen.
    writeDownParts(null);
    this.#store.set({ separation: { ...emptySeparation(), lean: this.state.lean } });
    // After the state is cleared, so that nothing still on screen is counted as
    // in use. See `releaseLoans`.
    this.#design.releaseLoans();
  }

  dispose(): void {
    this.stop();
  }

  /* -------------------------------------------------------------- the plumbing */

  #stem(id: string): Stem | null {
    return this.state.stems.find((one) => one.id === id) ?? null;
  }

  /**
   * Turn what the separator gave back into recordings the app can hold.
   *
   * Each part arrives already written as a file — see `written.ts` — so this
   * hands that file over rather than encoding anything, and the part lets go of
   * its bytes as it does. The waveform and the share come with it, both counted
   * while the part was being written, so nothing here reads a sample.
   */
  #adopt(parts: readonly StemPart[], from: string): Stem[] {
    const out: Stem[] = [];
    for (const part of parts) {
      const seconds = part.audio.duration;
      const sampleId = this.#design.takeOnRecording({
        name: `${part.name} · ${from}`,
        blob: part.audio.wav(),
        seconds,
        tags: ['separated', part.under ?? part.id],
        // On loan until one of them is used. Four parts of a three minute track
        // is two hundred megabytes, and writing that into the browser's store
        // before anybody has said they want any of it is slow and mostly wasted.
        keep: false,
      });
      out.push({
        id: part.id,
        name: part.name,
        about: part.about,
        under: part.under,
        sampleId,
        share: part.share,
        peaks: part.audio.peaks,
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


/**
 * The shortest stretch worth asking for.
 *
 * A guard against a typo rather than a considered minimum. A block is sixteen
 * seconds and the widest median reaches across a fifth of a second either way,
 * so a stretch of half a second is very nearly all edge — it would come back
 * looking broken, and nobody asks for it on purpose.
 */
const LEAST_SPAN = 1;

/**
 * A stretch of a recording, as a recording of its own.
 *
 * Copied rather than referred to. A subarray of the decoded file would keep the
 * whole file alive behind it, which is the thing the length limit is made of, and
 * everything downstream wants a recording that starts at zero anyway.
 */
function cut(buffer: AudioBuffer, from: number, to: number): AudioBuffer {
  const rate = buffer.sampleRate;
  const start = Math.max(0, Math.round(from * rate));
  const end = Math.min(buffer.length, Math.round(to * rate));
  const out = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: Math.max(1, end - start),
    sampleRate: rate,
  });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.getChannelData(c).set(buffer.getChannelData(c).subarray(start, end));
  }
  return out;
}

/** Minutes and seconds, for saying which stretch a part came out of. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * How long a name somebody gives a part can be.
 *
 * Long enough for "Second violins, con sordino" and short enough that the row
 * still has room for what the part is and what can be done with it.
 */
const NAME_AT_MOST = 40;

/**
 * The version stamp on a kept separation.
 *
 * Read back and checked rather than trusted. What comes out of a browser store
 * may have been written by an older version of this app, and a shape that has
 * changed since is better dropped than half understood — the alternative is a
 * screen of rows with fields missing from them.
 */
const KEPT_VERSION = 1;

/** A separation, in the shape it is written down in. */
function written(state: SeparationState): unknown {
  return {
    v: KEPT_VERSION,
    from: state.from,
    seconds: state.seconds,
    span: state.span,
    lean: state.lean,
    notes: state.notes,
    opened: state.opened,
    stems: state.stems.map((one) => ({
      ...one,
      /*
       * Three decimals on the waveform, which is not thrift for its own sake.
       * A part's peaks are seven hundred numbers, a track opened all the way is
       * eight parts, and full precision writes each one as seventeen characters
       * — ninety five kilobytes of a store that holds five megabytes, for
       * detail a tenth of a pixel high.
       */
      peaks: Array.from(one.peaks, (value) => Math.round(value * 1000) / 1000),
    })),
  };
}

/** What a kept separation puts back on the screen, or null if it cannot be read. */
type Restored = Pick<
  SeparationState,
  'from' | 'seconds' | 'span' | 'lean' | 'notes' | 'opened' | 'stems'
>;

/*
 * How long the file was is not among them, and that is not an oversight.
 *
 * It is what the stretch boxes offer to choose from, and choosing a stretch
 * needs the file itself — which is on somebody's disk and not in this browser.
 * So a separation read back out of last week comes back with the boxes gone
 * rather than with two boxes and a button that quietly does nothing. Picking
 * the file again brings them back, along with everything else.
 */

/**
 * Read a kept separation, checking as it goes.
 *
 * Anything wrong anywhere gives back nothing, rather than a screen assembled out
 * of whatever survived. A row missing its recording id or its waveform is a row
 * that draws and does nothing, and half a separation is harder to understand
 * than none.
 */
function readParts(raw: unknown): Restored | null {
  if (!raw || typeof raw !== 'object') return null;
  const held = raw as Record<string, unknown>;
  if (held.v !== KEPT_VERSION) return null;
  if (!Array.isArray(held.stems) || !held.stems.length) return null;

  const stems: Stem[] = [];
  for (const one of held.stems) {
    if (!one || typeof one !== 'object') return null;
    const stem = one as Record<string, unknown>;
    if (typeof stem.id !== 'string' || typeof stem.name !== 'string') return null;
    if (typeof stem.sampleId !== 'string' || !Array.isArray(stem.peaks)) return null;
    stems.push({
      id: stem.id,
      name: stem.name,
      about: typeof stem.about === 'string' ? stem.about : '',
      under: typeof stem.under === 'string' ? stem.under : null,
      sampleId: stem.sampleId,
      share: figure(stem.share),
      peaks: Float32Array.from(stem.peaks, (value) => figure(value)),
      seconds: figure(stem.seconds),
      deeper: stem.deeper === true,
    });
  }

  const held_span = held.span as Record<string, unknown> | null | undefined;
  return {
    from: typeof held.from === 'string' ? held.from : null,
    seconds: figure(held.seconds),
    span:
      held_span && typeof held_span === 'object'
        ? { from: figure(held_span.from), to: figure(held_span.to) }
        : null,
    lean: typeof held.lean === 'number' && held.lean >= 0 && held.lean <= 1 ? held.lean : 0.5,
    notes: readNotes(held.notes),
    opened: Array.isArray(held.opened)
      ? held.opened.filter((one): one is string => typeof one === 'string')
      : [],
    stems,
  };
}

/** What the measurements found, or nothing if that cannot be read either. */
function readNotes(raw: unknown): SeparationNotes | null {
  if (!raw || typeof raw !== 'object') return null;
  const notes = raw as Record<string, unknown>;
  return {
    loop: typeof notes.loop === 'number' && Number.isFinite(notes.loop) ? notes.loop : null,
    loopStrength: figure(notes.loopStrength),
    stereo: notes.stereo === true,
    width: figure(notes.width),
    took: figure(notes.took),
  };
}

/** A number that is really a number, or nought. */
function figure(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
