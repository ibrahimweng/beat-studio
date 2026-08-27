import type { SoundDesignSession } from '../../sound-design-session.ts';
import type { AppState } from '../../store.ts';
import { COMMON_FPS, timecode } from '../../timeline/project.ts';
import type { SnapMode } from '../../timeline/types.ts';
import { button, el, setText, toggleClass } from '../dom.ts';
import type { View } from '../view.ts';
import { helpButton } from '../help.ts';

/** How many times normal speed a held fast forward runs at. */
const SHUTTLE_RATE = 6;

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

  /** A small round transport button, which is most of this bar. */
  const round = (glyph: string, title: string, onClick: () => void): HTMLButtonElement =>
    button({ class: 'round-btn', title, on: { click: onClick } }, [
      el('span', { class: 'round-btn__glyph', text: glyph }),
    ]);

  /*
   * The glyphs are built from plain triangles and bars rather than from the
   * transport characters that look right in a code editor.
   *
   * U+23EA and its neighbours carry an emoji presentation by default, so a
   * browser that has a colour font renders two of the nine buttons in orange
   * and leaves the rest grey. Doubling a triangle and putting a bar beside it
   * says the same thing in characters that have only one way of being drawn.
   */
  const back = round('◀', 'Back one frame (left arrow)', () => session.stepFrames(-1));
  const forward = round('▶', 'On one frame (right arrow)', () => session.stepFrames(1));
  const toStart = round('❘◀', 'Back to the start', () => session.seek(0));
  const stop = round('■', 'Stop, and go back to where play started', () => session.stop());
  const prev = round('❘◀◀', 'The sound before this one', () => session.toSound(-1));
  const next = round('▶▶❘', 'The sound after this one', () => session.toSound(1));

  /**
   * Fast forward and rewind, which run while they are held.
   *
   * Held rather than pressed, because what it is for is finding a moment by
   * watching the picture go past. Pointer capture is what makes letting go
   * outside the button still stop it — without it, releasing anywhere else
   * leaves the clip running away.
   */
  const shuttle = (glyph: string, title: string, rate: number): HTMLButtonElement => {
    const node = round(glyph, title, () => {});
    node.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      node.setPointerCapture(event.pointerId);
      session.shuttle(rate);
    });
    const stopIt = (): void => session.stopShuttle();
    node.addEventListener('pointerup', stopIt);
    node.addEventListener('pointercancel', stopIt);
    node.addEventListener('lostpointercapture', stopIt);
    return node;
  };

  const rewind = shuttle('◀◀', 'Hold to run backwards', -SHUTTLE_RATE);
  const fastForward = shuttle('▶▶', 'Hold to run forwards', SHUTTLE_RATE);

  /**
   * Record: with this on, whatever you play lands on the timeline.
   *
   * The drums, the keys and the guitar alike, wherever you play them from.
   * It does not need the transport running — unarmed it is a pass you play
   * in against the picture, and standing still it drops everything at the
   * same moment, which is occasionally what you want.
   */
  const record = button(
    {
      class: 'round-btn round-btn--rec',
      title:
        'Record: what you play on the drums, keys or guitar lands on the ' +
        'timeline at the playhead',
      on: { click: () => session.toggleArmed() },
    },
    [el('span', { class: 'round-btn__glyph', text: '●' })],
  );

  /**
   * Put the video in a window that floats over everything.
   *
   * On the instrument screens the window is the only way to see the clip at
   * all. Here it is a choice: the big stage above the timeline is usually
   * what you want, and the window is for when you would rather have the
   * height and keep the picture in a corner.
   */
  const videoWindow = button(
    {
      class: 'chip chip--sm',
      title: 'Float the video in a small window instead of the stage above',
      on: { click: () => session.toggleVideoWindow() },
    },
    ['Window'],
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
    el('div', { class: 'topbar__title section-title--asks' }, [
      el('span', { text: 'Sound design' }),
      helpButton('transport', 'the transport'),
    ]),
    el('div', { class: 'topbar__divider' }),
    toStart,
    stop,
    prev,
    rewind,
    back,
    play,
    forward,
    fastForward,
    next,
    record,
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
    videoWindow,
    helpButton('video', 'the video window'),
    reference,
  ]);

  return {
    el: root,
    update(state: AppState) {
      const { project } = state;
      setText(total, timecode(project.duration, project.fps));
      toggleClass(play, 'is-playing', session.playing);
      toggleClass(record, 'is-on', state.armed);
      toggleClass(videoWindow, 'is-on', state.videoWindow);
      // Nothing to step between, nothing to float, nothing to stop.
      const has = state.videoReady;
      for (const node of [stop, prev, next, rewind, fastForward, toStart]) {
        node.disabled = !has;
      }
      videoWindow.disabled = !has;
      prev.disabled = !has || !project.cues.length;
      next.disabled = prev.disabled;
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
