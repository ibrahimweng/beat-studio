import { TITLES } from '../constants.ts';
import type { Session } from '../session.ts';
import type { AppState } from '../store.ts';
import { button, el, setText, toggleClass } from './dom.ts';
import type { View } from './view.ts';

/** Title, step count, tempo, transport and the two export buttons. */
export function createTopbar(
  session: Session,
  options: { onToggleVideo: () => void; hasVideo: () => boolean } ,
): View {
  const title = el('div', { class: 'topbar__title', text: TITLES.drums });
  const stepsLabel = el('span', { text: '16 steps' });
  const bpmValue = el('div', { class: 'stepper__value', text: '92' });

  const stepsChip = button(
    { class: 'chip', title: 'Switch between 16 and 32 steps', on: { click: () => session.cycleSteps() } },
    [stepsLabel, el('span', { class: 'chip__caret' })],
  );

  const tempo = el('div', { class: 'stepper' }, [
    button(
      { class: 'stepper__btn', title: 'Slower', attrs: { 'aria-label': 'Decrease tempo' }, on: { click: () => session.nudgeBpm(-1) } },
      ['−'],
    ),
    el('div', { class: 'stepper__readout' }, [
      bpmValue,
      el('div', { class: 'stepper__unit', text: 'BPM' }),
    ]),
    button(
      { class: 'stepper__btn', title: 'Faster', attrs: { 'aria-label': 'Increase tempo' }, on: { click: () => session.nudgeBpm(1) } },
      ['+'],
    ),
  ]);

  const stop = button(
    { class: 'round-btn', title: 'Stop', attrs: { 'aria-label': 'Stop' }, on: { click: () => session.stopAll() } },
    [el('i', { class: 'round-btn__stop' })],
  );

  const record = button(
    { class: 'round-btn', title: 'Record (R)', attrs: { 'aria-label': 'Record' }, on: { click: () => session.toggleRecord() } },
    [el('i', { class: 'round-btn__rec' })],
  );

  const play = button(
    {
      class: 'play-btn',
      title: 'Play / stop (Space)',
      attrs: { 'aria-label': 'Play or stop' },
      on: { click: () => session.togglePlay() },
    },
    [el('i', { class: 'play-btn__glyph' })],
  );

  // Only worth offering once a clip is loaded, since there would be nothing
  // to show. It is hidden rather than disabled: a button that can never do
  // anything is clutter, not information.
  const watch = button(
    {
      class: 'chip',
      title: 'Show or hide the video while you play',
      on: { click: () => options.onToggleVideo() },
    },
    ['Video'],
  );

  const root = el('header', { class: 'topbar' }, [
    title,
    stepsChip,
    tempo,
    el('div', { class: 'topbar__spacer' }),
    el('div', { class: 'topbar__transport' }, [stop, record, play]),
    el('div', { class: 'topbar__divider' }),
    watch,
    button(
      {
        class: 'chip',
        title: 'Export MIDI of what you played',
        on: { click: () => void session.exportTake('midi') },
      },
      ['MIDI'],
    ),
    button(
      { class: 'btn-accent', title: 'Export the latest take as audio', on: { click: () => void session.exportTake('wav') } },
      [el('i', { class: 'icon-download' }), el('span', { text: 'Export' })],
    ),
  ]);

  return {
    el: root,
    update(state: AppState) {
      watch.style.display = options.hasVideo() ? '' : 'none';
      setText(title, TITLES[state.view]);
      setText(stepsLabel, `${state.steps} steps`);
      setText(bpmValue, String(state.bpm));
      toggleClass(play, 'is-playing', state.playing);
      toggleClass(record, 'is-recording', state.recording);
    },
  };
}
