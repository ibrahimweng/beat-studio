import { button, el } from './dom.ts';

interface Section {
  /** What a small "?" points at, so a button can open the help here. */
  id: string;
  title: string;
  rows: [string, string][];
}

/**
 * Everything the app does, in the words somebody using it would look for.
 *
 * Kept in step with the app as a matter of course rather than as a tidy-up:
 * a feature that is not in here is a feature nobody finds. Each section
 * carries an id so the small "?" next to that part of the screen can open the
 * help at the right place instead of at the top.
 */
const SECTIONS: readonly Section[] = [
  {
    id: 'start',
    title: 'Getting started',
    rows: [
      ['Load a video', 'Drag a file onto the page, or use the button. It stays on your machine.'],
      ['Place a sound', 'Pick one on the right, then click a lane on the timeline.'],
      ['Find hits', 'Reads the video and suggests where sounds belong. The slider shows more or fewer.'],
      ['Export', 'Writes a file that starts at zero, so it lines up when dropped at the head of your composition.'],
      ['Nothing is uploaded', 'The video, the audio you drop in and everything you make stay in this browser.'],
    ],
  },
  {
    id: 'transport',
    title: 'Transport and the playhead',
    rows: [
      ['Play', 'Runs the video and everything on the timeline with it. Space does the same.'],
      ['Stop', 'Stops, and puts the playhead back where play started rather than at the top.'],
      ['The bar and arrow, at the far left', 'Back to the start.'],
      ['The two single arrows', 'One frame back or on. The left and right arrow keys do the same.'],
      ['Hold rewind or fast forward', 'Runs through the clip at six times speed while you hold it, so you can find a moment by watching.'],
      ['The skip buttons', 'Jump to the sound before or after the playhead, and select it. This is how you step through your work.'],
      ['Record', 'With this on, whatever you play — drums, keys or guitar — lands on the timeline at the playhead.'],
      ['Drag the ruler', 'Moves the playhead. Dragging while it is playing scrubs and then picks up where it was.'],
      ['The tab on the playhead', 'The same thing, with something big enough to grab.'],
      ['Ref audio', 'Hear the video’s own sound while you work. It is never exported.'],
    ],
  },
  {
    id: 'place',
    title: 'Choosing a sound',
    rows: [
      ['Click a sound', 'Plays it, so you can hear it before you place it.'],
      ['The box at the top', 'Two things at once: it finds sounds by name, and it builds one from a sentence.'],
      ['Arrow keys in that box', 'Steps through what is left, playing each one, for comparing.'],
      ['Forty voices', 'Grouped by what they are for. Each is built from a different method, so they stay apart however they are tuned.'],
      ['Load a sound pack', 'Adds someone else’s sounds to the list. Anything written for @web-kits/audio works.'],
      ['Save as mine', 'Keeps the selected sound as it is, under a name, for this and every other project.'],
    ],
  },
  {
    id: 'library',
    title: 'The library',
    rows: [
      ['A thousand named sounds', 'The forty voices at five sizes in five places: "small metal, hall", "huge bell, cavern".'],
      ['Type a name', 'Finds what matches. Every word has to match something, and the order does not matter.'],
      ['Type nothing', 'Shows one of each voice, at a spread of sizes and places, to browse.'],
      ['What it is', 'An index over settings, not a thousand recordings. Nothing is stored: each is a name and four numbers, and the sound is worked out when you ask for it.'],
    ],
  },
  {
    id: 'describe',
    title: 'Describing a sound',
    rows: [
      ['Type a sentence', '"A huge metal door slamming in a warehouse". What comes back is built to order.'],
      ['What it understands', 'Seven things: what it is, how big, how long, where, how hard it is pushed, how bright, how loud.'],
      ['Words it does not know', 'It hands them back rather than ignoring them, which is how you find out what it does know.'],
      ['Hover an answer', 'Says why: which words picked the voice and which shaped it.'],
      ['No model, nothing uploaded', 'A description is read as claims about numbers the app already had controls for.'],
    ],
  },
  {
    id: 'stack',
    title: 'One sound made of several',
    rows: [
      ['"with", "over", "under"', 'A joining word between two things it knows builds one sound out of both.'],
      ['Made of', 'Lists what the selected sound is. The button under it adds whatever is armed.'],
      ['The slider on each', 'How much of that voice there is. The one at the top is the sound itself.'],
      ['Four at most', 'Past that it stops being a sound made of parts.'],
      ['It is one sound', 'It moves once, stretches once, sits in one room, and shows on the timeline as "impact +2".'],
    ],
  },
  {
    id: 'extract',
    title: 'Taking sounds out of a recording',
    rows: [
      ['Drop in audio or video', 'Finds the separate sounds in it and rebuilds each one out of these voices.'],
      ['Place them all', 'Puts each where it was in the file, so a reference track becomes a timeline you can edit.'],
      ['Three offers each', 'The app cannot tell which is right, so it offers three and plays whichever you touch.'],
      ['The number beside each', 'How alike the two are. Not how good: a rebuild of this app’s own work scores 73 to 96, and a sound it cannot make scores 70 to 76. Listen.'],
      ['What you get', 'A voice and five numbers, not a sample, so it can be lengthened, tuned, moved to another room and stacked.'],
    ],
  },
  {
    id: 'sound',
    title: 'The selected sound',
    rows: [
      ['Level, Tune, Length', 'What it is, how high and how long. Changes reach everything chosen.'],
      ['Space', 'Puts this sound in a room of its own, added to it rather than mixed with it.'],
      ['Drive', 'Pushes it, which adds weight. It is what makes low sounds read on a small speaker.'],
      ['Ends on it', 'The sound finishes on the marker. Use it for risers and reverse swells.'],
      ['In context', 'Plays from a second before, so you hear it in place.'],
      ['−1f and +1f', 'Move it one frame, for a hit that feels a touch late.'],
    ],
  },
  {
    id: 'timeline',
    title: 'Layers and curves',
    rows: [
      ['+ Layer', 'Add another layer. Double click a name to rename it.'],
      ['A, next to a layer name', 'Opens that layer’s curves: level, position, room and push.'],
      ['On a lane', 'Click to add a point, drag to move it, click a point twice to remove it.'],
      ['Between two points', 'A small handle on the line. Drag it to bend the way one value becomes the next.'],
      ['Press that handle', 'Holds instead: the value stays put and steps across on arrival, for a cut.'],
      ['A lane name', 'Opens it, or shuts it again. A shut one still shows its shape, small.'],
      ['Pan', 'Where a whole layer sits between the speakers. Up is right, down is left.'],
      ['Fit', 'Frame the whole clip in the timeline.'],
    ],
  },
  {
    id: 'video',
    title: 'The video',
    rows: [
      ['Window, on the timeline bar', 'Floats the clip in a small window and gives the height back to the timeline.'],
      ['Video, on the instruments bar', 'The same window over the drums, keys or guitar, so you can play to the picture.'],
      ['That window', 'Drag its strip to move it, its corner to resize it. It stays where you put it.'],
      ['Drag the line above the timeline', 'Make the timeline bigger. The video scales down.'],
      ['Double click that line', 'Put it back to where it started.'],
    ],
  },
  {
    id: 'edit',
    title: 'Editing',
    rows: [
      ['Shift and an arrow', 'Move the selected sound one frame'],
      ['Delete', 'Remove the selected sound'],
      ['Ctrl or Cmd and Z', 'Undo. Shift as well to redo.'],
      ['Drag a sound’s far edge', 'Changes how long it sounds for. Everything chosen changes with it.'],
      ['Shift or Cmd click a sound', 'Adds it to what you are working on, or takes it out.'],
      ['Drag across the lanes', 'Draws a rectangle and takes everything it covers.'],
      ['Ctrl or Cmd and A', 'Choose every sound.'],
      ['Ctrl or Cmd and C, X, V', 'Copy, cut and paste. Paste lands at the playhead.'],
      ['Ctrl or Cmd and D', 'Duplicate, laid out straight after the original.'],
      ['Escape', 'Deselect'],
      ['Pad keys, such as D or J', 'Drop that drum sound at the playhead'],
    ],
  },
  {
    id: 'export',
    title: 'Export and session',
    rows: [
      ['Stop it clipping', 'Holds the loudest moments back so a stack of sounds cannot distort the file.'],
      ['Match loudness', 'Brings every export to the same loudness, so two pieces sit the same way.'],
      ['Cut to video length', 'Off by default, so a reverb tail at the end is allowed to finish.'],
      ['One file per layer', 'Stems. They add up to the mixed file exactly rather than nearly.'],
      ['Session', 'Saves the cue list, the layers and the settings, so you can come back to it.'],
      ['Export patch', 'Writes the palette as a @web-kits/audio patch file.'],
    ],
  },
  {
    id: 'instruments',
    title: 'The drums, keys and guitar',
    rows: [
      ['What they are for', 'Playing a part in, rather than placing single hits. The rail on the left swaps between them.'],
      ['Play with the mouse', 'Click a pad, a key or a string.'],
      ['Play with the keyboard', 'The pads are on W E R T A S D F G H J K L. The keys are two rows, Z S X D C V G B H N J M and Q 2 W 3 E R 5 T 6 Y 7 U, one octave each.'],
      ['Octave', 'On the right, under Keyboard. It moves which two octaves those rows reach, and the lit keys show where they are.'],
      ['Video', 'Floats the clip over the instrument, so you can play to the picture.'],
      ['Recording onto the timeline', 'Turn on the round red button on the sound design bar. After that, whatever you play here lands on the timeline at the playhead.'],
      ['Its own record button', 'The one up here is separate: it captures a take against the loop, and has nothing to do with the timeline.'],
    ],
  },
  {
    id: 'pattern',
    title: 'The sequencer and takes',
    rows: [
      ['Sequencer', 'A grid of steps for the kit. Click a step to turn it on.'],
      ['Pattern A to D', 'Four patterns. They keep their own steps, so you can switch between them while it runs.'],
      ['16 or 32 steps', 'The chip by the title. Every pattern stores thirty two either way, so switching down and back loses nothing.'],
      ['Seed beat', 'Fills in something to play against, for when you want a pulse rather than a blank grid.'],
      ['Takes', 'Hit record, play over the loop, hit record again. What you played is kept as a take.'],
      ['What a take can do', 'Play it back, export it as WAV, MP3 or MIDI, or throw it away.'],
      ['Count‑in and take length', 'On the right, under Clock. A count‑in gives you a bar before it starts listening.'],
    ],
  },
  {
    id: 'engine',
    title: 'The engine, the mix and the meters',
    rows: [
      ['Power', 'A browser will not make a sound until something is clicked. This is that click.'],
      ['Reverb and Tilt', 'The room everything is played in, and the balance between low and high across the whole instrument.'],
      ['Equalizer', 'Three bands over the instruments. It does not touch the timeline or the export.'],
      ['Volume', 'How loud the instruments are here. Nothing on the timeline hears it.'],
      ['The meters', 'What is actually coming out, per lane. If a light is red the sound is clipping.'],
      ['Sustain', 'How long a key rings after you let it go.'],
    ],
  },
];

/** The event a small "?" fires, and the help panel listens for. */
const OPEN_AT = 'st88:help-at';

/**
 * A tiny "?" that opens the help at the part of the screen it sits beside.
 *
 * Sent as an event on the document rather than through a callback, because
 * these sit in half a dozen views that would otherwise all have to be handed
 * a way of reaching the help panel.
 */
export function helpButton(section: string, about: string): HTMLButtonElement {
  return button(
    {
      class: 'help-dot',
      title: `What ${about} does`,
      attrs: { 'aria-label': `What ${about} does`, type: 'button' },
      on: {
        click: (event) => {
          event.stopPropagation();
          document.dispatchEvent(new CustomEvent(OPEN_AT, { detail: section }));
        },
      },
    },
    ['?'],
  );
}

export interface Help {
  el: HTMLElement;
  toggle(): void;
  close(): void;
  /** Open with one section scrolled to and marked. */
  openAt(section: string): void;
  destroy(): void;
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
        el('div', { class: 'help__section', attrs: { 'data-help': section.id } }, [
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

  /**
   * Open with one section brought into view and marked.
   *
   * Marked as well as scrolled to, because a panel of eleven sections that
   * merely jumps somewhere leaves you working out which of the things on
   * screen you asked about.
   */
  const openAt = (id: string): void => {
    open();
    const found = panel.querySelector(`[data-help="${id}"]`);
    for (const node of panel.querySelectorAll('.help__section')) {
      node.classList.toggle('is-asked', node === found);
    }
    if (found) {
      requestAnimationFrame(() => found.scrollIntoView({ block: 'start', behavior: 'auto' }));
    }
  };

  const onAsked = (event: Event): void => {
    const id = (event as CustomEvent<string>).detail;
    if (typeof id === 'string') openAt(id);
  };
  document.addEventListener(OPEN_AT, onAsked);

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
    openAt,
    destroy: () => document.removeEventListener(OPEN_AT, onAsked),
  };
}
