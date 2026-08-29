import type { SoundDesignSession } from '../../sound-design-session.ts';
import type { AppState, PanelTab } from '../../store.ts';
import { button, el, setText, toggleClass } from '../dom.ts';
import type { View } from '../view.ts';
import { MOMENT_GROUP_FOR } from '../../audio/suggest.ts';
import { createMomentsPanel } from './moments.ts';
import { createSoundDesignPanel } from './panel.ts';

/**
 * The right panel: what to do next, what to choose, and what is chosen.
 *
 * Three jobs used to be one column six screens deep, which meant the first
 * thing somebody new saw was a wall of sounds and no reason to prefer any of
 * them. They are separated here because they are done at different times.
 * Moments is what a scanned video opens on, since for somebody who has never
 * done this the list of what to do next is the app; Sounds is for choosing
 * something yourself; Selected is the sound already down.
 *
 * The tab strip is the only new thing on screen. Everything under it is the
 * panel that was already there, moved rather than rebuilt, so nothing that
 * worked before works differently now.
 */
export interface WorkPanelView extends View {
  /** Open the library at one moment group, unfolding whatever is in the way. */
  openGroup(id: string): void;
  /** Back to the moment list, at the top. */
  home(): void;
  /** Put the export options in front, wherever the panel was left. */
  showExport(): void;
}

export function createWorkPanel(session: SoundDesignSession): WorkPanelView {
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

  const TABS: readonly { id: PanelTab; label: string; title: string }[] = [
    { id: 'moments', label: 'Moments', title: 'What the video suggests, and why' },
    { id: 'sounds', label: 'Sounds', title: 'Choose a sound yourself' },
    { id: 'selected', label: 'Selected', title: 'The sound picked on the timeline' },
  ];

  /**
   * The count beside the Moments tab.
   *
   * There so that somebody working in the Sounds tab can see there is still a
   * list waiting without going back to look. It disappears at nought rather
   * than showing a zero, because a badge saying nothing is left is a badge
   * asking to be read for no reason.
   */
  const waiting = el('span', { class: 'panel-tab__count' });

  const buttons = TABS.map((tab) => ({
    ...tab,
    node: button(
      {
        class: 'panel-tab',
        title: tab.title,
        on: { click: () => session.setPanelTab(tab.id) },
      },
      tab.id === 'moments' ? [el('span', { text: tab.label }), waiting] : [tab.label],
    ),
  }));

  const strip = el(
    'div',
    { class: 'panel-tabs', attrs: { role: 'tablist' } },
    buttons.map((tab) => tab.node),
  );

  const body = el('div', { class: 'panel-body' }, [
    moments.el,
    panel.soundsPage,
    panel.selectedPage,
  ]);

  const root = el('aside', { class: 'inspector inspector--work' }, [strip, body, panel.tail]);

  const pages: Record<PanelTab, HTMLElement> = {
    moments: moments.el,
    sounds: panel.soundsPage,
    selected: panel.selectedPage,
  };

  return {
    el: root,
    openGroup: (id) => panel.openGroup(id),

    home() {
      session.setPanelTab('moments');
      // Scrolled as well as switched: a panel left half way down the library
      // is not "back", it is the same place with different contents.
      root.scrollTop = 0;
    },

    showExport() {
      // Only what the panel does itself: it scrolls to the export card, which
      // is not the bottom of the panel — the palette is under it.
      panel.showExport();
    },

    update(state: AppState, previous: AppState | null) {
      // Both children are updated whichever tab is showing. They are cheap,
      // and a panel that only refreshes what is visible is a panel that shows
      // the state from two tabs ago the moment you switch.
      panel.update(state, previous);
      moments.update(state, previous);

      const left = session.momentsLeft;
      setText(waiting, left ? String(left) : '');
      waiting.style.display = left ? '' : 'none';

      for (const tab of buttons) {
        const on = state.panelTab === tab.id;
        toggleClass(tab.node, 'is-on', on);
        tab.node.setAttribute('aria-selected', on ? 'true' : 'false');
      }
      for (const [id, page] of Object.entries(pages)) {
        page.style.display = state.panelTab === id ? '' : 'none';
      }
    },
  };
}
