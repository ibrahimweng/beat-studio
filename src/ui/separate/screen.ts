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

  /* ------------------------------------------------------- which stretch */

  /**
   * Which part of the recording to take apart.
   *
   * It appears after the first separation rather than before it, which is on
   * purpose: dropping a file in and getting the parts back is the thing this
   * screen is for, and asking two questions before doing anything would put a
   * form in front of it. The stretch is the second question, asked once there is
   * something to look at and a length to choose from — and the file is still in
   * hand, so narrowing it does not mean finding it again.
   *
   * Two reasons somebody wants it. A recording longer than this can hold at once
   * is still one they want the drums out of, and eight bars is the part they were
   * going to use. And a stretch often separates better than the whole, because
   * every measurement that decides the split is made over all of what it is
   * given: a chorus arriving halfway through moves them all.
   */
  const spanFrom = timeBox('From');
  const spanTo = timeBox('To');
  const spanOf = el('span', { class: 'micro-label sep__of' });

  const readSpan = (): { from: number; to: number } => ({
    from: secondsFrom(spanFrom.value, 0),
    to: secondsFrom(spanTo.value, shownWhole),
  });

  const takeSpan = button(
    {
      class: 'chip chip--sm',
      title:
        'Take apart only this stretch of the recording. The file is read again, ' +
        'so nothing has to be found a second time',
      on: {
        click: () => {
          const { from, to } = readSpan();
          void session.takeSpan(from, to);
        },
      },
    },
    ['Take apart this stretch'],
  );

  const takeWhole = button(
    {
      class: 'chip chip--sm',
      title: 'Go back to taking apart all of it',
      on: { click: () => void session.takeSpan(0, shownWhole) },
    },
    ['All of it'],
  );

  const span = el('div', { class: 'sep__span' }, [
    el('span', { class: 'micro-label', text: 'Take apart' }),
    spanFrom,
    el('span', { class: 'micro-label', text: 'to' }),
    spanTo,
    spanOf,
    el('div', { class: 'topbar__spacer' }),
    takeSpan,
    takeWhole,
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

  /**
   * What just happened, in one line.
   *
   * This screen was setting the app's status and nobody was reading it: the
   * status line belongs to the timeline, and the timeline is not mounted here.
   * So "came apart into four parts", "nothing separable inside the drums" and
   * "four parts written" were all being said to an empty room. It is its own
   * line rather than a shared one because the two screens are never up at once.
   */
  const said = el('div', { class: 'sep__said' });

  const foot = el('div', { class: 'sep__foot' }, [said, actions]);

  const root = el('div', { class: 'sep' }, [
    bar,
    el('div', { class: 'sep__body' }, [busyRow, span, notes, nothing, list]),
    foot,
  ]);

  /* ------------------------------------------------------------- redrawing */

  /** What the rows were last drawn from, so they are redrawn only when they move. */
  let drawn: AppState['separation'] | null = null;

  /** How long the file is, for the buttons to read without a state lookup. */
  let shownWhole = 0;

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

    shownWhole = state.whole;
    span.style.display = state.whole > 0 ? 'flex' : 'none';
    takeSpan.disabled = working;
    takeWhole.disabled = working || state.span === null;
    setText(spanOf, state.whole ? `of ${clock(state.whole)}` : '');
    /*
     * The boxes are left alone while somebody is typing in one.
     *
     * Everything else here redraws from the state on every change, which is what
     * keeps the screen and the session in step. A text box is the exception: it
     * holds a half-finished answer that is not state yet, and writing over it
     * mid-word is the oldest bug in forms.
     */
    if (document.activeElement !== spanFrom) spanFrom.value = clock(state.span?.from ?? 0);
    if (document.activeElement !== spanTo) spanTo.value = clock(state.span?.to ?? state.whole);

    const has = state.stems.length > 0;
    nothing.style.display = has || working ? 'none' : 'block';
    actions.style.display = has ? 'flex' : 'none';
    notes.style.display = state.notes ? 'block' : 'none';
    if (state.notes) setText(notes, noteLine(state));

    setText(
      title,
      state.from
        ? state.span
          ? `${state.from} · ${clock(state.span.from)}–${clock(state.span.to)}`
          : `${state.from} · ${length(state.seconds)}`
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

    /*
     * The name is a box you can type in, and it looks like text until you do.
     *
     * This is the honest answer to "which instrument is this". The measurements
     * can say a line is bright and steady between G4 and D5; they cannot say it
     * is a viola, and no amount of arithmetic here ever will — that needs a model
     * trained on instruments, which is the one thing this is built not to need.
     * The person listening knows in a second. So the label is theirs to write,
     * and what is measured sits under it as the evidence for writing it.
     *
     * A box rather than a pencil button next to a label, because a row that
     * already carries six buttons does not need a seventh, and a name you can
     * click into is a thing everybody has met before.
     */
    const title = el('input', {
      class: 'sep__title',
      type: 'text',
      attrs: {
        'aria-label': `Name of the ${stem.name} part`,
        spellcheck: 'false',
        maxlength: '40',
      },
      on: {
        change: (event) => session.rename(stem.id, (event.currentTarget as HTMLInputElement).value),
        keydown: (event) => {
          const key = (event as KeyboardEvent).key;
          // Enter commits and gives the keyboard back; Escape puts it back as it
          // was, which is what those two keys do in every other box anywhere.
          if (key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
          if (key === 'Escape') {
            (event.currentTarget as HTMLInputElement).value = stem.name;
            (event.currentTarget as HTMLInputElement).blur();
          }
        },
      },
    }) as HTMLInputElement;
    title.value = stem.name;

    const name = el('div', { class: 'sep__name', title: about }, [
      title,
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
            const on = event.target as HTMLElement;
            if (on.closest('button') || on.closest('input')) return;
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
      setText(said, state.status ?? '');
      said.style.display = state.status ? 'block' : 'none';
      // The rule above the foot is only worth drawing when there is something
      // under it — otherwise an empty screen has a line across the bottom.
      foot.style.display = state.status || state.separation.stems.length ? 'block' : 'none';
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
/** A box for a time, which is a text box because "1:30" is how people write one. */
function timeBox(label: string): HTMLInputElement {
  return el('input', {
    class: 'sep__time',
    type: 'text',
    attrs: { 'aria-label': label, inputmode: 'numeric', size: '5', spellcheck: 'false' },
  }) as HTMLInputElement;
}

/**
 * Read a time somebody typed.
 *
 * Minutes and seconds, or just seconds, because both are things people write and
 * neither is ambiguous: "90" is a minute and a half and "1:30" is the same
 * minute and a half. Anything that is not either falls back to what was there,
 * rather than to nought — a mistyped end time that silently became the start of
 * the recording would look like the separation had gone wrong.
 */
function secondsFrom(text: string, fallback: number): number {
  const said = text.trim();
  if (!said) return fallback;
  const parts = said.split(':');
  if (parts.length > 2) return fallback;
  const numbers = parts.map((one) => Number(one));
  if (numbers.some((one) => !Number.isFinite(one) || one < 0)) return fallback;
  return numbers.length === 2 ? numbers[0] * 60 + numbers[1] : numbers[0];
}

/** Minutes and seconds, always, so an empty box never means nought. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

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
