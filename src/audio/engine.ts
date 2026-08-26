import type { KnobName, NoteKind, PadName, SliderName, Voice } from '../types.ts';
import { applySettings, buildChain, type Chain, type ChainSettings } from './chain.ts';
import { click, drum, pianoSynth, pluck } from './voices.ts';

/** Sample set requested from smplr, and how it is shown in the inspector. */
const SOUNDFONT_KIT = 'FluidR3_GM';
const SOUNDFONT_LABEL = 'FluidR3 GM';

/** Optional General MIDI sample player, loaded lazily. */
interface SoundfontPlayer {
  load: Promise<unknown>;
  start(opts: { note: number; velocity: number; time: number; duration: number }): void;
}

/**
 * The audio graph and everything that makes sound.
 *
 * Deliberately free of DOM access: the engine exposes readable values such as
 * {@link peak} and the UI polls them. That keeps the mixer, meters and
 * sequencer from being tangled together the way they are in a prototype.
 *
 * Nothing is built until {@link start} runs, because browsers refuse to open an
 * AudioContext outside a user gesture.
 */
export interface AudioEngineOptions {
  /**
   * Load General MIDI samples for the pitched instruments. This fetches from a
   * third-party CDN at runtime; turning it off keeps the app entirely
   * self-contained and on the built-in synth voices.
   */
  samples?: boolean;
}

export class AudioEngine {
  #ctx: AudioContext | null = null;
  #useSamples: boolean;

  /** Instrument bus — everything audible and recordable enters here. */
  #inst!: GainNode;
  #mix!: GainNode;
  #chain: Chain | null = null;
  #master!: GainNode;
  #analyser!: AnalyserNode;
  #streamDest!: MediaStreamAudioDestinationNode;
  /** Monitor bus: audible but never recorded, so clicks stay out of takes. */
  #monitor!: GainNode;

  #meterBuffer: Uint8Array<ArrayBuffer> | null = null;

  /** Sounding synth voices, keyed by MIDI note, so key-up can release them. */
  #voices = new Map<number, Voice>();

  #sfPiano: SoundfontPlayer | null = null;
  #sfGuitar: SoundfontPlayer | null = null;

  knobs: Record<KnobName, number> = { reverb: 0.22, tone: 0.5 };
  sliders: Record<SliderName, number> = { vol: 0.8, low: 0.5, mid: 0.5, high: 0.5 };

  /** Called when the engine label changes (standby → loading → loaded). */
  onEngineName: ((name: string) => void) | null = null;

  constructor(options: AudioEngineOptions = {}) {
    this.#useSamples = options.samples ?? true;
  }

  get started(): boolean {
    return this.#ctx !== null;
  }

  /** True once sampled instruments are in place. */
  get sampled(): boolean {
    return this.#sfPiano !== null;
  }

  get context(): AudioContext | null {
    return this.#ctx;
  }

  /** Current context time, or 0 before the engine starts. */
  now(): number {
    return this.#ctx ? this.#ctx.currentTime : 0;
  }

  /** The post-master stream the recorder captures. */
  get stream(): MediaStream {
    return this.#streamDest.stream;
  }

  /**
   * Build the graph, or resume it if the browser suspended it. Safe to call on
   * every interaction — the first call does the work, later ones are cheap.
   */
  start(): AudioContext {
    if (this.#ctx) {
      if (this.#ctx.state === 'suspended') void this.#ctx.resume();
      return this.#ctx;
    }

    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.#ctx = ctx;

    // The same construction the offline renderer uses, so what is heard here
    // and what lands in an exported file cannot drift apart.
    const chain = buildChain(ctx, this.chainSettings());
    this.#chain = chain;
    this.#inst = chain.input;
    this.#mix = chain.mix;
    this.#master = chain.master;

    this.#analyser = ctx.createAnalyser();
    this.#analyser.fftSize = 1024;
    this.#streamDest = ctx.createMediaStreamDestination();
    this.#monitor = ctx.createGain();
    this.#monitor.gain.value = 0.5;

    // master -> (speakers via analyser) and (recorder)
    this.#master.connect(this.#analyser);
    this.#analyser.connect(ctx.destination);
    this.#master.connect(this.#streamDest);

    // monitor bypasses master so the metronome is heard but not captured
    this.#monitor.connect(ctx.destination);

    this.#meterBuffer = new Uint8Array(new ArrayBuffer(this.#analyser.fftSize));
    if (this.#useSamples) void this.#loadSoundfonts();
    else this.#setEngineName('built‑in voices');
    return ctx;
  }

  /** Release the context and every listener-visible resource. */
  dispose(): void {
    this.#voices.clear();
    if (this.#ctx) void this.#ctx.close();
    this.#ctx = null;
  }

  /** Where takes are played back into — post-EQ, so mixer moves apply. */
  get playbackDestination(): AudioNode {
    return this.#mix;
  }

  /** Where timeline cues are played, so they run through the whole chain. */
  get cueDestination(): AudioNode {
    return this.#inst;
  }

  /** The mixer positions, in the shape the offline renderer wants. */
  chainSettings(): ChainSettings {
    return {
      reverb: this.knobs.reverb,
      tone: this.knobs.tone,
      vol: this.sliders.vol,
      low: this.sliders.low,
      mid: this.sliders.mid,
      high: this.sliders.high,
    };
  }

  // ---------- mixer ----------

  setKnob(name: KnobName, value: number): void {
    this.knobs[name] = Math.max(0, Math.min(1, value));
    this.applyTilt();
  }

  setSlider(name: SliderName, value: number): void {
    this.sliders[name] = Math.max(0, Math.min(1, value));
    this.applyTilt();
  }

  /** Push the current mixer positions onto the live chain. */
  applyTilt(): void {
    if (this.#chain) applySettings(this.#chain, this.chainSettings());
  }

  /** Peak level of the master bus, 0..1. Returns 0 before the engine starts. */
  peak(): number {
    if (!this.#ctx || !this.#meterBuffer) return 0;
    this.#analyser.getByteTimeDomainData(this.#meterBuffer);
    let peak = 0;
    // Every fourth sample is plenty for a meter and a quarter of the work.
    for (let i = 0; i < this.#meterBuffer.length; i += 4) {
      const d = Math.abs(this.#meterBuffer[i] - 128) / 128;
      if (d > peak) peak = d;
    }
    return peak;
  }

  // ---------- playing ----------

  /** Fire a drum voice. `t` defaults to just ahead of the clock. */
  drum(pad: PadName, t?: number, vel = 1): void {
    const ctx = this.start();
    drum(ctx, this.#inst, pad, t ?? ctx.currentTime + 0.004, vel);
  }

  /**
   * Play a pitched note, preferring a sampled instrument when one has loaded.
   * Returns a releasable voice only for the built-in synth — sampled notes are
   * scheduled with a fixed duration and cannot be cut short.
   */
  note(kind: NoteKind, midi: number, t?: number, vel = 0.85, dur?: number): Voice | null {
    const ctx = this.start();
    const when = t ?? ctx.currentTime + 0.005;

    if (kind === 'piano' && this.#sfPiano) {
      this.#sfPiano.start({
        note: midi,
        velocity: Math.round(vel * 110),
        time: when,
        duration: dur ?? 2.4,
      });
      return null;
    }
    if (kind === 'guitar' && this.#sfGuitar) {
      this.#sfGuitar.start({
        note: midi,
        velocity: Math.round(vel * 105),
        time: when,
        duration: dur ?? 1.6,
      });
      return null;
    }
    if (kind === 'guitar') {
      pluck(ctx, this.#inst, midi, when, vel);
      return null;
    }
    return pianoSynth(ctx, this.#inst, midi, when, vel);
  }

  /** Track a voice so a later key-up can release it. */
  hold(midi: number, voice: Voice | null): void {
    if (voice) this.#voices.set(midi, voice);
  }

  /** Fade a held note out. Does nothing while the sustain switch is on. */
  release(midi: number, sustain: boolean): void {
    const voice = this.#voices.get(midi);
    if (!voice || sustain || !this.#ctx) return;
    this.#voices.delete(midi);
    const t = this.#ctx.currentTime;
    for (const gain of voice.gains) {
      try {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.exponentialRampToValueAtTime(0.0006, t + 0.22);
      } catch {
        // A layer whose envelope already finished throws here; nothing to do.
      }
    }
  }

  /** Metronome click on the monitor bus. */
  click(t: number, strong: boolean): void {
    if (!this.#ctx) return;
    click(this.#ctx, this.#monitor, t, strong);
  }

  /** Play a decoded take through the mix bus. */
  playBuffer(buffer: AudioBuffer): AudioBufferSourceNode {
    const ctx = this.start();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.#mix);
    src.start();
    return src;
  }

  /** Decode a recorded blob into an AudioBuffer, or null if unsupported. */
  async decode(blob: Blob): Promise<AudioBuffer | null> {
    if (!this.#ctx) return null;
    try {
      return await this.#ctx.decodeAudioData(await blob.arrayBuffer());
    } catch {
      return null;
    }
  }

  // ---------- sampled instruments ----------

  /**
   * Try to upgrade piano and guitar to General MIDI samples. The import is
   * code-split and the samples come from a network CDN, so this is strictly an
   * enhancement: if any part of it fails the built-in synth voices stay in use
   * and the app is fully playable offline.
   */
  async #loadSoundfonts(): Promise<void> {
    this.#setEngineName('loading GM samples…');

    let smplr: typeof import('smplr') | null = null;
    try {
      smplr = await import('smplr');
    } catch {
      smplr = null;
    }
    if (!smplr?.Soundfont || !this.#ctx) {
      this.#setEngineName('built‑in voices');
      return;
    }

    const load = async (instrument: string): Promise<SoundfontPlayer | null> => {
      try {
        const player = new smplr.Soundfont(this.#ctx as AudioContext, {
          instrument,
          // Pinned so the name reported in the inspector matches what loaded.
          kit: SOUNDFONT_KIT,
          destination: this.#inst,
        }) as unknown as SoundfontPlayer;
        await player.load;
        return player;
      } catch {
        return null;
      }
    };

    this.#sfPiano = await load('acoustic_grand_piano');
    this.#sfGuitar = await load('acoustic_guitar_steel');
    this.#setEngineName(this.#sfPiano ? SOUNDFONT_LABEL : 'built‑in voices');
  }

  #setEngineName(name: string): void {
    this.onEngineName?.(name);
  }
}
