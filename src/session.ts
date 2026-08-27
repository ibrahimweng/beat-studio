import { AudioEngine, type AudioEngineOptions } from './audio/engine.ts';
import { Recorder } from './audio/recorder.ts';
import { Transport } from './audio/transport.ts';
import { BANK_KEYS, CHORDS, G_TUNING, LANES, PAD_MIDI } from './constants.ts';
import { encodeMidi } from './export/midi.ts';
import { encodeMp3 } from './export/mp3.ts';
import { fileStem, saveBlob } from './export/save.ts';
import { encodeWav } from './export/wav.ts';
import type { CueSource } from './timeline/types.ts';
import { blankPattern, seedPattern, togglePatternStep } from './pattern.ts';
import { loadSaved, saveState } from './persist.ts';
import { Store, clampBpm, initialState } from './store.ts';
import type {
  BankKey,
  LaneKey,
  Metro,
  NoteEvent,
  NoteKind,
  PadName,
  Pattern,
  Take,
} from './types.ts';

/** Visual feedback the session asks the UI to perform. */
export interface UiEffects {
  flashPad(pad: PadName): void;
  flashLane(lane: LaneKey): void;
  flashKey(midi: number): void;
  movePlayhead(step: number): void;
  hidePlayhead(): void;
  flashTake(id: string, seconds: number): void;
}

const NO_EFFECTS: UiEffects = {
  flashPad: () => {},
  flashLane: () => {},
  flashKey: () => {},
  movePlayhead: () => {},
  hidePlayhead: () => {},
  flashTake: () => {},
};

export type ExportKind = 'wav' | 'mp3' | 'midi';

/**
 * Everything the interface can ask the instrument to do.
 *
 * The session owns state, audio and the clock, and is the only place they meet.
 * Views read from the store and call methods here; they never reach into the
 * engine themselves.
 */
export class Session {
  readonly store = new Store(initialState());
  readonly engine: AudioEngine;
  readonly recorder: Recorder;
  readonly transport: Transport;

  /** Set by the app once the interface exists. */
  effects: UiEffects = NO_EFFECTS;

  constructor(options: AudioEngineOptions = {}) {
    this.engine = new AudioEngine(options);
    this.recorder = new Recorder(this.engine);
    this.transport = new Transport(this.engine, {
      bpm: () => this.store.state.bpm,
      steps: () => this.store.state.steps,
      pattern: () => this.pattern(),
      metro: () => this.store.state.metro,
      onLaneHit: (lane, time) => {
        this.recorder.log(lane.midi, time, 0.12, 0.95, 9);
        this.transport.atTime(time, () => {
          this.effects.flashPad(lane.pad);
          this.effects.flashLane(lane.key);
        });
      },
      onStep: (step, time) => {
        this.transport.atTime(time, () => this.effects.movePlayhead(step));
      },
      onLoop: (count, time) => this.#onLoop(count, time),
    });

    this.engine.onEngineName = (engineName) => this.store.set({ engineName });
    this.recorder.onTake = (take) => this.#landTake(take);
    this.recorder.onProblem = (status) => this.store.set({ status, recording: false });

    const saved = loadSaved();
    if (saved) {
      this.store.set({ banks: saved.banks, bpm: saved.bpm, bank: saved.bank });
    } else {
      const banks = { ...this.store.state.banks, A: seedPattern() };
      this.store.set({ banks });
    }
  }

  get state() {
    return this.store.state;
  }

  pattern(): Pattern {
    return this.store.state.banks[this.store.state.bank];
  }

  #persist(): void {
    const { banks, bpm, bank } = this.store.state;
    saveState({ banks, bpm, bank });
  }

  // ---------- power and views ----------

  /** Start the audio engine. Must be called from a user gesture. */
  powerUp(): void {
    this.engine.start();
    this.store.set({ ready: true });
  }

  setView(view: 'drums' | 'keys' | 'guitar'): void {
    this.store.set({ view, mode: 'play' });
  }

  setMode(mode: 'play' | 'sound-design'): void {
    if (mode === 'sound-design') this.stopAll();
    this.store.set({ mode });
  }

  setDock(dock: 'seq' | 'takes'): void {
    this.store.set({ dock });
  }

  // ---------- transport ----------

  togglePlay(): void {
    if (this.store.state.playing) this.stopTransport();
    else this.startTransport();
  }

  startTransport(): void {
    this.powerUp();
    if (this.store.state.playing) return;
    this.transport.start();
    this.store.set({ playing: true });
  }

  stopTransport(): void {
    this.transport.stop();
    this.effects.hidePlayhead();
    this.store.set({ playing: false });
  }

  /** Stop everything, including a capture in progress. */
  stopAll(): void {
    if (this.store.state.recording) this.toggleRecord();
    this.stopTransport();
  }

  setBpm(value: number): void {
    this.store.set({ bpm: clampBpm(value) });
    this.#persist();
  }

  nudgeBpm(delta: number): void {
    this.setBpm(this.store.state.bpm + delta);
  }

  cycleSteps(): void {
    this.store.set({ steps: this.store.state.steps === 16 ? 32 : 16, status: null });
  }

  setMetro(metro: Metro): void {
    this.store.set({ metro });
  }

  setLoops(loops: number): void {
    this.store.set({ loops });
  }

  toggleCountIn(): void {
    this.store.set({ countIn: !this.store.state.countIn });
  }

  toggleSustain(): void {
    this.store.set({ sustain: !this.store.state.sustain });
  }

  nudgeOctave(delta: number): void {
    const octave = Math.max(0, Math.min(7, this.store.state.octave + delta));
    this.store.set({ octave });
  }

  // ---------- pattern ----------

  setBank(bank: BankKey): void {
    if (!BANK_KEYS.includes(bank)) return;
    this.store.set({ bank, status: null });
    this.#persist();
  }

  toggleStep(lane: LaneKey, step: number): void {
    const { bank, banks } = this.store.state;
    const next = togglePatternStep(banks[bank], lane, step);
    this.store.set({ banks: { ...banks, [bank]: next }, status: null });
    this.#persist();

    // Audition the hit that was just switched on.
    if (next[lane][step]) {
      const definition = LANES.find((l) => l.key === lane);
      if (definition) this.engine.drum(definition.pad, undefined, 0.9);
    }
  }

  clearPattern(): void {
    const { bank, banks } = this.store.state;
    this.store.set({
      banks: { ...banks, [bank]: blankPattern() },
      status: `pattern ${bank} cleared`,
    });
    this.#persist();
  }

  loadSeed(): void {
    const { bank, banks } = this.store.state;
    this.store.set({
      banks: { ...banks, [bank]: seedPattern() },
      status: `seed beat loaded into ${bank}`,
    });
    this.#persist();
  }

  // ---------- playing ----------

  /**
   * Told about every note and hit as it is played, or null when nobody is.
   *
   * Here rather than at each of the four places a note can come from — two
   * keyboard paths and two on-screen ones — because anything watching wants
   * all of them and would otherwise have to be wired into each. What listens
   * to it is the timeline's record button: armed, whatever you play lands.
   */
  #played: ((source: CueSource) => void) | null = null;

  /** Have something told about each note and hit, or pass null to stop. */
  capture(listener: ((source: CueSource) => void) | null): void {
    this.#played = listener;
  }

  hitPad(pad: PadName): void {
    this.engine.start();
    const now = this.engine.now();
    this.engine.drum(pad, now + 0.004, 1);
    this.recorder.log(PAD_MIDI[pad] ?? 38, now, 0.12, 1, 9);
    this.effects.flashPad(pad);
    this.#played?.({ kind: 'kit', name: pad });
  }

  playNote(midi: number, kind: NoteKind = 'piano'): void {
    this.engine.start();
    const { sustain } = this.store.state;
    const voice = this.engine.note(kind, midi, undefined, 0.9, sustain ? 4 : 1.6);
    this.engine.hold(midi, voice);
    this.recorder.log(
      midi,
      this.engine.now(),
      sustain ? 1.2 : 0.5,
      0.9,
      kind === 'guitar' ? 1 : 0,
    );
    this.effects.flashKey(midi);
    this.#played?.({
      kind: 'pitched',
      name: kind === 'guitar' ? 'guitar' : 'piano',
      midi,
    });
  }

  releaseNote(midi: number): void {
    this.engine.release(midi, this.store.state.sustain);
  }

  /** Pick one string at one fret. String 0 is the high E. */
  pickString(stringIndex: number, fret: number): void {
    const midi = G_TUNING[stringIndex] + fret;
    this.engine.start();
    this.engine.note('guitar', midi, undefined, 0.85, 1.4);
    this.recorder.log(midi, this.engine.now(), 0.6, 0.85, 1);
  }

  /** Strum a chord, spreading the notes so it sounds swept rather than struck. */
  strum(name: string): void {
    const chord = CHORDS.find((c) => c.name === name);
    if (!chord) return;
    this.engine.start();
    const t0 = this.engine.now() + 0.01;
    chord.notes.forEach((note, i) => {
      const at = t0 + i * 0.028;
      this.engine.note('guitar', note, at, 0.8, 1.6);
      this.recorder.log(note, at, 0.9, 0.8, 1);
    });
  }

  // ---------- recording ----------

  toggleRecord(): void {
    if (this.store.state.recording) {
      this.recorder.stop();
      this.store.set({ recording: false });
      return;
    }
    void this.#beginRecording();
  }

  async #beginRecording(): Promise<void> {
    this.powerUp();
    const { countIn, playing, bpm, takes } = this.store.state;

    // A count-in only makes sense before the clock is already running.
    if (countIn && !playing) {
      this.store.set({ status: 'counting in…' });
      await this.transport.countIn(1);
    }

    if (!this.recorder.start(bpm)) return;

    // Layered takes play underneath so the new pass can be played against them.
    for (const take of takes) {
      if (take.layered && take.buffer) this.engine.playBuffer(take.buffer);
    }

    this.store.set({ recording: true, dock: 'takes', status: 'recording…' });
    if (!this.store.state.playing) this.startTransport();
  }

  #onLoop(count: number, time: number): void {
    const { recording, loops } = this.store.state;
    if (!recording || loops <= 0 || count < loops) return;
    // Let the final bar finish sounding before the recorder closes.
    this.transport.atTime(time, () => this.toggleRecord());
  }

  #landTake(take: Take): void {
    this.store.set({
      takes: [...this.store.state.takes, take],
      status: `${take.name} captured`,
    });
  }

  playTake(id: string): void {
    const take = this.store.state.takes.find((t) => t.id === id);
    if (!take?.buffer) return;
    this.engine.playBuffer(take.buffer);
    this.effects.flashTake(id, take.dur);
  }

  toggleLayer(id: string): void {
    this.store.set({
      takes: this.store.state.takes.map((t) =>
        t.id === id ? { ...t, layered: !t.layered } : t,
      ),
    });
  }

  deleteTake(id: string): void {
    this.store.set({ takes: this.store.state.takes.filter((t) => t.id !== id) });
  }

  // ---------- export ----------

  /** The current pattern as MIDI events, used when no take exists. */
  patternEvents(): NoteEvent[] {
    const stepDur = 60 / this.store.state.bpm / 4;
    const pattern = this.pattern();
    const events: NoteEvent[] = [];
    for (let s = 0; s < this.store.state.steps; s++) {
      for (const lane of LANES) {
        if (pattern[lane.key]?.[s]) {
          events.push({ midi: lane.midi, t: s * stepDur, dur: 0.12, vel: 0.95, ch: 9 });
        }
      }
    }
    return events;
  }

  #latestTake(): Take | undefined {
    return this.store.state.takes[this.store.state.takes.length - 1];
  }

  /**
   * Export a take, or the newest one when no id is given. MIDI falls back to
   * the current step pattern so the sequencer can be exported without
   * recording anything first.
   */
  async exportTake(kind: ExportKind, id?: string): Promise<void> {
    const take = id
      ? this.store.state.takes.find((t) => t.id === id)
      : this.#latestTake();

    if (kind === 'midi') {
      const events = take ? take.events : this.patternEvents();
      const bpm = take ? take.bpm : this.store.state.bpm;
      if (!events.length) {
        this.store.set({ status: 'nothing to export as MIDI' });
        return;
      }
      const name = take ? fileStem(take.name) : `pattern-${this.store.state.bank}`;
      saveBlob(encodeMidi(events, bpm), `${name}.mid`);
      this.store.set({ status: 'MIDI exported' });
      return;
    }

    if (!take?.buffer) {
      this.store.set({ dock: 'takes', status: 'record a take first' });
      return;
    }

    const name = fileStem(take.name);
    if (kind === 'wav') {
      saveBlob(encodeWav(take.buffer), `${name}.wav`);
      this.store.set({ status: 'WAV exported' });
      return;
    }

    this.store.set({ status: 'encoding MP3…' });
    const mp3 = await encodeMp3(take.buffer);
    if (mp3) {
      saveBlob(mp3, `${name}.mp3`);
      this.store.set({ status: 'MP3 exported' });
    } else {
      saveBlob(encodeWav(take.buffer), `${name}.wav`);
      this.store.set({ status: 'MP3 encoder offline — saved WAV' });
    }
  }

  // ---------- mixer ----------

  setKnob(name: 'reverb' | 'tone', value: number): void {
    this.engine.setKnob(name, value);
  }

  setSlider(name: 'vol' | 'low' | 'mid' | 'high', value: number): void {
    this.engine.setSlider(name, value);
  }

  dispose(): void {
    this.transport.stop();
    this.engine.dispose();
  }
}
