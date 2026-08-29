import { button, el } from './dom.ts';

/**
 * One line of a context menu.
 *
 * A separator is a line with nothing on it, which is why `label` is what
 * tells the two apart rather than a kind field: there is no such thing as a
 * separator with a label, and no such thing as an item without one.
 */
export type MenuItem =
  | { separator: true }
  | {
      separator?: false;
      label: string;
      /** The shortcut that does the same thing, printed on the right. */
      keys?: string;
      /** Greyed and unclickable, for a thing that is right here but not now. */
      disabled?: boolean;
      /** Marked as currently on, for the entries that are a state. */
      on?: boolean;
      run(): void;
    };

/** How far from the edge of the window a menu is allowed to sit. */
const EDGE = 8;

let open: (() => void) | null = null;

/** Shut whatever menu is open, if any. */
export function closeMenu(): void {
  open?.();
}

/**
 * Put a menu at a point on screen.
 *
 * Right-clicking is how anybody who works in an editor asks "what can I do
 * with this", and until now the answer everywhere in this app was the
 * browser's own menu, which offers to reload the page and save the picture.
 * Every menu here is built from what was actually clicked, so the answer is
 * about that sound, that layer or that point rather than about the document.
 *
 * One at a time, and it closes on anything that is not choosing from it: a
 * press elsewhere, Escape, a scroll, or the window changing size. A menu that
 * outlives what it was about is a menu whose entries have stopped meaning
 * what they say.
 */
export function openMenu(x: number, y: number, items: readonly MenuItem[]): void {
  closeMenu();
  if (!items.length) return;

  const root = el('div', {
    class: 'menu',
    attrs: { role: 'menu' },
  });

  for (const item of items) {
    if (item.separator) {
      root.appendChild(el('div', { class: 'menu__rule' }));
      continue;
    }
    const node = button(
      {
        class: 'menu__item',
        attrs: { role: 'menuitem', ...(item.disabled ? { 'aria-disabled': 'true' } : {}) },
        on: {
          click: () => {
            if (item.disabled) return;
            shut();
            item.run();
          },
        },
      },
      [
        el('span', { class: 'menu__label', text: item.label }),
        ...(item.keys ? [el('span', { class: 'menu__keys', text: item.keys })] : []),
      ],
    );
    node.disabled = Boolean(item.disabled);
    if (item.on) node.classList.add('is-on');
    root.appendChild(node);
  }

  document.body.appendChild(root);

  /*
   * Placed after it is in the document, because until then it has no size.
   *
   * Flipped rather than clamped when it will not fit below or to the right:
   * a menu pushed up against the bottom of the window covers the thing it is
   * about, where one opening upwards leaves it visible.
   */
  const box = root.getBoundingClientRect();
  const left =
    x + box.width + EDGE > window.innerWidth ? Math.max(EDGE, x - box.width) : x;
  const top =
    y + box.height + EDGE > window.innerHeight
      ? Math.max(EDGE, y - box.height)
      : y;
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      shut();
    }
  };
  // Capture, so a press inside the menu is not treated as a press outside it
  // by an element that would otherwise see it first.
  const onDown = (event: Event): void => {
    if (!root.contains(event.target as Node)) shut();
  };

  function shut(): void {
    if (open !== shut) return;
    open = null;
    root.remove();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('resize', shut);
    window.removeEventListener('blur', shut);
    document.removeEventListener('scroll', shut, true);
  }

  open = shut;
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('resize', shut);
  window.addEventListener('blur', shut);
  document.addEventListener('scroll', shut, true);
}

/**
 * The modifier as it is written where the app is running.
 *
 * Printed on the entries rather than assumed, because a menu that tells a Mac
 * user to press Ctrl is a menu they will try once.
 */
export const MOD = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';
