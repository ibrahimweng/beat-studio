import type { SoundDesignSession } from '../../sound-design-session.ts';
import type { AppState } from '../../store.ts';
import { COMMON_FPS, timecode } from '../../timeline/project.ts';
import type { SnapMode } from '../../timeline/types.ts';
import { button, el, setText, toggleClass } from '../dom.ts';
import type { View } from '../view.ts';

const SNAP_MODES: readonly { value: SnapMode; label: string; title: string }[] = [
  { value: 'frame', label: 'Frame', title: 'Snap to whole frames' },
  { value: 'beat', label: 'Beat', title: 'Snap to the tempo, for work cut to music' },
  { value: 'off', label: 'Free', title: 'No snapping' },
];

export interface SoundDesignBarView extends View {
  setTime(time: number): void;
}

/** Transport, timecode and the settings that decide where a sound can land. */
export function createSoundDesignBar(session: SoundDesignSession): SoundDesignBarView {
  const clock = el('div', { class: 'sound-design-bar__clock', text: '0:00:00' });
  const total = el('div', { class: 'sound-design-bar__total', text: '0:00:00' });

  const play = button(
    { class: 'play-btn', title: 'Play or pause (Space)', on: { click: () => session.togglePlay() } },
    [el('i', { class: 'play-btn__glyph' })],
  );

  const back = button(
    { class: 'round-btn', title: 'Back one frame (left arrow)', on: { click: () => session.stepFrames(-1) } },
    [el('span', { style: { fontSize: '12px', color: 'var(--txt-2)' }, text: '◀' })],
  );
  const forward = button(
    { class: 'round-btn', title: 'On one frame (right arrow)', on: { click: () => session.stepFrames(1) } },
    [el('span', { style: { fontSize: '12px', color: 'var(--txt-2)' }, text: '▶' })],
  );
  const toStart = button(
    { class: 'round-btn', title: 'Back to the start', on: { click: () => session.seek(0) } },
    [el('span', { style: { fontSize: '12px', color: 'var(--txt-2)' }, text: '⏮' })],
  );

  const fps = el('select', { class: 'sound-design-bar__select', title: 'Frame rate' }) as HTMLSelectElement;
  for (const rate of COMMON_FPS) {
    fps.appendChild(el('option', { text: String(rate), attrs: { value: String(rate) } }));
  }
  fps.addEventListener('change', () => session.setFps(Number(fps.value)));

  const snapButtons = SNAP_MODES.map((mode) =>
    button(
      { class: 'cell', title: mode.title, on: { click: () => session.setSnap(mode.value) } },
      [el('span', { text: mode.label })],
    ),
  );

  const reference = button(
    {
      class: 'chip chip--sm',
      title: 'Hear the video’s own sound while you work. It is never exported.',
      on: {
        click: () => {
          session.setReferenceAudio(!session.referenceAudio);
          toggleClass(reference, 'is-on', session.referenceAudio);
        },
      },
    },
    ['Ref audio'],
  );

  const root = el('header', { class: 'topbar sound-design-bar' }, [
    // The screen is named here as well as on the rail, because this is the
    // first thing the app opens on and it should say what it is.
    el('div', { class: 'topbar__title', text: 'Sound design' }),
    el('div', { class: 'topbar__divider' }),
    toStart,
    back,
    play,
    forward,
    el('div', { class: 'sound-design-bar__time' }, [
      clock,
      el('div', { class: 'sound-design-bar__sep', text: '/' }),
      total,
    ]),
    el('div', { class: 'topbar__divider' }),
    el('div', { class: 'micro-label', text: 'FPS' }),
    fps,
    el('div', { class: 'micro-label', style: { marginLeft: '6px' }, text: 'Snap' }),
    el('div', { style: { display: 'flex', gap: '4px' } }, snapButtons),
    el('div', { class: 'topbar__spacer' }),
    reference,
  ]);

  return {
    el: root,
    update(state: AppState) {
      const { project } = state;
      setText(total, timecode(project.duration, project.fps));
      toggleClass(play, 'is-playing', session.playing);
      snapButtons.forEach((node, i) => toggleClass(node, 'is-on', project.snap === SNAP_MODES[i].value));
      const value = String(project.fps);
      if (fps.value !== value) {
        // A measured rate may not be one of the standard ones.
        if (!Array.from(fps.options).some((o) => o.value === value)) {
          fps.appendChild(el('option', { text: value, attrs: { value } }));
        }
        fps.value = value;
      }
    },
    setTime(time: number) {
      setText(clock, timecode(time, session.project.fps));
    },
  };
}
