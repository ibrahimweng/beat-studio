import type { KnobName, SliderName } from '../types.ts';
import { buildChain, type ChainSettings } from './chain.ts';
import type { RoomName } from './room.ts';

/**
 * The audio graph and everything that makes sound.
 *
 * Deliberately free of DOM access. Nothing in `audio/` reaches the page and
 * nothing in `ui/` reaches the engine, which is the rule that lets the whole
 * export path be rendered and measured in Node rather than reasoned about.
 *
 * Nothing is built until {@link start} runs, because browsers refuse to open
 * an AudioContext outside a user gesture.
 */
export class AudioEngine {
  #ctx: AudioContext | null = null;

  /** Instrument bus — everything audible enters here. */
  #inst!: GainNode;
  #master!: GainNode;

  /*
   * The mixer positions the offline renderer is handed.
   *
   * Fixed, and honestly so. There was a set of setters here and an instrument
   * inspector that drove them, and the inspector went when the app was laid
   * out like an editor: mixing is per layer now, on the timeline, where the
   * thing being mixed is. What is left is the one master chain every render
   * goes through, and it goes through the same one live, which is the point
   * of keeping the numbers in the engine rather than in the renderer.
   */
  knobs: Record<KnobName, number> = { reverb: 0.22, tone: 0.5 };

  /**
   * The space the reverb send feeds.
   *
   * A name rather than a knob because rooms do not sit on one axis — see
   * `room.ts`. Held here beside the knobs so the offline renderer is handed
   * the same one that is playing.
   */
  room: RoomName = 'hall';
  sliders: Record<SliderName, number> = { vol: 0.8, low: 0.5, mid: 0.5, high: 0.5 };

  get context(): AudioContext | null {
    return this.#ctx;
  }

  /** Current context time, or 0 before the engine starts. */
  now(): number {
    return this.#ctx ? this.#ctx.currentTime : 0;
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
    this.#inst = chain.input;
    this.#master = chain.master;

    this.#master.connect(ctx.destination);
    return ctx;
  }

  /** Let the context go, and the graph with it. */
  dispose(): void {
    if (this.#ctx) void this.#ctx.close();
    this.#ctx = null;
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
      room: this.room,
    };
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
}
