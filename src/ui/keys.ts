import { KEY_ROWS, NAMES, PIANO_HIGH, PIANO_LOW } from '../constants.ts';
import type { Session } from '../session.ts';
import type { AppState } from '../store.ts';
import { button, el, setText } from './dom.ts';
import type { View } from './view.ts';

/** Pitch classes that have a black key to their right. */
const HAS_SHARP = [0, 2, 5, 7, 9];

export interface KeysView extends View {
  /** Light a key briefly when it is played from the computer keyboard. */
  flash(midi: number): void;
}

/** Note name with octave, e.g. 60 -> "C4". */
function noteName(midi: number): string {
  return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * The full 88-key bed, MIDI 21 to 108.
 *
 * White keys lay out in a flex row and each black key is positioned against
 * the white key to its left, which is what keeps the irregular spacing of a
 * real keyboard correct at any width.
 */
export function createKeys(session: Session): KeysView {
  /** Every playable key, white and black, for flashing. */
  const keys = new Map<number, HTMLElement>();
  /** The little letter chip on each key, for the keyboard mapping. */
  const hints = new Map<number, HTMLElement>();
  const whites: HTMLElement[] = [];

  const bindNote = (midi: number, isolate: boolean) => ({
    pointerdown: (event: PointerEvent) => {
      event.preventDefault();
      // A black key sits inside its white neighbour, so its events must not
      // reach the key underneath or both notes would sound at once.
      if (isolate) event.stopPropagation();
      session.playNote(midi);
    },
    pointerup: (event: PointerEvent) => {
      if (isolate) event.stopPropagation();
      session.releaseNote(midi);
    },
    pointerleave: () => session.releaseNote(midi),
  });

  for (let midi = PIANO_LOW; midi <= PIANO_HIGH; midi++) {
    const pitchClass = midi % 12;
    if (NAMES[pitchClass].length > 1) continue; // black keys are drawn by their neighbour

    const whiteHint = el('div', { class: 'key-white__kbd', style: { display: 'none' } });
    hints.set(midi, whiteHint);

    const children: (HTMLElement | null)[] = [
      whiteHint,
      pitchClass === 0
        ? el('div', { class: 'key-white__label', text: noteName(midi) })
        : null,
    ];

    if (HAS_SHARP.includes(pitchClass) && midi < PIANO_HIGH) {
      const sharp = midi + 1;
      const blackHint = el('div', { class: 'key-black__kbd' });
      hints.set(sharp, blackHint);
      const black = button(
        {
          class: 'key-black',
          attrs: { 'aria-label': noteName(sharp) },
          on: bindNote(sharp, true),
        },
        [blackHint],
      );
      keys.set(sharp, black);
      children.push(black);
    }

    const white = button(
      {
        class: 'key-white',
        attrs: { 'aria-label': noteName(midi) },
        on: bindNote(midi, false),
      },
      children,
    );
    keys.set(midi, white);
    whites.push(white);
  }

  const root = el('div', { class: 'piano' }, [
    el('div', { class: 'piano__header' }, [
      el('div', { class: 'micro-label', style: { fontWeight: '500' }, text: '88‑key grand' }),
      el('div', { class: 'piano__rule' }),
      el('div', { class: 'hint', text: 'rows Z–M and Q–U play the lit octaves' }),
    ]),
    el('div', { class: 'piano__scroller' }, [el('div', { class: 'piano__keybed' }, whites)]),
  ]);

  let paintedOctave = -1;

  return {
    el: root,
    update(state: AppState) {
      if (state.octave === paintedOctave) return;
      paintedOctave = state.octave;
      paintHints(hints, state.octave);
    },
    flash(midi: number) {
      const key = keys.get(midi);
      if (!key) return;
      key.classList.add('is-flash');
      window.setTimeout(() => key.classList.remove('is-flash'), 150);
    },
  };
}

/**
 * Write the computer-keyboard letters onto the two octaves currently mapped
 * and clear every other key. Runs whenever the octave changes.
 */
function paintHints(hints: Map<number, HTMLElement>, octave: number): void {
  for (const hint of hints.values()) {
    setText(hint, '');
    hint.style.display = 'none';
  }

  const base = (octave + 1) * 12;
  for (const row of KEY_ROWS) {
    row.row.split('').forEach((char, i) => {
      const hint = hints.get(base + row.oct * 12 + row.semis[i]);
      if (!hint) return;
      setText(hint, char.toUpperCase());
      hint.style.display = '';
    });
  }
}
