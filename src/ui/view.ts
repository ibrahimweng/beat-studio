import type { AppState } from '../store.ts';

/**
 * A mounted piece of interface.
 *
 * `update` is called on every state change with the previous state alongside,
 * so a view can compare and skip work it does not need to redo.
 */
export interface View {
  el: HTMLElement;
  update(state: AppState, previous: AppState | null): void;
}
