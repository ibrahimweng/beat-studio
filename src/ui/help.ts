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
      ['Nothing is lost either', 'The piece and its clip are kept as you work, so a refresh opens on what you left. "New project" is the only thing that clears them.'],
    ],
  },
  {
    id: 'tools',
    title: 'The tools, down the left',
    rows: [
      ['Move (V)', 'Choose sounds, drag them along, and drag a sound’s far edge to change how long it lasts. This is what the timeline has always done, and it is what you start on.'],
      ['Range (T)', 'Drag out a stretch of time across the lanes. Delete clears every sound that starts inside it. Escape lets it go.'],
      ['Cut (C)', 'Click a sound anywhere along its length to cut it short there. A sound anchored to its end keeps landing on its marker and loses its front instead.'],
      ['Hand (H)', 'Drag the timeline along, or the picture once you have gone into it. Nothing on either one moves — only your view of it does.'],
      ['Zoom (Z)', 'Click to go in, hold alt and click to go out. On the timeline you can also drag across a stretch to fill the width with it. On the picture, a chip in the corner says how far in you are and takes you back to the whole frame.'],
      ['Pen (P)', 'Draw a curve by dragging along an open lane, instead of placing points one at a time. Open a layer’s lanes with the A beside its name.'],
      ['Where each one works', 'The hand and the zoom work on the timeline and on the picture. The other three are about the timeline: used on the picture they say so rather than doing something surprising. Only Move chooses sounds — that is the whole point of having a tool for it.'],
      ['The layer names, down the left', 'These work whatever tool you are holding, the way a track header does in an edit suite: rename, mute, solo and open the curves without putting the tool down.'],
      ['The letters', 'V, T, C, H, Z and P change tool, the way they do in an edit suite. They are printed on the buttons so you only have to read them once.'],
      ['While record is armed', 'The letters that are also drum pads play the drums instead — T, H, J, K, L and S are wanted by both, and record decides which. The rest are still tools: C, V, Z and P are not pads, so they keep working. Disarm it and all the letters are tools again.'],
    ],
  },
  {
    id: 'transport',
    title: 'Transport and the playhead',
    rows: [
      ['The three groups', 'The buttons are grouped by what they do: the pair on the left gets you back, the run in the middle moves you, and the one on its own writes.'],
      ['Play', 'Runs the video and everything on the timeline with it. Space does the same.'],
      ['Stop', 'Stops, and puts the playhead back where play started rather than at the top.'],
      ['The bar and arrow, at the far left', 'Back to the start.'],
      ['The two single arrows', 'One frame back or on, either side of play. The left and right arrow keys do the same.'],
      ['Hold rewind or fast forward', 'Runs through the clip at six times speed while you hold it, so you can find a moment by watching.'],
      ['J, K and L', 'Run backwards, stop, run forwards. Press J or L again to go faster — two, four, then eight times. This is the quick way to find a moment.'],
      ['Home and End', 'To the start of the clip, or to the end of it.'],
      ['S', 'Cycles the snapping: frame, then beat, then off.'],
      ['Where this row is', 'On the timeline rather than across the top, because it drives the timeline. Floating the video into its own window takes the picture away and leaves these where they are.'],
      ['The skip buttons', 'At the two ends of the middle group: jump to the sound before or after the playhead, and select it. This is how you step through your work.'],
      ['Record', 'On its own at the right. With this on, tapping a pad key drops that sound at the playhead as the video runs, so a pass can be played in by hand. The button fills red while it is on.'],
      ['Drag the ruler', 'Moves the playhead. Dragging while it is playing scrubs and then picks up where it was.'],
      ['The tab on the playhead', 'The same thing, with something big enough to grab.'],
      ['The frame rate', 'What a frame is worth, and what the timecode counts in. A clip you load sets it from what was measured, so it usually needs no attention.'],
      ['Snap', 'Where a sound is allowed to land: on whole frames, on the tempo for work cut to music, or anywhere at all.'],
      ['Window', 'Floats the clip in a small window and gives the height back to the timeline. There is more under “The video”.'],
      ['Ref audio', 'Hear the video’s own sound while you work. It is never exported.'],
      ['A narrow window', 'The bar is one row and will not wrap, so on a small screen it scrolls sideways rather than dropping anything off the end.'],
    ],
  },
  {
    id: 'place',
    title: 'Choosing a sound',
    rows: [
      ['Click a sound', 'Plays it, so you can hear it before you place it.'],
      ['The box at the top', 'Two things at once: it finds sounds by name, and it builds one from a sentence.'],
      ['Arrow keys in that box', 'Steps through what is left, playing each one, for comparing.'],
      ['Forty voices', 'Under “Browse by kind”, grouped by what they are for. Each is built from a different method, so they stay apart however they are tuned. Groups open one at a time, and searching opens whichever ones match.'],
      ['Load a sound pack', 'Adds someone else’s sounds to the list. Anything written for @web-kits/audio works.'],
      ['Add recordings', 'Puts your own audio files on the timeline. They get the same level, room, push and automation everything else does, and they stay in this browser.'],
      ['Save as mine', 'Keeps the selected sound as it is, under a name, for this and every other project.'],
    ],
  },
  {
    id: 'recordings',
    title: 'Your own recordings',
    rows: [
      ['They are already there', 'On a first visit the app quietly fetches about sixty CC0 recordings — doors, switches, glass, metal, footsteps, paper, cloth, water, wind, impacts, whooshes and room tone — so there is a real palette before you search for anything. It happens once, in the background, and never for somebody who already has recordings of their own.'],
      ['Add recordings', 'Under the packs. Anything the browser can play — WAV, MP3, whatever else it knows — or a zip, which is opened for you.'],
      ['Add a folder', 'A whole sound library at once, folders and all. Four hundred files takes about a second.'],
      ['The folders become tags', 'A file at Foley/Doors/oak-slam.wav is filed under foley and doors, because that is where an archive already keeps its categories. Searching finds either.'],
      ['Find a recording', 'Search by name or by tag once there are more than a screenful. Only sixty are drawn at a time; the search reaches the rest.'],
      ['Freesound names', 'A file called 4948__NoiseCollector__snare.wav is read for its title, its author and a link back. Downloads from Freesound arrive named that way, so they credit themselves.'],
      ['A spreadsheet in the archive', 'If a CSV comes with the sounds, it is read and used to name them. That is what makes the BBC archive usable: its files are called things like 07076051.wav and the descriptions live in a separate list. Which column is which is worked out from the contents, so a table about anything else is ignored rather than guessed at.'],
      ['Save credits', 'Writes out every recording that asks to be credited, with its author, licence and link. CC0 sounds are left out because they ask for nothing.'],
      ['Licences are your call, not the app\u2019s', 'Freesound is a mix: CC0 asks for nothing, CC-BY requires the author be named wherever the work is used, and some sounds are non-commercial only. The BBC archive is personal, educational and research use only. The app records what it is told and writes the list; it cannot check it.'],
      ['What they can do', 'Everything a made sound can — a level, a room, a push, a place on a layer, a curve drawn over them, the same export.'],
      ['Tune', 'Plays it faster or slower, the way a sampler does, so its pitch and its length move together. There is no honest way to move one without the other.'],
      ['Length', 'How much of it is heard, not how long it takes. A recording is as long as it is.'],
      ['The length on each button', 'The one thing about a recording the app cannot change, so it is worth knowing before you place one.'],
      ['They last', 'Kept in this browser like everything else, and left alone by "New project". Nothing is uploaded.'],
      ['Export patch', 'Leaves them out. That format describes how to make a sound, and there is no way in it to say "this file".'],
    ],
  },
  {
    id: 'freesound',
    title: 'Sounds from Freesound',
    rows: [
      ['Where they come from', 'The same box you search the library with also asks Freesound, and what it finds appears in its own group underneath. Half a million recordings people have shared.'],
      ['Why a separate group', 'So you always know which sounds are ones this app makes and which are somebody else’s recording that has to be credited.'],
      ['They are previews', 'Freesound gives out a 128 kbps preview freely; the master needs an account on their site. A preview is enough to place against picture and is not enough to master from, so each one is tagged “preview”. Download the original and drop it in when you need it.'],
      ['The licence is on every row', 'CC0 asks nothing of you. Anything else names an author you must credit wherever the work ends up, and “Save credits” writes that list for you.'],
      ['No key to enter', 'The key lives on the server, not in this page. If the group never appears, the deployment has not been given one.'],
      ['Click one', 'Plays it and arms it straight away, the same as clicking any other sound here. No separate download step.'],
      ['It is kept when you use it', 'Placing it on the timeline is what adds it to your recordings, with its author, licence and a link recorded automatically. Ones you only listened to are not kept, so working through a page of results leaves nothing behind.'],
    ],
  },
  {
    id: 'library',
    title: 'The library',
    rows: [
      ['A thousand named sounds', 'The forty voices at five sizes in five places: "small metal, hall", "huge bell, cavern".'],
      ['Placed twice, heard twice', 'Two of the same entry are two takes of it, not one file twice — a shade apart in pitch, brightness and decay. "Variation", on the selected sound, decides how far apart.'],
      ['What a size means', 'Different things to different voices. A click cannot be made longer, so its sizes are pitched from a thin tick to a dull thud; a swell has no pitch, so a big one is a long one.'],
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
      ['Variation', 'How much this one differs from the next one like it. Turn it to nothing and every placement is the same sound; leave it up and six impacts in a row are six takes rather than one file six times.'],
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
      ['Window', 'Floats the clip over the timeline instead of sitting it above. The stage is then gone rather than empty, and the height it was using goes to the lanes.'],
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
      ['Pad keys, such as D or J', 'Drop that drum sound at the playhead. Only while record is armed: disarmed, the letters are the tools instead.'],
    ],
  },
  {
    id: 'export',
    title: 'Export',
    rows: [
      ['Stop it clipping', 'Holds the loudest moments back so a stack of sounds cannot distort the file.'],
      ['Match loudness', 'Brings every export to the same loudness, so two pieces sit the same way.'],
      ['Cut to video length', 'Off by default, so a reverb tail at the end is allowed to finish.'],
      ['One file per layer', 'Stems. They add up to the mixed file exactly rather than nearly.'],
      ['Export patch', 'Writes the palette as a @web-kits/audio patch file.'],
    ],
  },
  {
    id: 'session',
    title: 'Keeping your work',
    rows: [
      ['Nothing to press', 'The piece is kept as you work. Close the page, refresh it, come back tomorrow: it opens on what you left.'],
      ['The clip comes back too', 'The video is kept beside the timeline, so you do not have to find the file again. It stays in this browser and is never uploaded.'],
      ['New project', 'The only thing that clears it. It asks first, and says what it is throwing away.'],
      ['What a new project keeps', 'Your saved sounds, your packs and your patterns. Starting a new piece is not forgetting your own sounds.'],
      ['Save session', 'A file, for keeping a piece beyond this browser or moving it to another machine. It carries the packs and your sounds with it.'],
      ['Open session', 'Reads one back. It replaces the piece, so there is nothing to undo to afterwards.'],
      ['A clip too large to keep', 'Says so when it happens. The timeline is kept either way, and only the clip has to be found again.'],
      ['Two tabs at once', 'One tab keeps the piece. Any other says so in a red line at the top, and works normally without writing anything down.'],
      ['"Keep here instead"', 'On that line. It hands the keeping to the tab you are in, so the work in front of you is the work that is kept.'],
    ],
  },
  {
    id: 'instruments',
    title: 'The drums, the piano and the guitar',
    rows: [
      ['Where they are', 'In the library, under the moment they serve. There is no separate screen for them: a crash is a wash that covers a cut, so it sits beside the other things that cover a cut.'],
      ['The kit', 'The thirteen pads, under their own names. A kick is under "Something lands hard", the hats are under "A small thing happens", the crashes are under "A transition".'],
      ['The two instruments', 'Offered as the things they do rather than as a keyboard. A piano stinger is one low note left to ring. A piano chord is three at once, held. Guitar tension is a high steel note.'],
      ['Why not a keyboard', 'A fretboard asks what you want to play, and somebody putting sound to a logo does not have an answer to that. What they have is a moment.'],
      ['Playing them in', 'The pad keys W E R T A S D F G H J K L still drop that sound at the playhead, so a pass can be tapped in by hand and tidied up afterwards.'],
    ],
  },
  {
    id: 'engine',
    title: 'The engine',
    rows: [
      ['Power', 'A browser will not make a sound until something is clicked. This is that click. The light at the bottom of the rail says whether it has been.'],
      ['Rooms', 'Every placed sound carries its own room, set under the selected sound rather than for everything at once. An impact can have a hall behind it while the click next to it stays dry, which is most of the difference between a sound that reads as placed in a scene and one pasted on top of it.'],
      ['Why the rooms sound different', 'Each is built the way a real space behaves: the first echoes off the nearest walls arrive at a time that tells you how big it is, the tail thickens instead of starting as noise, and the top end dies before the bottom does. That last one is why a long room sounds warm rather than hissy.'],
      ['Holding the loudest moments back', 'Under Export. A hundred sounds on the same frame would otherwise clip, and this holds the peaks down without pulling the whole piece with them.'],
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
