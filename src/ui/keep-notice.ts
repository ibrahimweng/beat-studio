import type { AppState } from '../store.ts';
import { button, el, toggleClass } from './dom.ts';
import type { View } from './view.ts';

/**
 * The line that appears when this tab is not the one keeping the piece.
 *
 * Loud on purpose, and not dismissible. Two tabs on one piece used to mean the
 * last one to save quietly won and the other's work was gone while still being
 * drawn on screen, which is the worst kind of failure: nothing looks wrong.
 * Now only one tab writes, and the others say so here.
 *
 * Floating rather than part of the layout, because it is a rare state and
 * reflowing the whole shell for it would move the timeline under the pointer
 * of somebody who is mid-drag.
 */
export function createKeepNotice(options: { onTakeOver: () => void }): View {
  const root = el('div', { class: 'keep-notice' }, [
    el('span', { class: 'keep-notice__dot' }),
    el('span', {
      class: 'keep-notice__what',
      text: 'Another tab has this project open. Changes here are not being kept.',
    }),
    button(
      {
        class: 'chip chip--sm',
        title: 'Keep the project from this tab instead of the other one',
        on: { click: () => options.onTakeOver() },
      },
      ['Keep here instead'],
    ),
  ]);
  root.style.display = 'none';

  return {
    el: root,
    update(state: AppState) {
      const show = !state.keeping;
      root.style.display = show ? '' : 'none';
      toggleClass(root, 'is-on', show);
    },
  };
}
