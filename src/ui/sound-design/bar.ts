import type { SoundDesignSession } from '../../sound-design-session.ts';
import type { AppState } from '../../store.ts';
import { button, el, setText } from '../dom.ts';
import type { View } from '../view.ts';
import { helpButton } from '../help.ts';
import { waveMark } from '../icons.ts';

export interface SoundDesignBarView extends View {}

export interface SoundDesignBarOptions {
  /** Put the export options in front. */
  onExport?(): void;
}

/**
 * The app bar: what is open, and the way out.
 *
 * It used to hold the transport, the timecode, the frame rate, the snapping
 * and two switches, which is everything you touch while you work sitting
 * above everything you work on. That made sense while there were six screens
 * and this bar was the part they had in common. There is one screen now.
 *
 * So the working controls went down onto the timeline they drive, and what
 * is left here is what belongs to the piece rather than to the moment: what
 * is loaded, how to get a file out of it, and where to ask. One row, nothing
 * in it that changes while the playhead moves, and room enough that nothing
 * has to be measured against a breakpoint to fit.
 */
export function createSoundDesignBar(
  session: SoundDesignSession,
  options: SoundDesignBarOptions = {},
): SoundDesignBarView {
  /**
   * The name of the clip being worked on, which is what a title bar is for.
   *
   * Nothing said what was loaded anywhere in the app. On a second pass over
   * a folder of takes that is the one thing you want the window to tell you
   * without being asked.
   */
  const title = el('div', { class: 'appbar__title', text: 'No video loaded' });

  const exportButton = button(
    {
      class: 'btn-accent appbar__export',
      title: 'Write the piece out as a file',
      on: { click: () => options.onExport?.() },
    },
    ['Export'],
  );

  const root = el('header', { class: 'topbar appbar' }, [
    el('div', { class: 'appbar__mark' }, [waveMark([6, 14, 9, 4], 2, 2, 3)]),
    title,
    el('div', { class: 'topbar__spacer' }),
    exportButton,
    helpButton('start', 'this app'),
  ]);

  return {
    el: root,
    update(state: AppState) {
      const name = state.project.videoName;
      setText(title, name ?? 'No video loaded');
      // Nothing to write until something is on the timeline. The card in the
      // panel says the same thing at more length; this is the button that
      // opens it, so it goes quiet on the same terms.
      exportButton.disabled = state.project.cues.length === 0;
      void session;
    },
  };
}
