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
 * The sound design button stays even though it is now the only screen, and it
 * does something: it goes back to the moment list and puts the panel back at
 * the top. That is what somebody expects from the lit thing in the top corner,
 * and it was worth fixing rather than removing, because a button with a
 * pointer cursor and a hover state that answers a click with nothing is worse
 * than no button at all.
 */
export interface RailOptions {
  onHelp: () => void;
  /** Back to the moment list, and back to the top of the panel. */
  onHome?: () => void;
}

export function createRail(session: Session, options: RailOptions = { onHelp: () => {} }): View {
  const engineLed = el('i', { class: 'led led--lg' });

  const soundDesign = button(
    {
      class: 'rail__btn is-active',
      title: 'Sound design — back to what the video suggests',
      attrs: { 'aria-label': 'Sound design, back to the moment list', 'aria-current': 'page' },
      dataset: { marker: 'true' },
      on: { click: () => options.onHome?.() },
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
