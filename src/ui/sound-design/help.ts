import { button, el } from '../dom.ts';

interface Section {
  title: string;
  rows: [string, string][];
}

const SECTIONS: readonly Section[] = [
  {
    title: 'Getting started',
    rows: [
      ['Load a video', 'Drag a file onto the page, or use the button. It stays on your machine.'],
      ['Place a sound', 'Pick one on the right, then click a lane on the timeline.'],
      ['Find hits', 'Reads the video and suggests where sounds belong. The slider shows more or fewer.'],
      ['Export', 'Writes a file that starts at zero, so it lines up when dropped at the head of your composition.'],
    ],
  },
  {
    title: 'Choosing a sound',
    rows: [
      ['Click a sound', 'Plays it, so you can hear it before you place it.'],
      ['The box at the top', 'Finds a sound by name, which matters once packs are loaded.'],
      ['Arrow keys in that box', 'Steps through what is left, playing each one, for comparing.'],
      ['Load a sound pack', 'Adds someone else’s sounds to the list. Anything written for @web-kits/audio works.'],
    ],
  },
  {
    title: 'Transport',
    rows: [
      ['Space', 'Play or pause'],
      ['Left and right arrows', 'Move one frame'],
      ['Ref audio', 'Hear the video’s own sound. It is never exported.'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ['Shift and an arrow', 'Move the selected sound one frame'],
      ['Delete', 'Remove the selected sound'],
      ['Escape', 'Deselect'],
      ['Pad keys, such as D or J', 'Drop that drum sound at the playhead'],
      ['Ends on it', 'The sound finishes on the marker. Use it for risers and reverse swells.'],
      ['In context', 'Plays from a second before, so you hear it in place.'],
      ['Space', 'Puts this sound in a room of its own, added to it rather than mixed with it.'],
      ['Drive', 'Pushes it, which adds weight. It is what makes low sounds read on a small speaker.'],
    ],
  },
  {
    title: 'Layout and export',
    rows: [
      ['Drag the line above the timeline', 'Make the timeline bigger. The video scales down.'],
      ['Double click that line', 'Put it back to where it started'],
      ['+ Layer', 'Add another layer. Double click a name to rename it.'],
      ['Fit', 'Frame the whole clip in the timeline'],
      ['Stop it clipping', 'Holds the loudest moments back so a stack of sounds cannot distort the file.'],
      ['Match loudness', 'Brings every export to the same loudness, so two pieces sit the same way.'],
    ],
  },
];

export interface Help {
  el: HTMLElement;
  toggle(): void;
  close(): void;
}

/** A panel explaining what everything does, opened from the help button. */
export function createHelp(options: { onReplayTour: () => void }): Help {
  const panel = el('div', { class: 'help__panel' }, [
    el('div', { class: 'help__head' }, [
      el('div', { class: 'help__title', text: 'How this works' }),
      button({ class: 'chip chip--sm', title: 'Close', on: { click: () => close() } }, ['Close']),
    ]),
    el(
      'div',
      { class: 'help__body' },
      SECTIONS.map((section) =>
        el('div', { class: 'help__section' }, [
          el('div', { class: 'section-title', text: section.title }),
          ...section.rows.map(([key, what]) =>
            el('div', { class: 'help__row' }, [
              el('div', { class: 'help__key', text: key }),
              el('div', { class: 'help__what', text: what }),
            ]),
          ),
        ]),
      ),
    ),
    el('div', { class: 'help__foot' }, [
      button(
        {
          class: 'chip chip--sm',
          on: {
            click: () => {
              close();
              options.onReplayTour();
            },
          },
        },
        ['Show the walkthrough again'],
      ),
    ]),
  ]);

  const root = el('div', {
    class: 'help',
    on: {
      // Clicking the dimmed area closes it, but clicks inside must not.
      click: (event) => {
        if (event.target === root) close();
      },
    },
  }, [panel]);
  root.style.display = 'none';

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  function open(): void {
    if (!root.isConnected) document.body.appendChild(root);
    root.style.display = '';
    window.addEventListener('keydown', onKey, true);
  }

  function close(): void {
    root.style.display = 'none';
    window.removeEventListener('keydown', onKey, true);
  }

  return {
    el: root,
    toggle: () => (root.style.display === 'none' ? open() : close()),
    close,
  };
}
