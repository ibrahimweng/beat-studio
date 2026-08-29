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

export interface TransportView extends View {
  setTime(time: number): void;
}

/**
 * The transport, on the thing it drives.
 *
 * This used to be a bar across the top of the window, which is where it
 * belonged when the app had six screens and the bar was the one part common
 * to all of them. There is one screen now, so a strip of controls above
 * everything was a title bar for a room with one door: it drives the
 * timeline, and it sits on the timeline.
 *
 * Under the picture is where an edit suite usually puts it, and that is the
 * one place it cannot go here: floating the video into its own window deletes
 * the stage, and a transport that disappears with the picture is worse than
 * one an inch lower. Audition docks its transport by the timeline for the
 * same reason.
 *
 * What travelled down with it is everything that decides where a sound can
 * land — frame rate, snapping — and the two switches about what you are
 * watching and hearing while you work. What stayed above is the project:
 * getting a file out, and help.
 */
export function createTransport(session: SoundDesignSession): TransportView {
  const clock = el('div', { class: 'transport__clock', text: '00:00:00:00' });
  const total = el('div', { class: 'transport__total', text: '00:00:00:00' });

  const play = button(
    { class: 'play-btn', title: 'Play or pause (Space)', on: { click: () => session.togglePlay() } },
    [el('i', { class: 'play-btn__glyph' })],
  );

  /** A small round transport button, which is most of this row. */
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
  const toStart = round('❘◀', 'Back to the start (Home)', () => session.seek(0));
  const toEnd = round('▶❘', 'On to the end (End)', () => session.seek(session.project.duration));
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
   *
   * J and L do the same thing from the keyboard and do it better, since they
   * step up through the speeds on repeated presses. These stay because a
   * newcomer to this does not know that yet, and their titles say so.
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

  const rewind = shuttle('◀◀', 'Hold to run backwards, or press J', -SHUTTLE_RATE);
  const fastForward = shuttle('▶▶', 'Hold to run forwards, or press L', SHUTTLE_RATE);

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
   * The big stage above the timeline is usually what you want. This is for
   * when you would rather have the height: with the clip in a window the
   * stage is gone rather than empty, and all of it goes to the lanes.
   */
  const videoWindow = button(
    {
      class: 'chip chip--sm',
      title: 'Float the video in a small window instead of the stage above',
      on: { click: () => session.toggleVideoWindow() },
    },
    ['Window'],
  );

  /**
   * A frame rate with its unit, so nothing has to stand beside it saying so.
   */
  const fpsLabel = (rate: number): string => `${rate} fps`;

  const fps = el('select', { class: 'transport__select', title: 'Frame rate' }) as HTMLSelectElement;
  for (const rate of COMMON_FPS) {
    fps.appendChild(el('option', { text: fpsLabel(rate), attrs: { value: String(rate) } }));
  }
  fps.addEventListener('change', () => session.setFps(Number(fps.value)));

  const snapButtons = SNAP_MODES.map((mode) =>
    button(
      { class: 'cell', title: `${mode.title} (S cycles)`, on: { click: () => session.setSnap(mode.value) } },
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

  /**
   * The transport, drawn as three things rather than as ten.
   *
   * The order was already right — get back, then the mirror around play,
   * then record — but every button carried its own outline at the same
   * spacing as its neighbour, so the eye had to read ten circles and work
   * out which of the six triangles it wanted. Grouped, there is one outline
   * per job: the pair that stops you, the run that moves you, and the one
   * that writes.
   */
  const cluster = (...within: HTMLElement[]): HTMLElement =>
    el('div', { class: 'transport__grp' }, within);

  const root = el('div', { class: 'transport-row' }, [
    el('div', { class: 'transport' }, [
      cluster(toStart, stop, toEnd),
      cluster(prev, rewind, back, play, forward, fastForward, next),
      cluster(record),
    ]),
    el('div', { class: 'transport__time' }, [
      clock,
      el('div', { class: 'transport__sep', text: '/' }),
      total,
    ]),
    el('div', { class: 'topbar__divider' }),
    fps,
    el('div', { class: 'micro-label transport__snap', text: 'Snap' }),
    el('div', { class: 'transport__snaps' }, snapButtons),
    el('div', { class: 'topbar__spacer' }),
    videoWindow,
    reference,
    helpButton('transport', 'the transport'),
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
      for (const node of [stop, prev, next, rewind, fastForward, toStart, toEnd]) {
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
          fps.appendChild(el('option', { text: fpsLabel(project.fps), attrs: { value } }));
        }
        fps.value = value;
      }
    },
    setTime(time: number) {
      setText(clock, timecode(time, session.project.fps));
    },
  };
}
