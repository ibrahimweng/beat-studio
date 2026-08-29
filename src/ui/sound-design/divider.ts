import { el } from '../dom.ts';

/** Smallest useful timeline: the bar, the ruler and a couple of lanes. */
const MIN_TIMELINE = 140;
/** Leave at least this much video, so it never disappears without warning. */
const MIN_VIDEO = 56;
const DEFAULT_TIMELINE = 268;
const STORAGE_KEY = 'toolcraft.st88.split';

/** Narrow enough to be out of the way, wide enough that a sound row still reads. */
const MIN_PANEL = 260;
/** Leave this much of the middle column, whatever the panel is dragged to. */
const MIN_MIDDLE = 420;
const DEFAULT_PANEL = 340;
const PANEL_KEY = 'toolcraft.st88.panel';

export interface Divider {
  el: HTMLElement;
  /** Re-apply the stored height, clamped to the space now available. */
  refresh(): void;
}

/**
 * The line between the video and the timeline.
 *
 * Drag it and the timeline takes the space while the video scales down to
 * whatever is left, which is what you want once there are more layers than
 * fit. The height is remembered between sessions, and double clicking puts it
 * back to where it started.
 */
export function createDivider(options: {
  /** The column both panels live in, used to work out the space available. */
  container: () => HTMLElement;
  /** The element whose height is being set. */
  timeline: () => HTMLElement;
  /** Called after a resize, so anything measuring itself can catch up. */
  onResize?: () => void;
}): Divider {
  let height = load();

  const apply = (value: number): void => {
    const container = options.container();
    const available = container.clientHeight;
    // Clamped every time, because the window may have changed size since.
    const max = Math.max(MIN_TIMELINE, available - MIN_VIDEO);
    height = Math.max(MIN_TIMELINE, Math.min(max, value));
    options.timeline().style.setProperty('--tl-height', `${height}px`);
    options.onResize?.();
  };

  const root = el('div', {
    class: 'split',
    attrs: {
      role: 'separator',
      'aria-orientation': 'horizontal',
      'aria-label': 'Resize the timeline',
      title: 'Drag to resize. Double click to reset.',
    },
    on: {
      pointerdown: (event) => {
        event.preventDefault();
        root.setPointerCapture(event.pointerId);
        root.classList.add('is-dragging');
        document.querySelector('.app')?.classList.add('is-resizing');

        const move = (e: PointerEvent): void => {
          const bottom = options.container().getBoundingClientRect().bottom;
          apply(bottom - e.clientY);
          save(height);
        };
        const end = (): void => {
          root.classList.remove('is-dragging');
          document.querySelector('.app')?.classList.remove('is-resizing');
          root.removeEventListener('pointermove', move);
          root.removeEventListener('pointerup', end);
          root.removeEventListener('pointercancel', end);
        };

        root.addEventListener('pointermove', move);
        root.addEventListener('pointerup', end);
        root.addEventListener('pointercancel', end);
      },
      dblclick: () => {
        apply(DEFAULT_TIMELINE);
        save(DEFAULT_TIMELINE);
      },
    },
  });

  // The window can change size while the app is open.
  window.addEventListener('resize', () => apply(height));

  return {
    el: root,
    refresh: () => apply(height),
  };
}

function load(): number {
  try {
    const raw = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(raw) && raw >= MIN_TIMELINE ? raw : DEFAULT_TIMELINE;
  } catch {
    return DEFAULT_TIMELINE;
  }
}

function save(value: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.round(value)));
  } catch {
    // Not being able to remember the size is not worth interrupting anyone.
  }
}


/**
 * The line between the middle column and the panel on the right.
 *
 * The same thing as the one above, turned ninety degrees, and separate from
 * it because almost nothing is shared once the axis changes: a different
 * property, a different edge to measure from, a different pair of minimums
 * and a different key to remember it under. Folding the two together came out
 * as a function that took an axis and then branched on it in every line.
 *
 * The panel is where the moment list, the library and the export card all
 * live, and 340 pixels is a guess at how wide a sentence about a moment wants
 * to be. It is a guess somebody should be able to overrule, which is what
 * this is for.
 */
export function createPanelDivider(options: {
  /** The row the middle column and the panel sit in. */
  container: () => HTMLElement;
  /** The panel whose width is being set. */
  panel: () => HTMLElement;
  onResize?: () => void;
}): Divider {
  let width = loadPanel();

  const apply = (value: number): void => {
    const available = options.container().clientWidth;
    const max = Math.max(MIN_PANEL, available - MIN_MIDDLE);
    width = Math.max(MIN_PANEL, Math.min(max, value));
    options.panel().style.setProperty('--panel-width', `${width}px`);
    options.onResize?.();
  };

  const root = el('div', {
    class: 'split split--side',
    attrs: {
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': 'Resize the panel',
      title: 'Drag to resize. Double click to reset.',
    },
    on: {
      pointerdown: (event) => {
        event.preventDefault();
        root.setPointerCapture(event.pointerId);
        root.classList.add('is-dragging');
        document.querySelector('.app')?.classList.add('is-resizing-side');

        const move = (e: PointerEvent): void => {
          const right = options.container().getBoundingClientRect().right;
          apply(right - e.clientX);
          savePanel(width);
        };
        const end = (): void => {
          root.classList.remove('is-dragging');
          document.querySelector('.app')?.classList.remove('is-resizing-side');
          root.removeEventListener('pointermove', move);
          root.removeEventListener('pointerup', end);
          root.removeEventListener('pointercancel', end);
        };

        root.addEventListener('pointermove', move);
        root.addEventListener('pointerup', end);
        root.addEventListener('pointercancel', end);
      },
      dblclick: () => {
        apply(DEFAULT_PANEL);
        savePanel(DEFAULT_PANEL);
      },
    },
  });

  window.addEventListener('resize', () => apply(width));

  return {
    el: root,
    refresh: () => apply(width),
  };
}

function loadPanel(): number {
  try {
    const raw = Number(localStorage.getItem(PANEL_KEY));
    return Number.isFinite(raw) && raw >= MIN_PANEL ? raw : DEFAULT_PANEL;
  } catch {
    return DEFAULT_PANEL;
  }
}

function savePanel(value: number): void {
  try {
    localStorage.setItem(PANEL_KEY, String(Math.round(value)));
  } catch {
    // Not being able to remember the size is not worth interrupting anyone.
  }
}
