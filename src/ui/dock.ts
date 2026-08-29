import { button, clear, el } from './dom.ts';

/** One thing that can be docked, and what to call it. */
export interface DockPanel {
  id: string;
  title: string;
  /** What it says when there is nothing else to say, on its tab. */
  hint?: string;
  el: HTMLElement;
}

/** The two columns a panel can live in. */
export type DockSide = 'left' | 'right';

export const SIDES: readonly DockSide[] = ['left', 'right'];

interface Layout {
  left: string[];
  right: string[];
  /** Which panel is showing in each column. */
  active: Record<DockSide, string | null>;
}

const STORAGE_KEY = 'toolcraft.st88.docks';

/**
 * Where everything starts, for somebody who has never moved anything.
 *
 * All of it on the right, in the order the work happens: what the video
 * suggests, then choosing something yourself, then the sound you picked, then
 * the three cards that are about the piece rather than about a sound. The left
 * column starts empty and takes no room until something is put in it, because
 * a second column of chrome is a cost somebody should have to ask for.
 */
const DEFAULT_LAYOUT: Layout = {
  left: [],
  right: ['moments', 'sounds', 'selected', 'export', 'session', 'palette'],
  active: { left: null, right: 'moments' },
};

export interface Docks {
  /** The two columns, to be put in the page either side of the work. */
  nodes: Record<DockSide, HTMLElement>;
  /** Bring a panel to the front of whatever column it is in. */
  reveal(id: string): void;
  /** Which panel is showing on a side, if any. */
  showing(side: DockSide): string | null;
  /** Every panel, and where it currently is. Null means closed. */
  places(): { panel: DockPanel; side: DockSide | null }[];
  /** Put a closed panel back, or take an open one away. */
  toggle(id: string): void;
  /** Everything back where it started. */
  reset(): void;
}

export interface DockOptions {
  /** Called whenever anything moves, so the window menu can catch up. */
  onChange?(): void;
  /** Called when a column goes from empty to occupied or back. */
  onResize?(): void;
}

/**
 * Two columns of panels, and the dragging that moves things between them.
 *
 * Adobe's docking is a tree: every region splits into two, either of which
 * can split again, so a panel can end up anywhere. That is the right answer
 * for an app with thirty panels and a decade of people who have arranged them
 * their own way. This app has six, and the useful part of docking for six is
 * not arbitrary geometry — it is being able to say "I want the moment list
 * beside the library rather than behind it", which two columns cover.
 *
 * So: two columns, each a stack of tabs, drag a tab to move it. The left one
 * is empty until something is dragged into it and costs nothing until then.
 * What is deliberately not here is splitting a column into two rows, floating
 * a panel in its own window, and saving named workspaces; each of those is a
 * lot of machinery for an arrangement nobody with six panels has asked for.
 */
export function createDocks(panels: readonly DockPanel[], options: DockOptions = {}): Docks {
  const byId = new Map(panels.map((panel) => [panel.id, panel]));
  let layout = load(panels);

  const strips: Record<DockSide, HTMLElement> = {
    left: el('div', { class: 'dock__tabs', attrs: { role: 'tablist' } }),
    right: el('div', { class: 'dock__tabs', attrs: { role: 'tablist' } }),
  };
  const bodies: Record<DockSide, HTMLElement> = {
    left: el('div', { class: 'dock__body' }),
    right: el('div', { class: 'dock__body' }),
  };

  /**
   * What an empty column says while something is being carried.
   *
   * An empty column is nothing at all until it is needed, which is right when
   * nothing is happening and useless the moment somebody is dragging a panel
   * towards it: there is no target, so the drop misses and the panel snaps
   * back with no explanation. It opens to a visible width for the duration of
   * a drag and says what it is, so there is something to aim at.
   */
  const hint = (): HTMLElement => el('div', { class: 'dock__drop', text: 'Drop a panel here' });

  const nodes: Record<DockSide, HTMLElement> = {
    left: el('aside', { class: 'dock dock--left' }, [strips.left, bodies.left, hint()]),
    right: el('aside', { class: 'dock dock--right' }, [strips.right, bodies.right, hint()]),
  };

  /** Which side a panel is on, or null when it has been closed. */
  function sideOf(id: string): DockSide | null {
    for (const side of SIDES) if (layout[side].includes(id)) return side;
    return null;
  }

  /**
   * Draw the columns.
   *
   * `announce` is false for the very first one, because that is not a change:
   * whoever is being told about it is usually something built alongside these
   * columns and not finished yet, and telling it about an arrangement it has
   * not seen a first version of is how you reach for a divider that does not
   * exist.
   */
  function paint(announce = true): void {
    for (const side of SIDES) {
      const ids = layout[side].filter((id) => byId.has(id));
      nodes[side].classList.toggle('is-empty', ids.length === 0);

      // Nothing showing, or showing something that has since moved away.
      if (!ids.includes(layout.active[side] ?? '')) {
        layout.active[side] = ids[0] ?? null;
      }

      clear(strips[side]);
      for (const id of ids) {
        const panel = byId.get(id)!;
        const on = layout.active[side] === id;
        const tab = button(
          {
            class: on ? 'dock__tab is-on' : 'dock__tab',
            attrs: { role: 'tab', 'aria-selected': on ? 'true' : 'false', title: panel.hint ?? panel.title },
            dataset: { panel: id },
            on: {
              click: () => {
                layout.active[side] = id;
                save(layout);
                paint();
              },
            },
          },
          [el('span', { class: 'dock__tab-name', text: panel.title })],
        );
        tab.addEventListener('pointerdown', (event) => beginTabDrag(event, id, tab));
        strips[side].appendChild(tab);
      }

      /*
       * Only the panel on top is in the document.
       *
       * Hidden ones are taken out rather than left with display:none, because
       * they are put back by being appended and an element can only be in one
       * place: moving a panel between columns is the same operation as showing
       * it, so there is one way of doing it rather than two.
       */
      clear(bodies[side]);
      const active = layout.active[side];
      if (active) bodies[side].appendChild(byId.get(active)!.el);
    }
    if (!announce) return;
    options.onChange?.();
    options.onResize?.();
  }

  /* ---------- dragging a tab from one column to the other ---------- */

  /** How far a press has to travel before it is a drag rather than a click. */
  const DRAG_PX = 5;

  function beginTabDrag(event: PointerEvent, id: string, tab: HTMLElement): void {
    if (event.button !== 0) return;
    const fromX = event.clientX;
    const fromY = event.clientY;
    let ghost: HTMLElement | null = null;
    let over: DockSide | null = null;

    const move = (e: PointerEvent): void => {
      if (!ghost) {
        if (Math.hypot(e.clientX - fromX, e.clientY - fromY) < DRAG_PX) return;
        // Only now is it a drag, so a plain click still just selects the tab.
        ghost = el('div', { class: 'dock__ghost', text: byId.get(id)?.title ?? id });
        document.body.appendChild(ghost);
        tab.classList.add('is-dragging');
        document.body.classList.add('is-docking');
      }
      ghost.style.left = `${e.clientX + 12}px`;
      ghost.style.top = `${e.clientY + 12}px`;

      const now = sideUnder(e.clientX, e.clientY);
      if (now !== over) {
        for (const side of SIDES) nodes[side].classList.toggle('is-target', side === now);
        over = now;
      }
    };

    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);

      /*
       * It lands where the highlight said it would.
       *
       * Read from what the last move worked out rather than asked again here,
       * for two reasons. Dropping somewhere other than the lit column would be
       * a lie whatever the arithmetic said. And the answer would be different:
       * clearing the drag below collapses an empty column back to nothing, so
       * asking afterwards is asking about a column that is no longer there,
       * which is how a drop into an empty column came to do nothing at all.
       */
      const to = over;

      for (const side of SIDES) nodes[side].classList.remove('is-target');
      tab.classList.remove('is-dragging');
      document.body.classList.remove('is-docking');
      ghost?.remove();
      if (!ghost || !to) return;

      moveTo(id, to);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /**
   * Which column a point is over.
   *
   * By rectangle rather than by what is under the pointer, so an empty column
   * with nothing in it to hit is still a place a panel can be dropped — which
   * is the only way anything ever gets into the left one.
   */
  function sideUnder(x: number, y: number): DockSide | null {
    for (const side of SIDES) {
      const box = nodes[side].getBoundingClientRect();
      if (box.width < 1) continue;
      /*
       * A little past the outside edge still counts.
       *
       * Dragging a panel to the left of the window is what somebody means by
       * "put it on the left", and stopping at the exact pixel where the column
       * starts asks for an accuracy nobody has while carrying something.
       */
      const slack = 24;
      const left = side === 'left' ? box.left - slack : box.left;
      const right = side === 'left' ? box.right : box.right + slack;
      if (x >= left && x <= right && y >= box.top && y <= box.bottom) return side;
    }
    return null;
  }

  function moveTo(id: string, side: DockSide): void {
    const from = sideOf(id);
    if (from === side) {
      // Already here: bring it to the front rather than doing nothing, since
      // dropping something on the column it is in plainly means "show me it".
      layout.active[side] = id;
      save(layout);
      paint();
      return;
    }
    if (from) layout[from] = layout[from].filter((one) => one !== id);
    layout[side] = [...layout[side], id];
    layout.active[side] = id;
    save(layout);
    paint();
  }

  paint(false);

  return {
    nodes,

    reveal(id: string) {
      const side = sideOf(id);
      if (!side) {
        // Closed. Asking for it is asking for it back, and it comes back where
        // it started rather than wherever it was last, which nothing remembers.
        const home = DEFAULT_LAYOUT.left.includes(id) ? 'left' : 'right';
        layout[home] = [...layout[home], id];
        layout.active[home] = id;
      } else {
        layout.active[side] = id;
      }
      save(layout);
      paint();
    },

    showing: (side) => layout.active[side],

    places: () =>
      panels.map((panel) => ({ panel, side: sideOf(panel.id) })),

    toggle(id: string) {
      const side = sideOf(id);
      if (side) {
        layout[side] = layout[side].filter((one) => one !== id);
      } else {
        const home = DEFAULT_LAYOUT.left.includes(id) ? 'left' : 'right';
        layout[home] = [...layout[home], id];
        layout.active[home] = id;
      }
      save(layout);
      paint();
    },

    reset() {
      layout = { left: [...DEFAULT_LAYOUT.left], right: [...DEFAULT_LAYOUT.right], active: { ...DEFAULT_LAYOUT.active } };
      save(layout);
      paint();
    },
  };
}

/**
 * What was saved last time, checked against what actually exists.
 *
 * A stored layout outlives the code that made it: a panel can be renamed or
 * dropped between one visit and the next, and one that was added since will
 * not be in the file at all. So anything unknown is thrown away and anything
 * missing is put back where it starts, rather than trusting the file and
 * ending up with a panel nobody can reach.
 */
function load(panels: readonly DockPanel[]): Layout {
  const known = new Set(panels.map((panel) => panel.id));
  const fallback = (): Layout => ({
    left: DEFAULT_LAYOUT.left.filter((id) => known.has(id)),
    right: DEFAULT_LAYOUT.right.filter((id) => known.has(id)),
    active: { ...DEFAULT_LAYOUT.active },
  });

  let saved: Partial<Layout> | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Layout> | null;
  } catch {
    saved = null;
  }
  if (!saved || !Array.isArray(saved.left) || !Array.isArray(saved.right)) return fallback();

  const seen = new Set<string>();
  const keep = (ids: unknown): string[] =>
    (Array.isArray(ids) ? ids : [])
      .filter((id): id is string => typeof id === 'string' && known.has(id) && !seen.has(id))
      .map((id) => {
        seen.add(id);
        return id;
      });

  const left = keep(saved.left);
  const right = keep(saved.right);

  /*
   * A panel the file has never heard of goes where it starts, not nowhere.
   *
   * Otherwise adding a panel would ship it closed to everybody who had ever
   * moved anything, which is the sort of thing nobody notices for a month.
   */
  for (const panel of panels) {
    if (seen.has(panel.id)) continue;
    if (DEFAULT_LAYOUT.left.includes(panel.id)) left.push(panel.id);
    else right.push(panel.id);
  }

  const active = saved.active ?? {};
  const pick = (side: DockSide, ids: string[]): string | null => {
    const wanted = (active as Record<string, unknown>)[side];
    return typeof wanted === 'string' && ids.includes(wanted) ? wanted : (ids[0] ?? null);
  };

  return { left, right, active: { left: pick('left', left), right: pick('right', right) } };
}

function save(layout: Layout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Not being able to remember an arrangement is not worth interrupting
    // anyone over; it comes back where it started next time.
  }
}
