import type { Session } from '../session.ts';
import type { AppState } from '../store.ts';
import { button, el, setText, toggleClass } from './dom.ts';
import {
  drumsIcon,
  guitarIcon,
  keysIcon,
  sequencerIcon,
  takesIcon,
  waveMark,
} from './icons.ts';
import type { View } from './view.ts';

/**
 * The left rail: instrument selection on top, dock selection below the rule,
 * and the audio-engine light at the bottom.
 */
export function createRail(session: Session): View {
  const badge = el('span', { class: 'rail__badge', text: '0' });
  const engineLed = el('i', { class: 'led led--lg' });

  const railButton = (
    label: string,
    icon: HTMLElement,
    onClick: () => void,
    marker: boolean,
  ): HTMLButtonElement =>
    button(
      {
        class: 'rail__btn',
        title: label,
        attrs: { 'aria-label': label },
        dataset: marker ? { marker: 'true' } : {},
        on: { click: onClick },
      },
      [icon],
    );

  const drums = railButton('Drums', drumsIcon(), () => session.setView('drums'), true);
  const keys = railButton('Keys', keysIcon(), () => session.setView('keys'), true);
  const guitar = railButton('Guitar', guitarIcon(), () => session.setView('guitar'), true);
  const seq = railButton('Sequencer', sequencerIcon(), () => session.setDock('seq'), false);
  const takes = railButton('Takes', takesIcon(), () => session.setDock('takes'), false);
  takes.appendChild(badge);

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
    drums,
    keys,
    guitar,
    el('div', { class: 'rail__divider' }),
    seq,
    takes,
    el('div', { class: 'rail__spacer' }),
    power,
  ]);

  return {
    el: root,
    update(state: AppState) {
      toggleClass(drums, 'is-active', state.view === 'drums');
      toggleClass(keys, 'is-active', state.view === 'keys');
      toggleClass(guitar, 'is-active', state.view === 'guitar');
      toggleClass(seq, 'is-active', state.dock === 'seq');
      toggleClass(takes, 'is-active', state.dock === 'takes');

      badge.style.display = state.takes.length ? '' : 'none';
      setText(badge, String(state.takes.length));

      engineLed.style.background = state.ready ? 'var(--ac)' : 'var(--led-dead)';
    },
  };
}
