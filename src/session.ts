import { AudioEngine } from './audio/engine.ts';
import { Store, initialState, type TimeRange, type Tool } from './store.ts';

/**
 * The audio engine and the state, and the one gesture that starts them.
 *
 * This used to be everything the instruments could do: a transport, four
 * pattern banks, a recorder, notes, strums, takes and their export. All of
 * that belonged to a drum machine, and the app is not one. What is left is
 * what both halves always shared, and what {@link SoundDesignSession} is
 * built on top of.
 *
 * It stays a class rather than two loose values because the engine has a
 * lifetime: it cannot be started without a gesture and has to be let go of on
 * the way out, and something has to own that.
 */
export class Session {
  readonly store = new Store(initialState());
  readonly engine: AudioEngine;

  constructor() {
    this.engine = new AudioEngine();
  }

  get state() {
    return this.store.state;
  }

  /**
   * Which tool the pointer is holding.
   *
   * On the base session rather than the sound design one because the strip
   * that sets it is the app's own furniture, and because a tool is a property
   * of the pointer rather than of the piece: changing it is not an edit and
   * must never land on the undo stack.
   */
  setTool(tool: Tool): void {
    if (this.store.state.tool === tool) return;
    // Leaving the range tool takes the range with it. A stretch of time you
    // can no longer see the edges of is a selection that acts at a distance.
    this.store.set({ tool, range: tool === 'range' ? this.store.state.range : null });
  }

  /** The stretch of time the range tool has drawn, or null to clear it. */
  setRange(range: TimeRange | null): void {
    this.store.set({ range });
  }

  /** Start the audio engine. Must be called from a user gesture. */
  powerUp(): void {
    this.engine.start();
    this.store.set({ ready: true });
  }

  dispose(): void {
    this.engine.dispose();
  }
}
