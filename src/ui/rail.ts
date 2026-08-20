import type { Session } from '../session.ts';
import type { AppState } from '../store.ts';
import { button, el, setText, toggleClass } from './dom.ts';
import {
  drumsIcon,
  guitarIcon,
  keysIcon,
  sequencerIcon,
  soundDesignIcon,
  takesIcon,
  waveMark,
} from './icons.ts';
import type { View } from './view.ts';

/**
 * The left rail: instrument selection on top, dock selection below the rule,
 * and the audio-engine light at the bottom.
 */
export function createRail(session: Session, options: { onHelp: () => void } = { onHelp: () => {} }): View {
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

  const soundDesign = railButton('Sound design', soundDesignIcon(), () => session.setMode('sound-design'), true);
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

  const help = button(
    {
      class: 'rail__btn rail__help',
      title: 'How this works',
      attrs: { 'aria-label': 'Help' },
      on: { click: () => options.onHelp() },
    },
    ['?'],
  );

  const root = el('nav', { class: 'rail', attrs: { 'aria-label': 'Views' } }, [
    el('div', { class: 'rail__logo' }, [waveMark([6, 14, 9, 4], 2, 2, 3)]),
    soundDesign,
    el('div', { class: 'rail__divider' }),
    drums,
    keys,
    guitar,
    el('div', { class: 'rail__divider' }),
    seq,
    takes,
    el('div', { class: 'rail__spacer' }),
    help,
    power,
  ]);

  return {
    el: root,
    update(state: AppState) {
      const play = state.mode === 'play';
      toggleClass(soundDesign, 'is-active', state.mode === 'sound-design');
      toggleClass(drums, 'is-active', play && state.view === 'drums');
      toggleClass(keys, 'is-active', play && state.view === 'keys');
      toggleClass(guitar, 'is-active', play && state.view === 'guitar');
      toggleClass(seq, 'is-active', play && state.dock === 'seq');
      toggleClass(takes, 'is-active', play && state.dock === 'takes');

      badge.style.display = state.takes.length ? '' : 'none';
      setText(badge, String(state.takes.length));

      engineLed.style.background = state.ready ? 'var(--ac)' : 'var(--led-dead)';
    },
  };
}
