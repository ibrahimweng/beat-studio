import type { Session } from '../session.ts';
import type { AppState } from '../store.ts';
import { button, el } from './dom.ts';
import { soundDesignIcon, waveMark } from './icons.ts';
import type { View } from './view.ts';

/**
 * The left rail: where you are, help, and the audio engine.
 *
 * It used to offer six places to go, five of which were a drum machine
 * running on bars and tempo. Somebody arriving to put sound to a video had to
 * work out which of the six was theirs before they could start, and the
 * answer was always the same one. What the instruments make is still here, in
 * the library, filed under the moment it serves.
 *
 * The sound design button stays even though it is now the only screen. It
 * says what this is, it is where the mark sits, and a rail with nothing in it
 * but a question mark and a light reads as a rail that failed to load.
 */
export function createRail(session: Session, options: { onHelp: () => void } = { onHelp: () => {} }): View {
  const engineLed = el('i', { class: 'led led--lg' });

  const soundDesign = button(
    {
      class: 'rail__btn is-active',
      title: 'Sound design',
      attrs: { 'aria-label': 'Sound design', 'aria-current': 'page' },
      dataset: { marker: 'true' },
    },
    [soundDesignIcon()],
  );

  const help = button(
    {
      class: 'rail__btn rail__help',
      title: 'How this works',
      attrs: { 'aria-label': 'Help' },
      on: { click: () => options.onHelp() },
    },
    ['?'],
  );

  const power = button(
    {
      class: 'rail__power',
      title: 'Audio engine',
      attrs: { 'aria-label': 'Start audio engine' },
      on: { click: () => session.powerUp() },
    },
    [engineLed],
  );

  const root = el('nav', { class: 'rail', attrs: { 'aria-label': 'Views' } }, [
    el('div', { class: 'rail__logo' }, [waveMark([6, 14, 9, 4], 2, 2, 3)]),
    soundDesign,
    el('div', { class: 'rail__spacer' }),
    help,
    power,
  ]);

  return {
    el: root,
    update(state: AppState) {
      engineLed.style.background = state.ready ? 'var(--ac)' : 'var(--led-dead)';
    },
  };
}
