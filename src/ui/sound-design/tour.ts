import type { PanelTab } from '../../store.ts';
import { button, el } from '../dom.ts';

/*
 * Bumped from the first version.
 *
 * That one walked somebody around an app with six screens on the rail and a
 * palette where the moments panel now is. Anybody who saw it saw a tour of a
 * different program, so being marked as having seen it is not worth honouring.
 */
const STORAGE_KEY = 'toolcraft.st88.tour.v2';
/** Space between the highlight and the card, in pixels. */
const GAP = 14;

export interface Step {
  /** What to point at. The step still shows if nothing matches. */
  target?: string;
  /**
   * Which panel to show first.
   *
   * Half of what there is to say lives behind a tab, and pointing at
   * something that is not on screen dims the page and centres the card, which
   * is the tour saying "somewhere over there". Every step names one, so going
   * back through it lands on the same screens as going forward.
   */
  tab: PanelTab;
  /**
   * A group of the library to open first, for a step that points inside it.
   *
   * The browser starts folded away, so a step about the groups would be
   * pointing at a closed box. This opens one, which is the same thing that
   * happens when somebody asks a moment for other sounds like the one
   * suggested.
   */
  reveal?: string;
  title: string;
  body: string;
}

/**
 * The steps, in the order the work actually happens.
 *
 * Each one points at the real part of the screen rather than describing it,
 * because the hard part of a new tool is not what the words mean but where
 * the thing is.
 */
export const STEPS: readonly Step[] = [
  {
    target: '.vstage',
    tab: 'moments',
    title: 'Start with your video',
    body: 'Drag a video here, or choose a file. It is read straight from your disk and never uploaded.',
  },
  {
    target: '.tl__detect',
    tab: 'moments',
    title: 'Let it read the clip',
    body: 'This plays the video through once and measures every cut and fast move in it. Everything else follows from it, so it is the first thing to do. The slider afterwards decides how much of what it found to show you.',
  },
  {
    /*
     * The whole panel, rather than the head of it and then the rest.
     *
     * Accept all had a step of its own until it was watched on a first visit,
     * which is the only visit this happens on: with no clip loaded that button
     * is hidden, so the step pointed at a twenty six pixel line reading "No
     * video loaded" while talking about something that was not on screen.
     */
    target: '.moments',
    tab: 'moments',
    title: 'What it found, and what belongs there',
    body: 'Not just where something happens but what kind of moment it is: a cut, a build, a move, a flurry, a still passage. Each row says what suits it and why, in a line. Play it against the picture, put it down, or pass it over. Accept all takes every suggestion at once, as one thing undo can take back, which is the quickest way to hear what the clip wants.',
  },
  {
    target: '.panel-tabs',
    tab: 'moments',
    title: 'Three panels, one at a time',
    body: 'Moments is what to do next. Sounds is the whole library, for when you want to choose yourself. Selected is whatever is picked on the timeline. The number on Moments is how many are still waiting on you.',
  },
  {
    target: '[data-group="appears"]',
    tab: 'sounds',
    reveal: 'appears',
    title: 'Sounds, under what is happening on screen',
    body: 'Something appears, moves, builds, lands hard. Each group says when to reach for it. The drum kit and the two instruments are in here too, filed the same way: a crash is a wash that covers a cut, so it sits with the other things that cover a cut.',
  },
  {
    target: '.layer-head',
    tab: 'sounds',
    title: 'The four layers have jobs',
    body: 'Impacts is the loudest and driest, Tone the quietest and widest, and the other two sit between. Pick one and it says what it is for. Balance sets all four to those levels at once, so a first pass is not flat. Anything you move afterwards wins.',
  },
  {
    target: '.tl__lanes',
    tab: 'moments',
    title: 'Placing one yourself',
    body: 'Click a lane to put the chosen sound at that moment. Drag it to move it, or its far edge to change how long it runs. The timeline is measured in time and frames rather than in bars, because the picture is.',
  },
  {
    target: '.card--export',
    tab: 'moments',
    title: 'Export something that lines up',
    body: 'The file always starts at zero, so it sits at the head of your composition in sync. One mixed file, or one per layer. The marker list and the MIDI file are for handing the timing to whoever scores it next.',
  },
];
export interface Tour {
  /** Show it, whether or not it has been seen before. */
  start(): void;
  /** Show it only if this is someone's first time. */
  maybeStart(): void;
  close(): void;
}

export interface TourOptions {
  /**
   * Put a panel in front before a step points at it, and open a group if the
   * step needs one.
   *
   * Handled outside because the tour has no session and no panel: it knows
   * which of them a step needs, and the app knows how to show one.
   */
  onShow?(tab: PanelTab, reveal?: string): void;
}

/**
 * The walkthrough shown the first time someone opens the sound design screen.
 *
 * It can be left at any point, and it does not come back on its own once it
 * has been finished or skipped. The help button brings it back.
 */
export function createTour(options: TourOptions = {}): Tour {
  let index = 0;
  let open = false;

  const spot = el('div', { class: 'tour__spot' });
  const title = el('div', { class: 'tour__title' });
  const body = el('div', { class: 'tour__body' });
  const count = el('div', { class: 'tour__count' });

  const back = button({ class: 'chip chip--sm', on: { click: () => go(index - 1) } }, ['Back']);
  const next = button({ class: 'btn-accent', on: { click: () => go(index + 1) } }, ['Next']);
  const skip = button({ class: 'chip chip--sm', on: { click: () => finish() } }, ['Skip']);

  const card = el('div', { class: 'tour__card' }, [
    title,
    body,
    el('div', { class: 'tour__foot' }, [count, el('div', { class: 'tour__spacer' }), skip, back, next]),
  ]);

  const root = el('div', { class: 'tour' }, [spot, card]);
  root.style.display = 'none';

  const onKey = (event: KeyboardEvent): void => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      finish();
    }
    if (event.key === 'ArrowRight' || event.key === 'Enter') {
      event.preventDefault();
      go(index + 1);
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(index - 1);
    }
  };

  function place(step: Step): void {
    const target = step.target ? document.querySelector(step.target) : null;
    const rect = target?.getBoundingClientRect();

    if (!rect || rect.width === 0) {
      // Nothing to point at, so the card sits in the middle and the page is
      // simply dimmed. This happens when a step describes something that is
      // not on screen yet.
      spot.style.display = 'none';
      card.style.left = `${window.innerWidth / 2 - card.offsetWidth / 2}px`;
      card.style.top = `${window.innerHeight / 2 - card.offsetHeight / 2}px`;
      return;
    }

    spot.style.display = '';
    spot.style.left = `${rect.left - 4}px`;
    spot.style.top = `${rect.top - 4}px`;
    spot.style.width = `${rect.width + 8}px`;
    spot.style.height = `${rect.height + 8}px`;

    // Prefer below the highlight, then above, then beside it.
    const width = card.offsetWidth || 320;
    const height = card.offsetHeight || 160;
    let top = rect.bottom + GAP;
    if (top + height > window.innerHeight - 12) top = rect.top - height - GAP;
    if (top < 12) top = Math.min(window.innerHeight - height - 12, Math.max(12, rect.top));

    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(12, Math.min(window.innerWidth - width - 12, left));

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function go(to: number): void {
    if (to < 0) return;
    if (to >= STEPS.length) {
      finish();
      return;
    }
    index = to;
    const step = STEPS[index];
    title.textContent = step.title;
    body.textContent = step.body;
    count.textContent = `${index + 1} of ${STEPS.length}`;
    back.style.visibility = index === 0 ? 'hidden' : '';
    next.textContent = index === STEPS.length - 1 ? 'Done' : 'Next';
    // Before measuring, since what a step points at may be on a panel that is
    // not showing, and a hidden thing has no place on screen to point at.
    options.onShow?.(step.tab, step.reveal);
    // Measure after the text is in, or the card is placed at the wrong size.
    requestAnimationFrame(() => place(step));
  }

  function finish(): void {
    open = false;
    root.style.display = 'none';
    // Left where somebody starts rather than on whichever panel the last step
    // needed. Being walked around a room does not mean wanting to be left in
    // the corner it ended in.
    options.onShow?.('moments');
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', reposition);
    try {
      localStorage.setItem(STORAGE_KEY, 'done');
    } catch {
      // If it cannot be remembered the tour shows again, which is a small cost.
    }
  }

  function reposition(): void {
    if (open) place(STEPS[index]);
  }

  function start(): void {
    if (!root.isConnected) document.body.appendChild(root);
    open = true;
    root.style.display = '';
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', reposition);
    go(0);
  }

  return {
    start,
    maybeStart() {
      let seen = false;
      try {
        seen = localStorage.getItem(STORAGE_KEY) === 'done';
      } catch {
        seen = false;
      }
      if (!seen) start();
    },
    close: finish,
  };
}
