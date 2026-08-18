import type { Session } from '../session.ts';
import type { AppState } from '../store.ts';
import type { PadName } from '../types.ts';
import { button, el, setText, toggleClass } from './dom.ts';
import { createDrums, type DrumsView } from './drums.ts';
import { createGuitar } from './guitar.ts';
import { createKeys, type KeysView } from './keys.ts';
import type { View } from './view.ts';

export interface StageView extends View {
  flashPad(pad: PadName): void;
  flashKey(midi: number): void;
  /** Refresh the recording clock and size estimate. */
  tickRecording(recording: boolean, elapsed: number, sampleRate: number): void;
}

/**
 * The main stage: one instrument at a time, with the recording readout pinned
 * to the corner and a power overlay until the audio engine has been started.
 *
 * Only the visible instrument is in the document. The three are built once and
 * swapped, so switching views never rebuilds the 88-key bed.
 */
export function createStage(session: Session): StageView {
  const drums: DrumsView = createDrums(session);
  const keys: KeysView = createKeys(session);
  const guitar = createGuitar(session);

  const views = { drums, keys, guitar } as const;

  const recDot = el('i', { class: 'led led--md rec-readout__dot' });
  const recTime = el('div', { class: 'rec-readout__time', text: '0:00' });
  const recSize = el('div', { class: 'rec-readout__size', text: 'wav · 0.0 MB' });

  const readout = el('div', { class: 'rec-readout' }, [
    el('div', { class: 'rec-readout__head' }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
        recDot,
        el('div', { style: { fontSize: '11px', fontWeight: '500', color: 'var(--txt-2)' }, text: 'Rec' }),
      ]),
      el('div', { class: 'rec-readout__tag', text: 'Memory' }),
    ]),
    recTime,
    recSize,
  ]);

  const power = button(
    { class: 'power', title: 'Start the audio engine', on: { click: () => session.powerUp() } },
    [
      el('div', { style: { textAlign: 'center' } }, [
        el('div', { class: 'power__ring' }, [el('i', { class: 'power__bar' })]),
        el('div', { class: 'power__title', text: 'Power up' }),
        el('div', { class: 'power__hint', text: 'click to start the audio engine' }),
      ]),
    ],
  );

  const root = el('main', { class: 'stage' }, [drums.el, readout, power]);
  let mounted: View = drums;

  return {
    el: root,
    update(state: AppState, previous: AppState | null) {
      const next = views[state.view];
      if (next !== mounted) {
        root.replaceChild(next.el, mounted.el);
        mounted = next;
      }
      next.update(state, previous);

      power.style.display = state.ready ? 'none' : '';
      toggleClass(recDot, 'is-live', state.recording);
      if (!state.recording && previous?.recording) {
        setText(recTime, '0:00');
        setText(recSize, 'wav · 0.0 MB');
      }
    },
    flashPad: (pad) => drums.flash(pad),
    flashKey: (midi) => keys.flash(midi),
    tickRecording(recording, elapsed, sampleRate) {
      if (!recording) return;
      const minutes = Math.floor(elapsed / 60);
      const seconds = String(Math.floor(elapsed % 60)).padStart(2, '0');
      setText(recTime, `${minutes}:${seconds}`);
      // Stereo 16-bit: four bytes per frame.
      setText(recSize, `wav · ${((elapsed * sampleRate * 4) / 1048576).toFixed(1)} MB`);
    },
  };
}
