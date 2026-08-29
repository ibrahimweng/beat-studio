import type { SoundDesignSession } from '../../sound-design-session.ts';
import type { AppState, PanelTab } from '../../store.ts';
import { el } from '../dom.ts';
import type { View } from '../view.ts';
import { MOMENT_GROUP_FOR } from '../../audio/suggest.ts';
import { createDocks, type DockPanel, type DockSide, type Docks } from '../dock.ts';
import { createMomentsPanel } from './moments.ts';
import { createSoundDesignPanel } from './panel.ts';

/**
 * The panels, and the two columns they can be put in.
 *
 * These used to be one column: three tabs over a shared body, with three more
 * cards stuck underneath belonging to no tab at all. That is a fixed
 * arrangement, and the one thing everybody who works in an editor does first
 * is rearrange it — usually to put the list of what to do next beside the
 * library rather than behind it, which was the one thing that column could
 * not do.
 *
 * So the six are panels now, each draggable by its tab into either column.
 * Everything starts on the right, exactly where it was, and the left column
 * costs nothing until something is dragged into it.
 */
export interface WorkPanelView extends View {
  /** The two columns, for the page to put either side of the work. */
  docks: Record<DockSide, HTMLElement>;
  /** Open the library at one moment group, unfolding whatever is in the way. */
  openGroup(id: string): void;
  /** Put the export options in front, wherever they have been put. */
  showExport(): void;
  /** Every panel and where it is, for the window menu. */
  places(): { panel: DockPanel; side: DockSide | null }[];
  /** Put a closed panel back, or take an open one away. */
  toggle(id: string): void;
  /** Everything back where it started. */
  resetLayout(): void;
}

export function createWorkPanel(
  session: SoundDesignSession,
  options: { onLayout?(): void } = {},
): WorkPanelView {
  const panel = createSoundDesignPanel(session);

  /*
   * The one place the two panels meet.
   *
   * Wired here rather than inside either, because neither of them should have
   * to know the other exists: the moment list knows what kind of moment was
   * asked about, the library knows how to show a group, and this is the file
   * that already holds both.
   */
  const moments = createMomentsPanel(session, {
    onShowOthers: (kind) => {
      session.setPanelTab('sounds');
      panel.openGroup(MOMENT_GROUP_FOR[kind]);
    },
  });

  const PANELS: readonly DockPanel[] = [
    { id: 'moments', title: 'Moments', hint: 'What the video suggests, and why', el: moments.el },
    { id: 'sounds', title: 'Sounds', hint: 'Choose a sound yourself', el: panel.soundsPage },
    { id: 'selected', title: 'Selected', hint: 'The sound picked on the timeline', el: panel.selectedPage },
    { id: 'export', title: 'Export', hint: 'Write the piece out as a file', el: panel.exportCard },
    { id: 'session', title: 'Session', hint: 'Save, open, or start again', el: panel.sessionCard },
    { id: 'palette', title: 'Palette', hint: 'Write the sound catalogue out for somebody else', el: panel.paletteCard },
  ];

  const docks: Docks = createDocks(PANELS, {
    onResize: () => options.onLayout?.(),
  });

  /*
   * A holder for the view interface, which nothing puts on screen.
   *
   * The two columns go into the page on either side of the work rather than
   * together, so there is no single element that is "the panel" any more.
   */
  const root = el('div', { class: 'docks' });

  /** Which panel a tab id in the store refers to. They are the same words. */
  const forTab = (tab: PanelTab): string => tab;

  let shownTab: PanelTab | null = null;

  return {
    el: root,
    docks: docks.nodes,
    openGroup: (id) => panel.openGroup(id),
    places: () => docks.places(),
    toggle: (id) => docks.toggle(id),
    resetLayout: () => docks.reset(),

    showExport() {
      docks.reveal('export');
      panel.showExport();
    },

    update(state: AppState, previous: AppState | null) {
      // Both children are updated whichever panel is showing. They are cheap,
      // and a panel that only refreshes what is visible is a panel that shows
      // the state from two tabs ago the moment it comes back to the front.
      panel.update(state, previous);
      moments.update(state, previous);

      /*
       * The count that used to ride on the Moments tab is gone from here.
       *
       * A dock tab is a name and nothing else: one that is sometimes wider
       * than itself makes the whole strip shift as you work, and worse, it
       * has to be redrawn on every change to a thing it is not about. The
       * moment list's own heading has said "three waiting on you" all along,
       * next to the three, which is where a count belongs.
       */

      /*
       * The store still says which of the three is wanted, and the docks are
       * what answer it.
       *
       * Everything that used to switch tabs — the walkthrough, the rail's home
       * button, going to the library from a moment row — still says the same
       * thing it always did. What changed is that the answer is now "bring
       * that panel to the front of whichever column it is in" rather than
       * "show page two of three", so none of those callers had to learn where
       * anything is.
       */
      if (state.panelTab !== shownTab) {
        shownTab = state.panelTab;
        docks.reveal(forTab(state.panelTab));
      }
    },
  };
}
