import type { AudioEngine } from './audio/engine.ts';
import {
  design,
  drop,
  keep,
  narrators,
  NarrateError,
  say,
  waitUntilReady,
  type Narrator,
} from './audio/narrate.ts';
import { bufferAt, decodeSample } from './audio/samples.ts';
import type { SoundDesignSession } from './sound-design-session.ts';
import { emptyVoiceover, type Store, type Voiceover as VoiceoverState } from './store.ts';
import { peaksOf } from './ui/waveform.ts';

/**
 * Putting a voice to a script.
 *
 * The third of the three sessions, and the shape is the one next door in
 * `separate-session.ts`: it owns a screen's worth of state, it makes recordings,
 * and the moment a recording exists everything else the app can do with one is
 * free. Placing a take on the timeline is `placeAsLayers` with a list of one.
 *
 * The vocabulary is deliberately not the app's other one. A `voice` here is
 * already a `VoiceSpec` — an oscillator and some numbers — so the thing that
 * speaks is a **narrator**, and what it produces is a **take**.
 *
 * What is different from every other session is that this one cannot work
 * alone. It asks a server, the server asks Gradium, and a deployment without a
 * key cannot do it at all. That is a normal state rather than a fault, so it is
 * asked once, up front, and the screen says so plainly instead of failing at a
 * press. See `audio/narrate-proxy.ts` for why the key cannot be here.
 */
export class VoiceoverSession {
  #store: Store;
  #engine: AudioEngine;
  #design: SoundDesignSession;

  /** What is sounding, so it can be stopped. */
  #playing: AudioBufferSourceNode[] = [];

  constructor(store: Store, engine: AudioEngine, design: SoundDesignSession) {
    this.#store = store;
    this.#engine = engine;
    this.#design = design;
  }

  get state(): VoiceoverState {
    return this.#store.state.voiceover;
  }

  #set(patch: Partial<VoiceoverState>): void {
    this.#store.set({ voiceover: { ...this.state, ...patch } });
  }

  /**
   * Find out whether this deployment can do it, and who can read.
   *
   * Asked once, the first time the screen is opened, because the answer decides
   * whether the screen shows a form or a sentence. A failure here is not an
   * error to show twice: `on` becomes false and the screen says what it says.
   */
  async ready(): Promise<void> {
    if (this.state.on !== null || this.state.busy) return;
    this.#set({ busy: 'finding the narrators…' });
    try {
      const found = await narrators();
      this.#set({
        busy: null,
        on: true,
        readers: found.map(asReader),
        // The first catalogue narrator, so the screen is usable without a choice.
        reader: this.state.reader ?? found.find((one) => one.stock)?.id ?? found[0]?.id ?? null,
      });
    } catch (fault) {
      this.#set({ busy: null, on: false, said: sayWhy(fault) });
    }
  }

  choose(id: string): void {
    this.#set({ reader: id, said: null });
  }

  setScript(script: string): void {
    this.#set({ script });
  }

  setLanguage(language: string): void {
    this.#set({ language });
  }

  setDescribing(describing: string): void {
    this.#set({ describing });
  }

  /**
   * Ask for some narrators from a description, and wait for them.
   *
   * Four steps where choosing from the catalogue is none, and the screen shows
   * all four rather than hiding them behind one spinner: they are sampled, they
   * take a few seconds to be made, they can each read one short line, and one of
   * them has to be kept before it can read anything longer.
   */
  async describeNarrators(): Promise<void> {
    const prompt = this.state.describing.trim();
    if (!prompt || this.state.busy) return;

    await this.#forget();
    this.#set({ busy: 'describing them…', drafts: [], said: null });
    try {
      const made = await design(prompt, this.state.language, 3);
      if (!made.length) {
        this.#set({ busy: null, said: 'Nothing came back. Try describing them another way.' });
        return;
      }
      this.#set({ busy: 'making them…', drafts: made });
      await waitUntilReady(made, (done, of) => {
        this.#set({ busy: `making them… ${done} of ${of}` });
      });
      this.#set({
        busy: null,
        drafts: made.map((one) => ({ ...one, ready: true })),
        said: 'Listen to each, then keep the one you want.',
      });
    } catch (fault) {
      this.#set({ busy: null, drafts: [], said: sayWhy(fault) });
    }
  }

  /**
   * Hear a draft say one line.
   *
   * The line is the first hundred characters of the script when there is one,
   * because auditioning on what it will actually read is the only way to choose,
   * and a hundred is all a draft is allowed. Failing that, a line that has every
   * vowel and a question in it.
   */
  async hearDraft(id: string): Promise<void> {
    if (this.state.busy) return;
    const line = (this.state.script.trim() || AUDITION).slice(0, 100);
    this.#set({ busy: 'reading it…', said: null });
    try {
      const sound = await say(line, id);
      await this.#play(sound);
      this.#set({ busy: null });
    } catch (fault) {
      this.#set({ busy: null, said: sayWhy(fault) });
    }
  }

  /** Keep a draft, which is what turns it into a narrator that can read a script. */
  async keepDraft(id: string, name: string): Promise<void> {
    if (this.state.busy) return;
    this.#set({ busy: 'keeping it…', said: null });
    try {
      const kept = await keep(id, name.trim() || this.state.describing.trim().slice(0, 60));
      // The others go, since one was chosen and holding drafts helps nobody.
      const others = this.state.drafts.filter((one) => one.id !== id);
      this.#set({
        busy: null,
        readers: [asReader(kept), ...this.state.readers],
        reader: kept.id,
        drafts: [],
        describing: '',
        said: `${kept.name} is yours now, and can read a whole script.`,
      });
      for (const one of others) void drop(one.id).catch(() => {});
    } catch (fault) {
      this.#set({ busy: null, said: sayWhy(fault) });
    }
  }

  /**
   * Read the script, and keep what comes back as a recording.
   *
   * A take is registered the instant it exists, exactly as a separated part is,
   * which is what makes placing it, exporting it and finding it in the picker
   * free rather than four more paths to keep in step. On loan until it is used —
   * somebody trying a script three times should not leave three files behind.
   */
  async read(): Promise<void> {
    const script = this.state.script.trim();
    const reader = this.state.reader;
    if (!script || !reader || this.state.busy) return;

    const ctx = this.#engine.start();
    this.#store.set({ ready: true });
    this.stop();
    this.#set({ busy: 'reading it…', said: null });

    try {
      const sound = await say(script, reader);
      /*
       * Decoded once, here, for the two numbers the rest of the app needs: how
       * long it is, so the timeline can draw it before anything is played, and
       * what it looks like, so the screen can. The header it arrives with is
       * trustworthy because the proxy mended it — see `narrate-proxy.ts`.
       */
      const buffer = await ctx.decodeAudioData(await sound.arrayBuffer());
      const name = nameFor(script, this.state.readers.find((one) => one.id === reader)?.name);
      const sampleId = this.#design.takeOnRecording({
        name,
        blob: sound,
        seconds: buffer.duration,
        tags: ['voiceover'],
        keep: false,
      });
      this.#set({
        busy: null,
        take: { sampleId, name, seconds: buffer.duration, peaks: peaksOf(buffer, PEAKS) },
        said: `${name} is ready. Place it, or read it again.`,
      });
    } catch (fault) {
      this.#set({ busy: null, said: sayWhy(fault) });
    }
  }

  /** Hear the take that came back. */
  async hear(): Promise<void> {
    const take = this.state.take;
    if (!take) return;
    const ctx = this.#engine.start();
    this.#store.set({ ready: true });
    this.stop();
    if (!(await decodeSample(take.sampleId, ctx))) return;
    const buffer = bufferAt(ctx, take.sampleId);
    if (!buffer) return;
    this.#sound(buffer);
    this.#set({ hearing: true });
  }

  stop(): void {
    for (const source of this.#playing) {
      try {
        source.stop();
      } catch {
        // Already finished, which is the state that was wanted.
      }
    }
    this.#playing = [];
    if (this.state.hearing) this.#set({ hearing: false });
  }

  /**
   * Put the take on the timeline, on a layer of its own.
   *
   * One take, one layer, which is what a voiceover is: the thing everything else
   * is balanced against. Placing it is what says it is wanted, so this is also
   * where it stops being on loan and becomes a recording like any other.
   */
  place(): void {
    const take = this.state.take;
    if (!take) return;
    this.#design.placeAsLayers([{ name: take.name, sampleId: take.sampleId }]);
    this.#set({ said: `${take.name} is on the timeline.` });
  }

  /** Clear the take and any drafts. The recordings that were used stay. */
  clear(): void {
    this.stop();
    void this.#forget();
    const { on, readers, reader } = this.state;
    this.#store.set({
      voiceover: { ...emptyVoiceover(), on, readers, reader, language: this.state.language },
    });
    this.#design.releaseLoans();
  }

  dispose(): void {
    this.stop();
  }

  /* -------------------------------------------------------------- the plumbing */

  /** Throw away drafts nobody kept, so they do not sit on the account for a month. */
  async #forget(): Promise<void> {
    for (const one of this.state.drafts) {
      // Best effort: a draft that cannot be dropped expires by itself in thirty
      // days, and saying so would be noise in front of whatever comes next.
      void drop(one.id).catch(() => {});
    }
  }

  /** Play a blob straight through, for a draft nobody has registered. */
  async #play(sound: Blob): Promise<void> {
    const ctx = this.#engine.start();
    this.#store.set({ ready: true });
    this.stop();
    this.#sound(await ctx.decodeAudioData(await sound.arrayBuffer()));
  }

  /** Send one buffer to the engine's cue bus, so it is heard like everything else. */
  #sound(buffer: AudioBuffer): void {
    const ctx = this.#engine.start();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.#engine.cueDestination);
    source.onended = () => {
      this.#playing = this.#playing.filter((one) => one !== source);
      if (!this.#playing.length && this.state.hearing) this.#set({ hearing: false });
    };
    source.start();
    this.#playing.push(source);
  }
}

/** How many points a take's waveform is drawn from. */
const PEAKS = 700;

/**
 * What a draft reads when there is no script yet.
 *
 * Every vowel, a question and a full stop, because what somebody is listening
 * for is the shape of the delivery and not the words.
 */
const AUDITION = 'Good morning. Are you ready to hear how this one sounds?';

/** Turn what the client found into what the screen holds. */
function asReader(one: Narrator): {
  id: string;
  name: string;
  about: string;
  language: string | null;
  stock: boolean;
} {
  return { id: one.id, name: one.name, about: one.about, language: one.language, stock: one.stock };
}

/**
 * What to call a take.
 *
 * The first few words of the script, because that is what somebody will look for
 * in a library of them, and a row called "Voiceover 3" is a row nobody can pick
 * out. The narrator's name goes on the end for the same reason a separated part
 * carries the file it came from.
 */
function nameFor(script: string, reader: string | undefined): string {
  const words = script.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
  const short = words.length > 40 ? `${words.slice(0, 40)}…` : words;
  return reader ? `${short} · ${reader}` : short;
}

/** What went wrong, in a sentence the screen can show. */
function sayWhy(fault: unknown): string {
  if (fault instanceof NarrateError) return fault.message;
  return 'That did not work. Try again in a moment.';
}
