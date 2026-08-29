import type { SoundDesignSession } from '../../sound-design-session.ts';
import type { AppState } from '../../store.ts';
import { timecode } from '../../timeline/project.ts';
import { MOMENT_TITLES } from '../../audio/suggest.ts';
import type { MomentKind } from '../../video/moments.ts';
import { button, clear, el, setText, svg } from '../dom.ts';
import type { View } from '../view.ts';

/**
 * The list of moments, and what to put on each one.
 *
 * This is the panel for somebody who has edited video for years and has never
 * put sound to it. They can already see that something happens at 0:02:04.
 * What they cannot see is that it has been building since 0:01:22, and so
 * that the sound has to arrive rather than start.
 *
 * Every row is therefore three things: where, what, and why. The why is one
 * sentence, it is about the frame in front of them, and it is the entire
 * teaching plan. Nothing here explains the timeline, because they know what a
 * timeline is and saying so would waste the only attention they will give
 * this.
 */
export interface MomentsPanelOptions {
  /**
   * Somebody wants something else for this moment.
   *
   * Handled outside this file because it lands in the library, which is a
   * different panel: this one only knows which moment was asked about.
   */
  onShowOthers?(kind: MomentKind): void;
}

export function createMomentsPanel(
  session: SoundDesignSession,
  options: MomentsPanelOptions = {},
): View {
  const count = el('div', { class: 'moments__count', text: 'No video scanned yet' });
  const note = el('div', { class: 'moments__note' });

  const acceptAll = button(
    {
      class: 'btn-accent',
      title: 'Put every suggestion still waiting onto the timeline, in one go',
      on: { click: () => session.acceptAllMoments() },
    },
    ['Accept all'],
  );

  const clearPlaced = button(
    {
      class: 'chip chip--sm',
      title: 'Take back every sound a suggestion put down, and offer them again',
      on: { click: () => session.clearPlacedMoments() },
    },
    ['Undo the pass'],
  );

  const head = el('div', { class: 'moments__head' }, [
    el('div', { class: 'moments__headings' }, [count, note]),
    acceptAll,
  ]);

  const list = el('div', { class: 'moments__list' });
  const empty = el('div', { class: 'moments__empty' });

  const root = el('div', { class: 'panel-page moments' }, [head, empty, list, clearPlaced]);

  /**
   * What was drawn last time, so the list is only rebuilt when it changed.
   *
   * The panel redraws on every store change, which includes every frame while
   * the video plays. Rebuilding forty rows at that rate would make the whole
   * app stutter, and comparing a short string is free.
   */
  let painted = '';

  return {
    el: root,

    update(state: AppState) {
      const { detect, project } = state;
      const scanning = detect.status === 'scanning' || detect.status === 'pinning';

      const left = session.momentsLeft;
      const placed = Object.values(detect.settled).filter((s) => s === 'placed').length;
      const skipped = Object.values(detect.settled).filter((s) => s === 'skipped').length;

      if (scanning) {
        setText(count, detect.status === 'scanning' ? 'Reading the video…' : 'Pinning to frames…');
        setText(note, `${Math.round(detect.progress * 100)}%`);
      } else if (detect.moments.length) {
        setText(count, `${detect.moments.length} moments found`);
        const said = [
          placed ? `${placed} placed` : '',
          skipped ? `${skipped} passed over` : '',
          left ? `${left} waiting on you` : 'nothing left to decide',
        ].filter(Boolean);
        setText(note, said.join(', '));
      } else {
        setText(count, state.videoReady ? 'Nothing found yet' : 'No video loaded');
        setText(note, '');
      }

      acceptAll.style.display = left && !scanning ? '' : 'none';
      clearPlaced.style.display = placed ? '' : 'none';

      empty.style.display = detect.moments.length || scanning ? 'none' : '';
      setText(
        empty,
        state.videoReady
          ? 'Scan the video from the bar above the timeline. It reads the whole clip once and ' +
              'marks every cut and fast move, then says what belongs on each of them.'
          : 'Drop a video on the stage above. Everything here follows from the picture, so there ' +
              'is nothing to suggest until there is something to watch.',
      );

      // The rows depend on the moments, the decisions and the frame rate, and
      // on nothing else that changes while the video plays.
      const key = [
        detect.moments.map((m) => `${m.id}:${m.kind}`).join(','),
        Object.entries(detect.settled).map(([id, was]) => `${id}=${was}`).join(','),
        project.fps,
      ].join('|');
      if (key === painted) return;
      painted = key;

      clear(list);
      for (const { moment, suggested, state: settled } of session.moments) {
        list.appendChild(row(moment.id, {
          at: timecode(moment.t, project.fps),
          of: moment.kind,
          kind: MOMENT_TITLES[moment.kind],
          sound: suggested.name,
          why: suggested.why,
          settled,
        }));
      }
    },
  };

  function row(
    id: string,
    parts: {
      at: string;
      of: MomentKind;
      kind: string;
      sound: string;
      why: string;
      settled: 'placed' | 'skipped' | null;
    },
  ): HTMLElement {
    const act = (
      label: string,
      title: string,
      glyph: SVGElement,
      onClick: () => void,
      accent = false,
    ): HTMLButtonElement =>
      button(
        {
          class: accent ? 'moment__act moment__act--on' : 'moment__act',
          title,
          attrs: { 'aria-label': label },
          on: { click: onClick },
        },
        [glyph],
      );

    const acts = parts.settled
      ? [
          act('Offer this again', 'Put this one back in the list', undoGlyph(), () =>
            session.reopenMoment(id)),
        ]
      : [
          act('Hear it', 'Play from just before it, so it is heard against the picture', playGlyph(), () =>
            session.auditionMoment(id)),
          act('Place it', 'Put this sound on this moment', tickGlyph(), () => session.acceptMoment(id), true),
          act('Pass over', 'Nothing goes here', crossGlyph(), () => session.dismissMoment(id)),
        ];

    const marker =
      parts.settled === 'placed'
        ? el('span', { class: 'moment__state moment__state--placed', text: 'placed' })
        : parts.settled === 'skipped'
          ? el('span', { class: 'moment__state', text: 'passed over' })
          : null;

    const top = el('div', { class: 'moment__top' }, [
      el('span', { class: 'moment__at', text: parts.at }),
      el('span', { class: 'moment__kind', text: parts.kind }),
      ...(marker ? [marker] : []),
      el('span', { class: 'moment__spacer' }),
      el('div', { class: 'moment__acts' }, acts),
    ]);

    /*
     * Two controls in one pill.
     *
     * Hearing the sound on its own and going to look for a different one are
     * both things somebody does at this point, and they are not the same
     * thing. Putting the second on the name is what turns a suggestion from
     * take it or leave it into a starting point: leaving it used to drop
     * somebody into a thousand sounds with nowhere to begin, and now it lands
     * them in the seven or eight that suit the moment they were looking at.
     */
    const hear = button(
      {
        class: 'moment__hear',
        title: 'Hear this sound on its own',
        attrs: { 'aria-label': 'Hear this sound on its own' },
        on: { click: () => session.auditionMoment(id, false) },
      },
      [waveGlyph()],
    );

    const others = button(
      {
        class: 'moment__others',
        title: `Show the other sounds that suit ${parts.kind.toLowerCase()}`,
        on: { click: () => options.onShowOthers?.(parts.of) },
      },
      [el('span', { class: 'moment__sound-name', text: parts.sound }), chevronGlyph()],
    );

    const sound = el('div', { class: 'moment__sound' }, [hear, others]);

    return el(
      'div',
      { class: parts.settled ? `moment is-${parts.settled}` : 'moment' },
      [top, sound, el('div', { class: 'moment__why', text: parts.why })],
    );
  }
}

/* ---------- glyphs ----------
 * Drawn rather than typed, so they sit on the same optical weight as the rest
 * of the interface at any size and take the row's colour when it changes.
 */

function stroked(path: string, size = 12): SVGElement {
  return svg(
    'svg',
    { width: size, height: size, viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': 'true' },
    [
      svg('path', {
        d: path,
        stroke: 'currentColor',
        'stroke-width': 1.6,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    ],
  );
}

function playGlyph(): SVGElement {
  return svg('svg', { width: 10, height: 11, viewBox: '0 0 10 11', 'aria-hidden': 'true' }, [
    svg('path', { d: 'M2 1.4 8.6 5.5 2 9.6z', fill: 'currentColor' }),
  ]);
}

function tickGlyph(): SVGElement {
  return stroked('M2 6.4 4.8 9 10 3.2');
}

function crossGlyph(): SVGElement {
  return stroked('M3 3l6 6M9 3l-6 6', 11);
}

function undoGlyph(): SVGElement {
  return stroked('M3.4 5.6H8a2.6 2.6 0 0 1 0 5.2H5M3.4 5.6 5.8 3.2M3.4 5.6 5.8 8');
}

function waveGlyph(): SVGElement {
  return stroked('M1 6h1.6l1-2.4L6 9.4l1.2-3.2L8.4 7.6H11', 11);
}

function chevronGlyph(): SVGElement {
  return stroked('M4.5 2.5 8 6l-3.5 3.5', 10);
}
