import { AudioEngine, type AudioEngineOptions } from './audio/engine.ts';
import { Store, initialState } from './store.ts';

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

  constructor(options: AudioEngineOptions = {}) {
    this.engine = new AudioEngine(options);
  }

  get state() {
    return this.store.state;
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
