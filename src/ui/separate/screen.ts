import type { AppState, Stem } from '../../store.ts';
import type { SeparateSession } from '../../separate-session.ts';
import { button, clear, el, setText, svg, toggleClass } from '../dom.ts';
import { helpButton } from '../help.ts';
import type { View } from '../view.ts';

/**
 * Taking a recording apart, on a screen of its own.
 *
 * A screen rather than a panel because what this needs is width. Every part is a
 * waveform as long as the recording, one under another, with what is inside a
 * part folded under it — and a column down the side of the timeline cannot show
 * two of those, let alone eight.
 *
 * The shape of it is a mixer, on purpose. Somebody taking a beat apart is doing
 * the thing a mixer is for: listening to one part against the others, holding one
 * down, hearing whether the kick came out clean. So every row has a level, a mute
 * and a solo, and the row is the whole width of the screen because the waveform
 * is the thing you are reading.
 *
 * What it deliberately does not have is a timeline. There is no playhead, no
 * scrubbing and no editing here: this screen ends when the parts go to the piece,
 * and the piece is where all of that already lives. Building a second timeline
 * here would be a second timeline to keep working.
 */
export function createSeparateScreen(session: SeparateSession): View {
  /* ---------------------------------------------------------------- the bar */

  const input = el('input', {
    type: 'file',
    style: { display: 'none' },
    attrs: { accept: 'audio/*,video/*' },
    on: {
      change: (event) => {
        const target = event.currentTarget as HTMLInputElement;
        const file = target.files?.[0];
        if (file) void session.takeApart(file);
        target.value = '';
      },
    },
  }) as HTMLInputElement;

  const open = button(
    {
      class: 'btn-accent',
      title:
        'Find the separate parts of a recording: the drums, the bass, what is in ' +
        'front, and the rest. Nothing is uploaded and nothing is downloaded — it is ' +
        'all worked out here.',
      on: { click: () => input.click() },
    },
    ['Take a beat apart'],
  );

  const title = el('div', { class: 'appbar__title', text: 'Nothing taken apart yet' });

  /**
   * Which way the next separation leans between hits and notes.
   *
   * The one control worth putting on screen, because the right answer is not the
   * same for every recording: a heavily compressed mix has its drums smeared
   * across time until they look partly like notes, and an acoustic recording has a
   * piano attack that looks partly like a drum. It applies to the next separation
   * rather than to this one, which is why it says so.
   */
  const lean = el('input', {
    class: 'sep__lean',
    type: 'range',
    attrs: { min: '0', max: '1', step: '0.05', 'aria-label': 'Lean towards hits or notes' },
    on: {
      input: (event) => session.setLean(Number((event.currentTarget as HTMLInputElement).value)),
    },
  }) as HTMLInputElement;

  const bar = el('header', { class: 'topbar appbar' }, [
    open,
    input,
    title,
    el('div', { class: 'topbar__spacer' }),
    el('span', { class: 'micro-label', text: 'Notes' }),
    lean,
    el('span', { class: 'micro-label', text: 'Hits' }),
    helpButton('separate', 'taking a beat apart'),
  ]);

  /* -------------------------------------------------------------- the parts */

  const list = el('div', { class: 'sep__list' });
  const busy = el('div', { class: 'sep__busy' });
  const meter = el('i', { class: 'sep__meter' });
  const busyRow = el('div', { class: 'sep__busyrow' }, [busy, el('span', { class: 'sep__track' }, [meter])]);

  /**
   * What the measurements found, said plainly.
   *
   * The honest thing to report about a separation is the evidence rather than a
   * score. Whether there was a loop and how strong it was, and whether there were
   * two different channels to read a position from, are what decide how much of
   * the work each measurement did — and somebody looking at four parts has no
   * other way to know that a mono file was divided on repetition alone, or that
   * nothing repeated and so the lead is empty on purpose.
   */
  const notes = el('div', { class: 'hint sep__notes' });

  const nothing = el('div', { class: 'sep__nothing' }, [
    el('div', { class: 'sep__nothing-title', text: 'Take a beat apart' }),
    el('p', {
      class: 'hint',
      text:
        'Drop in a track and it comes back as the drums, the bass, whatever is in ' +
        'front, and everything else — and each of those can be opened again, into ' +
        'the kick, the snare and the hats, or into the lines that are held.',
    }),
    el('p', {
      class: 'hint',
      text:
        'The parts add back up to the recording exactly, so nothing is lost and ' +
        'nothing is counted twice. Each one becomes a recording you can place, ' +
        'export, rebuild out of the palette, or read the hits off.',
    }),
    el('p', {
      class: 'hint',
      text:
        'It reads the recording rather than recognising instruments, so it is good ' +
        'at drums and honest about the rest. Two instruments in the same place and ' +
        'the same register will not come apart.',
    }),
  ]);

  /* ------------------------------------------------------------ what to do */

  const placeAll = button(
    {
      class: 'btn-accent',
      title:
        'Put every part on a layer of its own, at the start of the piece. A part ' +
        'you have opened goes as its pieces rather than whole, and anything held ' +
        'down is left out',
      on: { click: () => session.placeAll() },
    },
    ['Place on the timeline'],
  );

  const hearAll = button(
    {
      class: 'chip chip--sm',
      title: 'Play every part together, honouring anything held down or soloed',
      on: { click: () => void session.hear('all') },
    },
    ['Hear it back'],
  );

  const stop = button(
    { class: 'chip chip--sm', title: 'Stop', on: { click: () => session.stop() } },
    ['Stop'],
  );

  const write = button(
    {
      class: 'chip chip--sm',
      title:
        'Write every part out as a WAV file. All the same length and all starting ' +
        'at zero, so they sit on separate tracks and stay in sync',
      on: { click: () => session.saveParts() },
    },
    ['Write the files'],
  );

  const forget = button(
    {
      class: 'chip chip--sm chip--danger',
      title: 'Clear these parts. The recordings they made stay in your library',
      on: { click: () => session.clear() },
    },
    ['Forget'],
  );

  const actions = el('div', { class: 'sep__actions' }, [
    placeAll,
    hearAll,
    stop,
    write,
    el('div', { class: 'topbar__spacer' }),
    forget,
  ]);

  const root = el('div', { class: 'sep' }, [
    bar,
    el('div', { class: 'sep__body' }, [busyRow, notes, nothing, list]),
    actions,
  ]);

  /* ------------------------------------------------------------- redrawing */

  /** What the rows were last drawn from, so they are redrawn only when they move. */
  let drawn: AppState['separation'] | null = null;

  const paint = (state: AppState['separation']): void => {
    const working = state.busy !== null;
    busyRow.style.display = working ? 'flex' : 'none';
    setText(
      busy,
      working
        ? state.secondsLeft !== null
          ? `${state.busy} about ${state.secondsLeft}s left`
          : (state.busy as string)
        : '',
    );
    meter.style.width = `${Math.round(state.progress * 100)}%`;

    const has = state.stems.length > 0;
    nothing.style.display = has || working ? 'none' : 'block';
    actions.style.display = has ? 'flex' : 'none';
    notes.style.display = state.notes ? 'block' : 'none';
    if (state.notes) setText(notes, noteLine(state));

    setText(
      title,
      state.from
        ? `${state.from} · ${length(state.seconds)}`
        : 'Nothing taken apart yet',
    );
    lean.value = String(state.lean);

    if (drawn === state) return;
    const sameRows =
      drawn !== null &&
      drawn.stems === state.stems &&
      drawn.muted === state.muted &&
      drawn.solo === state.solo &&
      drawn.chosen === state.chosen &&
      drawn.hearing === state.hearing &&
      drawn.opened === state.opened;
    drawn = state;
    if (sameRows) return;

    clear(list);
    for (const stem of state.stems) list.appendChild(row(stem, state));
  };

  /** One part: what it is, what it looks like, and what can be done with it. */
  function row(stem: Stem, state: AppState['separation']): HTMLElement {
    const inside = stem.under !== null;
    const opened = state.opened.includes(stem.id);
    const muted = state.muted.includes(stem.id);
    // Soloing one part silences the others, so they read as held down too.
    const quiet = muted || (state.solo !== null && state.solo !== stem.id);

    /*
     * A part that came out with next to nothing in it says so.
     *
     * Otherwise an empty row reads as a failure rather than as an answer, and
     * for the lead it is very often the answer: on a mix where everything
     * centred is part of the loop, there is nothing in front, and the honest
     * result is an empty file.
     */
    const empty = stem.share < 0.001;
    const about = empty ? `${stem.about} — nothing landed here` : stem.about;

    const name = el('div', { class: 'sep__name', title: about }, [
      el('span', { class: 'sep__title', text: stem.name }),
      el('span', { class: 'sep__about', text: about }),
    ]);

    const wave = el('div', { class: 'sep__wave', title: `${share(stem.share)} of the recording` }, [
      waveform(stem.peaks),
    ]);

    const buttons: HTMLElement[] = [
      button(
        {
          class: 'chip chip--sm',
          title: 'Hear this part on its own, from the start',
          on: { click: () => void session.hear(stem.id) },
        },
        [state.hearing === stem.id ? '■' : '▶'],
      ),
      button(
        {
          class: 'chip chip--sm',
          title: 'Hold this part down while listening to the others',
          on: { click: () => session.toggleMute(stem.id) },
        },
        ['M'],
      ),
      button(
        {
          class: 'chip chip--sm',
          title: 'Hear only this part when everything plays together',
          on: { click: () => session.toggleSolo(stem.id) },
        },
        ['S'],
      ),
    ];

    if (stem.deeper) {
      buttons.push(
        button(
          {
            class: 'chip chip--sm',
            title: opened
              ? 'Fold this part back up. Its files stay in your library'
              : 'Take this part further, into what is inside it',
            on: { click: () => (opened ? session.close(stem.id) : void session.open(stem.id)) },
          },
          [opened ? 'Fold up' : 'Open'],
        ),
      );
    }

    buttons.push(
      button(
        {
          class: 'chip chip--sm',
          title:
            'Read this part back into the palette: every sound in it rebuilt as a ' +
            'voice and five numbers, which can then be tuned, stretched and stacked',
          on: { click: () => void session.rebuild(stem.id) },
        },
        ['Rebuild'],
      ),
      button(
        {
          class: 'chip chip--sm',
          title:
            'Find every hit in this part and put the sound you have chosen on each ' +
            'one — the same idea as reading the hits out of a picture',
          on: { click: () => void session.placeOnHits(stem.id) },
        },
        ['Hits'],
      ),
    );

    const node = el(
      'div',
      {
        class: 'sep__row',
        dataset: { part: stem.id },
        on: {
          // Clicking the row arms the part, so the next click on a lane places it.
          click: (event) => {
            if ((event.target as HTMLElement).closest('button')) return;
            session.choose(stem.id);
          },
        },
      },
      [
        el('span', { class: 'sep__share', text: share(stem.share) }),
        name,
        wave,
        el('div', { class: 'sep__buttons' }, buttons),
      ],
    );

    toggleClass(node, 'is-inside', inside);
    toggleClass(node, 'is-quiet', quiet);
    toggleClass(node, 'is-solo', state.solo === stem.id);
    toggleClass(node, 'is-on', state.chosen === stem.id);
    return node;
  }

  return {
    el: root,
    update(state: AppState) {
      paint(state.separation);
      // Nothing to place until there is a piece to place it on, which there
      // always is: a piece has a length of its own with or without a video.
      placeAll.disabled = state.separation.stems.length === 0;
    },
  };
}

/**
 * A part's waveform, as one filled shape.
 *
 * SVG rather than a canvas, because the row's width is decided by the layout and a
 * canvas would have to be measured and redrawn on every resize. A path with no
 * fixed aspect ratio stretches to whatever it is given and stays crisp.
 */
function waveform(peaks: Float32Array): SVGElement {
  const wide = peaks.length;
  const tall = 40;
  const middle = tall / 2;
  let top = '';
  let bottom = '';
  for (let at = 0; at < wide; at++) {
    // Never quite nothing, so a silent part is a line rather than an absence.
    const half = Math.max(0.4, peaks[at] * middle);
    top += `${at === 0 ? 'M' : 'L'}${at} ${middle - half}`;
    bottom = `L${wide - 1 - at} ${middle + Math.max(0.4, peaks[wide - 1 - at] * middle)}` + bottom;
  }

  return svg('svg', { class: 'sep__svg', viewBox: `0 0 ${wide} ${tall}`, preserveAspectRatio: 'none' }, [
    svg('path', { d: `${top}${bottom}Z`, class: 'sep__path' }),
  ]);
}

/**
 * A share as a percentage, which is how much of the recording a part holds.
 *
 * A decimal place under ten per cent, because everything in the tree is a share
 * of the same thing — the whole recording — and a hi-hat file is a couple of per
 * cent of a track however much of the drums it is. Rounded to whole numbers, four
 * rows inside the drums all read "0%" and the list says nothing.
 */
function share(value: number): string {
  const percent = value * 100;
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

/** A length in minutes and seconds. */
function length(seconds: number): string {
  if (!seconds) return '';
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * One line saying what the measurements found.
 *
 * Written out rather than scored, and the two cases where a measurement was
 * unavailable are said rather than left to be inferred from an empty part.
 */
function noteLine(state: AppState['separation']): string {
  const notes = state.notes;
  if (!notes) return '';
  const parts: string[] = [];

  parts.push(
    notes.loop !== null
      ? `a loop ${notes.loop.toFixed(2)}s long, standing ${Math.round(notes.loopStrength * 100)}% above its surroundings`
      : 'nothing repeated, so the loop had no say in this',
  );
  parts.push(
    notes.stereo
      ? `two channels ${Math.round(notes.width * 100)}% apart, so where things sit was read from them`
      : 'one channel in effect, so where things sit could not be read',
  );
  if (notes.loop === null && !notes.stereo) {
    parts.push('which leaves no way to tell a lead from the rest — that part is empty on purpose');
  }
  return `${parts.join(' · ')}.`;
}
