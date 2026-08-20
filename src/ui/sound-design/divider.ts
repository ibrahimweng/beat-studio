import { el } from '../dom.ts';

/** Smallest useful timeline: the bar, the ruler and a couple of lanes. */
const MIN_TIMELINE = 140;
/** Leave at least this much video, so it never disappears without warning. */
const MIN_VIDEO = 56;
const DEFAULT_TIMELINE = 268;
const STORAGE_KEY = 'toolcraft.st88.split';

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
