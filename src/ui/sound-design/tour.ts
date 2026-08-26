import { button, el } from '../dom.ts';

const STORAGE_KEY = 'toolcraft.st88.tour';
/** Space between the highlight and the card, in pixels. */
const GAP = 14;

interface Step {
  /** What to point at. The step still shows if nothing matches. */
  target?: string;
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
const STEPS: readonly Step[] = [
  {
    target: '.vstage',
    title: 'Start with your video',
    body: 'Drag a video here, or choose a file. It is read straight from your disk and never uploaded.',
  },
  {
    target: '.inspector .pick-row',
    title: 'Pick a sound',
    body: 'Impacts land a hit. Whooshes carry a move. Risers lead into one. The drum kit, piano and guitar are here too.',
  },
  {
    target: '.tl__lanes',
    title: 'Place it on the timeline',
    body: 'Click a lane to put the sound at that moment. Drag it to move it, or drag its far edge to change how long it runs for. The timeline is measured in time and frames, not in bars.',
  },
  {
    target: '.tl__detect',
    title: 'Or let it find the hits',
    body: 'This reads the video and suggests where sounds belong. Every cut and fast move shows up. The slider decides how many to show.',
  },
  {
    target: '.split',
    title: 'Give yourself room',
    body: 'Drag this line to make the timeline bigger. The video scales down to fit. Double click it to put it back.',
  },
  {
    target: '.inspector .card',
    title: 'Land it on the right frame',
    body: 'A riser should finish on the hit rather than start on it, so set it to end on the marker. Arrow keys move a frame at a time.',
  },
  {
    target: '.inspector .btn-accent',
    title: 'Export something that lines up',
    body: 'The file always starts at zero, so it sits at the head of your composition in sync. One mixed file, or one per layer.',
  },
];

export interface Tour {
  /** Show it, whether or not it has been seen before. */
  start(): void;
  /** Show it only if this is someone's first time. */
  maybeStart(): void;
  close(): void;
}

/**
 * The walkthrough shown the first time someone opens the sound design screen.
 *
 * It can be left at any point, and it does not come back on its own once it
 * has been finished or skipped. The help button brings it back.
 */
export function createTour(): Tour {
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
    // Measure after the text is in, or the card is placed at the wrong size.
    requestAnimationFrame(() => place(step));
  }

  function finish(): void {
    open = false;
    root.style.display = 'none';
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
