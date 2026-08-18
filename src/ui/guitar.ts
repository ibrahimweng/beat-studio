import { CHORDS, FRET_COUNT, FRET_DOTS, G_TUNING } from '../constants.ts';
import type { Session } from '../session.ts';
import { button, el } from './dom.ts';
import type { View } from './view.ts';

/** The six strings, drawn thin and bright at the top to thick and dull below. */
const STRINGS: readonly { top: string; height: string; color: string }[] = [
  { top: '8.33%', height: '1px', color: '#e2e5e6' },
  { top: '25%', height: '1.4px', color: '#d7dadb' },
  { top: '41.6%', height: '1.9px', color: '#c8c4b6' },
  { top: '58.3%', height: '2.4px', color: '#bdb5a2' },
  { top: '75%', height: '2.9px', color: '#b2a993' },
  { top: '91.6%', height: '3.4px', color: '#a79c84' },
];

/**
 * The fretboard.
 *
 * Every cell is one string at one fret; the note it plays is the string's open
 * pitch plus the fret number, which is all a fretboard really is.
 */
export function createGuitar(session: Session): View {
  const chords = CHORDS.map((chord) =>
    button({ class: 'chord-btn', on: { click: () => session.strum(chord.name) } }, [chord.name]),
  );

  const frets = Array.from({ length: FRET_COUNT }, (_, index) => {
    const fret = index + 1;
    const cells = G_TUNING.map((_, stringIndex) =>
      button({
        class: 'fret__cell',
        attrs: { 'aria-label': `String ${stringIndex + 1}, fret ${fret}` },
        on: {
          pointerdown: (event) => {
            event.preventDefault();
            const cell = event.currentTarget as HTMLElement;
            session.pickString(stringIndex, fret);
            cell.classList.add('is-picked');
            window.setTimeout(() => cell.classList.remove('is-picked'), 160);
          },
        },
      }),
    );
    return el('div', { class: 'fret' }, [
      FRET_DOTS.includes(fret) ? el('i', { class: 'fret__dot' }) : null,
      ...cells,
    ]);
  });

  const board = el('div', { class: 'guitar__board' }, [
    el('div', { class: 'guitar__nut' }),
    el('div', { class: 'guitar__frets' }, frets),
    ...STRINGS.map((string) =>
      el('i', {
        class: 'guitar__string',
        style: { top: string.top, height: string.height, background: string.color },
      }),
    ),
  ]);

  const numbers = el(
    'div',
    { class: 'guitar__numbers' },
    Array.from({ length: FRET_COUNT }, (_, i) => el('span', { text: String(i + 1) })),
  );

  const root = el('div', { class: 'guitar' }, [
    el('div', { class: 'guitar__chords' }, [
      el('div', { class: 'micro-label', style: { fontWeight: '500', marginRight: '4px' }, text: 'Strum' }),
      ...chords,
      el('div', { class: 'topbar__spacer' }),
      el('div', { class: 'hint', text: 'click the board to pick a note' }),
    ]),
    board,
    numbers,
  ]);

  return {
    el: root,
    update() {
      // The fretboard has no state of its own.
    },
  };
}
