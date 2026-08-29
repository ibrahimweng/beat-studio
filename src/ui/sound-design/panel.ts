import { KIT_SOUNDS, MINE_ID, NAMES } from '../../constants.ts';
import {
  DEFAULT_EXPORT,
  DEFAULT_TARGET_LUFS,
  SoundDesignSession,
  type ExportSettings,
} from '../../sound-design-session.ts';
import type { AppState } from '../../store.ts';
import { MAX_LENGTH, MIN_LENGTH, timecode } from '../../timeline/project.ts';
import {
  DESIGN_GROUPS,
  INSTRUMENT_PICKS,
  MOMENT_GROUPS,
  layerJob,
  type Anchor,
  type Cue,
  type CuePreset,
  type CueSource,
  type DesignName,
} from '../../timeline/types.ts';
import { CATALOGUE, search as findSounds, type Entry } from '../../audio/catalogue.ts';
import { describe } from '../../audio/describe.ts';
import { button, clear, el, setText, toggleClass } from '../dom.ts';
import type { Sample } from '../../audio/samples.ts';
import {
  FreesoundError,
  search as searchFreesound,
  soundUrl,
  type Found,
} from '../../audio/freesound.ts';
import { helpButton } from '../help.ts';
import type { View } from '../view.ts';

/**
 * How many recordings are drawn at once.
 *
 * Every pick is a live button the palette filter walks on each keystroke, so a
 * library of four hundred is four hundred nodes measured to show the dozen
 * anybody is looking at. The search is how the rest are reached.
 */
const SHOW_AT_MOST = 60;

/**
 * How long typing has to stop before Freesound is asked.
 *
 * Every keystroke would be a request, and a search for "d", "do", "doo" costs
 * the deployment three of its quota to answer a question nobody asked.
 */
const ONLINE_WAIT = 450;

/** What a recording knows about itself, for a tooltip. */
function creditTitle(sample: Sample): string | undefined {
  const parts: string[] = [];
  if (sample.credit?.author) parts.push(`by ${sample.credit.author}`);
  if (sample.credit?.licence) parts.push(sample.credit.licence);
  if (sample.credit?.from) parts.push(sample.credit.from);
  if (sample.tags?.length) parts.push(sample.tags.join(' · '));
  return parts.length ? parts.join(' — ') : undefined;
}


/** Every drum voice the engine has, not just the eight the sequencer drives. */
const KIT_PICKS = KIT_SOUNDS.map((sound) => ({ name: sound.pad, label: sound.label }));

const PITCHED: readonly { name: 'piano' | 'guitar'; label: string }[] = [
  { name: 'piano', label: 'Piano' },
  { name: 'guitar', label: 'Guitar' },
];

/** A useful starting note for pitched sources, low enough to sit under a hit. */
const DEFAULT_MIDI = 48;

function sameSource(a: CueSource, b: CueSource): boolean {
  return a.kind === b.kind && a.name === b.name;
}

function noteName(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * The right hand panel on the sound design screen.
 *
 * The top half chooses what a click on the timeline will place. The bottom
 * half edits whichever cue is selected, and writes the files.
 */
/** The panel, plus the three parts a tab strip shows one at a time. */
export interface SoundDesignPanelView extends View {
  /** Everything for choosing a sound. */
  soundsPage: HTMLElement;
  /** The settings of whatever is picked on the timeline. */
  selectedPage: HTMLElement;
  /** Export, session and palette, which belong to no tab. */
  tail: HTMLElement;
  /** Open the library at one moment group, unfolding whatever is in the way. */
  openGroup(id: string): void;
  /** Unfold the export options and bring them into view. */
  showExport(): void;
}

export function createSoundDesignPanel(session: SoundDesignSession): SoundDesignPanelView {
  /** A section heading with a small "?" that opens the help at its part. */
  const heading = (
    text: string,
    section: string,
    style?: Record<string, string>,
  ): HTMLElement =>
    el('div', { class: 'section-title section-title--asks', ...(style ? { style } : {}) }, [
      el('span', { text }),
      helpButton(section, text.toLowerCase()),
    ]);

  /**
   * A part of the panel that can be folded away, and stays as you left it.
   *
   * Six things live down this panel and nobody is using all six at once:
   * somebody placing sounds wants the palette and the selected sound, and
   * somebody exporting wants none of the above. Folded, a part costs one line
   * instead of a screen.
   *
   * What is open is remembered, because a panel that resets every visit
   * teaches you not to bother arranging it. The default is open, so nothing
   * is hidden from anybody who has never touched this.
   */
  const FOLD_STORE = 'toolcraft.st88.folded';

  const foldedNow = (): Set<string> => {
    try {
      const held = localStorage.getItem(FOLD_STORE);
      return new Set(held ? (JSON.parse(held) as string[]) : []);
    } catch {
      // Site data blocked, or something that is not a list. Nothing folded.
      return new Set();
    }
  };

  const folded = foldedNow();

  /** Each fold's own button and body, so something else can open one. */
  const foldHeads = new Map<string, HTMLButtonElement>();
  const foldWraps = new Map<string, HTMLElement>();

  const foldable = (
    id: string,
    text: string,
    help: string,
    body: HTMLElement,
    style?: Record<string, string>,
    /**
     * Whether this one starts folded for somebody who has never touched it.
     *
     * Open by default almost everywhere, so nothing is hidden from a first
     * visit. The exception is the grouped palette, which is a second way to
     * reach sounds the search and the shelf above already reach — opening
     * that by default is what made the panel too long to use.
     */
    shutFirst = false,
  ): HTMLElement => {
    const caret = el('i', { class: 'section-title__caret' });
    const shut = folded.has(id) || (shutFirst && !folded.has(`${id}:open`));
    const wrap = el('div', {
      class: shut ? 'folds folds--shut' : 'folds',
      ...(style ? { style } : {}),
    });

    const head = button(
      { class: 'section-title section-title--folds', attrs: { 'aria-expanded': shut ? 'false' : 'true' } },
      [caret, el('span', { text })],
    );
    head.addEventListener('click', () => {
      const nowShut = !wrap.classList.contains('folds--shut');
      toggleClass(wrap, 'folds--shut', nowShut);
      head.setAttribute('aria-expanded', nowShut ? 'false' : 'true');
      if (nowShut) {
        folded.add(id);
        folded.delete(`${id}:open`);
      } else {
        folded.delete(id);
        // Marked open explicitly, so a section that starts folded stays open
        // once somebody has opened it.
        folded.add(`${id}:open`);
      }
      try {
        localStorage.setItem(FOLD_STORE, JSON.stringify([...folded]));
      } catch {
        // It will simply not be remembered. Not worth interrupting anyone.
      }
    });

    foldHeads.set(id, head);
    foldWraps.set(id, wrap);
    wrap.appendChild(el('div', { class: 'folds__head' }, [head, helpButton(help, text.toLowerCase())]));
    wrap.appendChild(el('div', { class: 'folds__body' }, [body]));
    return wrap;
  };

  // ---------- sound picker ----------

  /**
   * Every sound that can be placed, whether it is built in or came from a
   * pack. Held in one list so the filter and the highlight can work the same
   * way across all of them.
   */
  interface Pick {
    node: HTMLButtonElement;
    /** What the filter matches against. */
    label: string;
    /** Whether this is the sound a click on the timeline would place. */
    chosen: (source: CueSource, preset: CuePreset | null) => boolean;
  }

  /** A titled row of sounds, which hides itself when the filter empties it. */
  interface Section {
    node: HTMLElement;
    picks: Pick[];
    /**
     * Sections that answer what was typed rather than being filtered by it,
     * and say for themselves whether they have anything to show.
     *
     * A thousand buttons is not a list anyone can look at, so the library
     * builds itself from whatever was typed instead of hiding the rest; and
     * the describer has nothing at all to show until a sentence is one.
     */
    fill?: (term: string) => boolean;
  }

  /**
   * Every section, built in ones first and packs after.
   *
   * Packs are always appended, so forgetting them again is a matter of
   * cutting the list back to the number that were there before any were
   * loaded. That is what `builtIn` records.
   */
  const sections: Section[] = [];
  let builtIn = 0;

  /**
   * What the highlight is currently drawn against, or null before the first
   * state has arrived.
   *
   * Held here rather than read from the store each time, because the filter
   * can build a row of buttons between two state updates and those buttons
   * have to be lit against the same answer as the ones beside them.
   */
  let armed: { source: CueSource; preset: CuePreset | null } | null = null;

  function paintChosen(): void {
    if (!armed) return;
    for (const section of sections) {
      for (const pick of section.picks) {
        toggleClass(pick.node, 'is-on', pick.chosen(armed.source, armed.preset));
      }
    }
    for (const way of heardWays) {
      toggleClass(way.node, 'is-on', armed.preset?.id === way.id);
    }
  }

  const pickButton = (
    label: string,
    source: CueSource,
    chosen: (current: CueSource) => boolean,
    preset: CuePreset | null = null,
    /** What to say on hover, for anything that knows more than fits on it. */
    title?: string,
  ): Pick => ({
    node: button(
      // Choosing plays it, so a list this long can be worked through by ear.
      {
        class: 'cell pick',
        ...(title ? { title } : {}),
        on: { click: () => session.chooseSource(source, preset) },
      },
      [el('span', { text: label })],
    ),
    label,
    // A library entry is a voice plus a set of numbers, so the plain voice's
    // own button stays dark while one of its named versions is armed.
    chosen: preset
      ? (_, current) => current?.id === preset.id
      : (current, currentPreset) => !currentPreset && chosen(current),
  });

  /** A titled row of sounds, which disappears when the filter empties it. */
  /**
   * Groups that open one at a time.
   *
   * Forty voices in eight groups, all open, was most of the panel's height and
   * pushed everything below it out of sight — somebody looking for the import
   * buttons had to scroll past four hundred pixels of sounds they were not
   * looking for. Closed, each group is one line, and opening one closes the
   * last, so browsing costs the height of the group you are actually reading.
   *
   * The search is unaffected: typing opens whatever matches, so nothing is
   * hidden from anyone who knows what they want. Browsing is what became
   * deliberate, not finding.
   */
  const openable: { node: HTMLElement; open: (yes: boolean) => void }[] = [];

  const pickGroup = (
    title: string,
    group: Pick[],
    extra?: HTMLElement,
    /**
     * Whether this group folds away.
     *
     * Opt in, and only the built-in voice groups take it. Your own sounds,
     * your packs and your recordings are always open: they are few, they are
     * yours, and hiding them behind a click was a regression the first
     * version of this made — every group used one helper, so collapsing the
     * palette collapsed the user's own library with it.
     */
    collapses = false,
    /**
     * A line saying when this group is the one you want.
     *
     * Only the moment groups carry one. It folds away with the buttons rather
     * than staying with the title, because seven of these on screen at once is
     * a paragraph nobody reads, and one of them beside the sounds it describes
     * is the sentence that makes the group mean something.
     */
    note?: string,
  ): HTMLElement => {
    const row = el('div', { class: 'pick-row' }, group.map((p) => p.node));

    if (!collapses) {
      const node = el('div', { class: 'pick-group' }, [
        el('div', { class: 'pick-group__title' }, [
          el('span', { text: title }),
          ...(extra ? [extra] : []),
        ]),
        row,
      ]);
      sections.push({ node, picks: group });
      return node;
    }

    const caret = el('i', { class: 'pick-group__caret' });
    const node = el('div', { class: 'pick-group pick-group--shut' }, [
      button(
        {
          class: 'pick-group__title pick-group__title--opens',
          attrs: { 'aria-expanded': 'false' },
          on: {
            click: () => {
              const shut = node.classList.contains('pick-group--shut');
              // One at a time, so the panel cannot grow back to what it was.
              for (const other of openable) other.open(false);
              if (shut) open(true);
            },
          },
        },
        [caret, el('span', { text: title })],
      ),
      ...(note ? [el('div', { class: 'pick-group__when', text: note })] : []),
      row,
      ...(extra ? [extra] : []),
    ]);

    const open = (yes: boolean): void => {
      toggleClass(node, 'pick-group--shut', !yes);
      node.querySelector('.pick-group__title--opens')?.setAttribute(
        'aria-expanded',
        yes ? 'true' : 'false',
      );
    };

    openable.push({ node, open });
    sections.push({ node, picks: group });
    return node;
  };

  /** Mark a group so something outside can find it, such as the walkthrough. */
  const named = (id: string, node: HTMLElement): HTMLElement => {
    node.dataset.group = id;
    return node;
  };

  const voicePicks = (names: readonly DesignName[]): Pick[] =>
    names.map((name) =>
      pickButton(name, { kind: 'design', name }, (c) => c.kind === 'design' && c.name === name),
    );

  // Twenty four in one row is a wall. Grouped by what they are for, it reads.
  const designSections = DESIGN_GROUPS.map((group) =>
    pickGroup(group.title, voicePicks(group.names), undefined, true),
  );

  /*
   * The same forty voices, under what is happening on screen, with the kit and
   * the two instruments among them.
   *
   * The other list sorts them by how they are made, which is how somebody who
   * already knows this looks at a library. Four of its ten groups are named
   * after a mechanism, and somebody watching a logo land cannot use "Struck".
   *
   * The drums and the instruments are in here rather than in sections of their
   * own because that is what folding them in means: a crash is a wash that
   * covers a cut, and belongs beside the other things that cover a cut, not
   * behind a heading saying Kit. Which instrument made a sound is the least
   * interesting thing about it when the question is what goes on this frame.
   */
  const momentSections = MOMENT_GROUPS.map((group) => ({
    id: group.id,
    node: named(group.id, pickGroup(
      group.title,
      [
        ...voicePicks(group.names),
        ...INSTRUMENT_PICKS.filter((pick) => pick.group === group.id).map((pick) =>
          pickButton(
            pick.label,
            pick.source,
            (current) => sameSource(current, pick.source),
            null,
            pick.about,
          ),
        ),
      ],
      undefined,
      true,
      group.when,
    )),
  }));

  const kitSection = pickGroup(
    'Kit',
    KIT_PICKS.map((pick) =>
      pickButton(pick.label, { kind: 'kit', name: pick.name }, (c) =>
        sameSource(c, { kind: 'kit', name: pick.name }),
      ),
    ),
    undefined,
    true,
  );

  const pitchedSection = pickGroup(
    'Pitched',
    PITCHED.map((pick) =>
      pickButton(
        pick.label,
        { kind: 'pitched', name: pick.name, midi: DEFAULT_MIDI },
        (c) => sameSource(c, { kind: 'pitched', name: pick.name }),
      ),
    ),
    undefined,
    true,
  );

  /*
   * Which way the forty voices are indexed.
   *
   * By moment for anybody who has not done this before, since it is the only
   * one of the two that answers the question they actually have. By sound type
   * is the same voices under the names somebody who knows the craft would
   * expect, and it is kept because learning those names is a real thing that
   * happens and an app that forgets them is an app you outgrow.
   *
   * Remembered, like the folds, because a panel that resets its arrangement
   * every visit teaches you not to arrange it.
   */
  const BROWSE_STORE = 'toolcraft.st88.browse';
  type Browse = 'moment' | 'kind';

  const browseNow = (): Browse => {
    try {
      return localStorage.getItem(BROWSE_STORE) === 'kind' ? 'kind' : 'moment';
    } catch {
      // Site data blocked. By moment, which is the default either way.
      return 'moment';
    }
  };

  let browse = browseNow();

  const momentBox = el('div', {}, momentSections.map((section) => section.node));
  // Under the sound type grouping the kit and the instruments are what they
  // are made of, which is a kit and two instruments.
  const kindBox = el('div', {}, [...designSections, kitSection, pitchedSection]);

  const browseWays: { way: Browse; node: HTMLButtonElement }[] = (
    [
      { way: 'moment', label: 'By moment', title: 'Grouped by what is happening on screen' },
      { way: 'kind', label: 'By sound type', title: 'Grouped by what the sound is made of' },
    ] as const
  ).map(({ way, label, title }) => ({
    way,
    node: button(
      { class: 'cell pick', title, on: { click: () => setBrowse(way) } },
      [el('span', { text: label })],
    ),
  }));

  function setBrowse(way: Browse): void {
    browse = way;
    try {
      localStorage.setItem(BROWSE_STORE, way);
    } catch {
      // Not being able to remember it is not a reason to refuse to do it.
    }
    paintBrowse();
  }

  function paintBrowse(): void {
    momentBox.style.display = browse === 'moment' ? '' : 'none';
    kindBox.style.display = browse === 'kind' ? '' : 'none';
    for (const option of browseWays) toggleClass(option.node, 'is-on', option.way === browse);
  }

  /*
   * The kit and the instruments sit under both, rather than inside either.
   *
   * The switch is about how the forty voices are indexed, and those are not
   * among them: a kick is a kick under any grouping. Describing them by what
   * they do for picture is the next piece of work, not this one.
   */
  const browseBody = el('div', {}, [
    el('div', { class: 'pick-row pick-row--ways' }, browseWays.map((option) => option.node)),
    momentBox,
    kindBox,
  ]);

  /**
   * Show one moment group, whatever state the panel was left in.
   *
   * Every step here is something somebody would otherwise have to do for
   * themselves after being told to go and look: unfold the browser, switch
   * back to the grouping that has this group in it, open it, close whatever
   * was open before, and find it on screen. A suggestion somebody did not
   * want is only useful if the alternative is one click away.
   */
  function openGroup(id: string): void {
    const section = momentSections.find((one) => one.id === id);
    if (!section) return;

    setBrowse('moment');

    const fold = foldHeads.get('kinds');
    if (fold?.getAttribute('aria-expanded') === 'false') fold.click();

    if (section.node.classList.contains('pick-group--shut')) {
      section.node.querySelector<HTMLButtonElement>('.pick-group__title--opens')?.click();
    }

    // After the fold, since nothing can be scrolled to while it is closed.
    section.node.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Put the export options in front.
   *
   * Getting a file out is what the whole thing is for, and it sat at the
   * bottom of a panel nearly twice the height of the window: reachable only by
   * scrolling past the library, the recordings and the layers. The button that
   * calls this lives in the bar, where it cannot be scrolled away from.
   */
  function showExport(): void {
    const fold = foldHeads.get('export');
    if (fold?.getAttribute('aria-expanded') === 'false') fold.click();
    foldWraps.get('export')?.scrollIntoView({ block: 'nearest' });
  }

  paintBrowse();

  /* ---------- library ---------- */

  /**
   * How many of the matches to draw.
   *
   * Enough that narrowing by one more word is usually not needed, few enough
   * that the row is still something you look at rather than scroll.
   */
  const LIBRARY_SHOWN = 48;

  /**
   * With nothing typed, one of each voice, at a different size and a
   * different place each time.
   *
   * One of each voice in the dry at its own size was tried first and read as
   * forty repeats of the list of voices sitting right underneath it. Walking
   * the two axes instead means the shelf shows what the library is — a huge
   * thing in a cavern next to a tiny one in a room — rather than the flattest
   * corner of it.
   */
  const SHELF = (() => {
    const byVoice = new Map<string, Entry[]>();
    for (const entry of CATALOGUE) {
      const list = byVoice.get(entry.voice);
      if (list) list.push(entry);
      else byVoice.set(entry.voice, [entry]);
    }
    // The size steps by one and the place by two, and the place shifts again
    // every five voices, so no two next to each other share either and all
    // twenty five pairings have been shown by the twenty fifth voice.
    return [...byVoice.values()].map(
      (list, i) => list[(i % 5) * 5 + ((i * 2 + Math.floor(i / 5)) % 5)],
    );
  })();

  const libraryRow = el('div', { class: 'pick-row pick-row--scroll' });
  const libraryCount = el('span', { class: 'hint' });
  const libraryPicks: Pick[] = [];
  const librarySection = el('div', { class: 'pick-group' }, [
    el('div', { class: 'pick-group__title' }, [
      el('span', { text: 'Library' }),
      helpButton('library', 'the library'),
      libraryCount,
    ]),
    libraryRow,
  ]);

  const fillLibrary = (term: string): boolean => {
    const found = term ? findSounds(term, CATALOGUE.length) : SHELF;
    const showing = found.slice(0, LIBRARY_SHOWN);

    libraryPicks.length = 0;
    clear(libraryRow);
    for (const entry of showing) {
      const pick = pickButton(
        entry.name,
        { kind: 'design', name: entry.voice },
        () => false,
        entry,
      );
      pick.node.title = `${entry.voice}, ${entry.length.toFixed(2)}s`;
      libraryPicks.push(pick);
      libraryRow.appendChild(pick.node);
    }

    setText(
      libraryCount,
      term
        ? `${found.length} found${found.length > showing.length ? `, first ${showing.length}` : ''}`
        : `${CATALOGUE.length} sounds, one of each shown`,
    );
    return showing.length > 0;
  };

  sections.push({ node: librarySection, picks: libraryPicks, fill: fillLibrary });
  // Drawn once up front, so the shelf is there to browse before anything is
  // typed and before the first state has arrived.
  fillLibrary('');

  /* ---------- the same words, asked of Freesound ---------- */

  /*
   * Recordings from Freesound, under the sounds this app can make.
   *
   * One box. What the library has comes first, because it is instant and it
   * is yours; what Freesound has follows, because it is half a million real
   * recordings and it is a download and a credit away.
   *
   * A group of its own rather than mixed in, so nobody adds a stranger's
   * CC-BY recording thinking it was one of the forty voices. The licence sits
   * on every row for the same reason.
   *
   * There is no API key here. It lives in the deployment's environment and
   * the browser asks this app's own `/api/freesound` — see
   * `audio/freesound-proxy.ts`. A deployment without one is a normal state:
   * this group simply never appears.
   */
  const onlineRow = el('div', { class: 'pick-row pick-row--scroll' });
  const onlineCount = el('span', { class: 'hint' });
  const onlinePicks: Pick[] = [];
  const onlineSection = el('div', { class: 'pick-group' }, [
    el('div', { class: 'pick-group__title' }, [
      el('span', { text: 'From Freesound' }),
      helpButton('freesound', 'sounds from Freesound'),
      onlineCount,
    ]),
    onlineRow,
  ]);

  /** The one audio element previews play through, so two cannot overlap. */
  const previewing = el('audio', { class: 'found__audio' }) as HTMLAudioElement;
  previewing.preload = 'none';

  /** Nothing is asked of the network until typing has stopped. */
  let onlineTimer = 0;
  /** What was last asked for, so a late reply for an old term is dropped. */
  let onlineTerm = '';
  /** Set once the deployment says it has no key, so it is asked only once. */
  let onlineOff = false;

  const drawOnline = (sounds: readonly Found[]): void => {
    onlinePicks.length = 0;
    clear(onlineRow);
    for (const sound of sounds) {
      const owed = sound.licence && !/creative commons 0/i.test(sound.licence);
      /*
       * The whole row is the button, because the whole row is one gesture.
       *
       * This was a play button, a label and a Keep button: search, Keep, wait,
       * scroll to the recordings, find it, click it, place it — against one
       * click for a sound this app makes. Now clicking a result plays it and
       * arms it, exactly like clicking anything else in the palette, and it
       * joins the library when it is placed rather than when it is merely
       * listened to.
       */
      const row = button(
        {
          class: 'found__row',
          title: owed
            ? `Hear it and arm it. Placing it keeps it, and records that ${sound.author} must be credited.`
            : 'Hear it and arm it. Placing it keeps it.',
          on: {
            click: () => {
              /*
               * Sound now, through the preview, while the file is still on its
               * way. Waiting for a download before anything is audible is most
               * of what made this feel slow, and the element streams.
               */
              previewing.src = soundUrl(sound);
              void previewing.play().catch(() => {
                // A blocked autoplay is not worth reporting: the fetch below
                // is what the click was for, and it plays again once armed.
              });
              void session.tryFreesound(sound);
            },
          },
        },
        [
          el('div', { class: 'found__what' }, [
            el('div', { class: 'found__name', text: sound.name }),
            el('div', {
              class: 'found__by',
              text: `${sound.author} · ${sound.duration.toFixed(1)}s · ${owed ? sound.licence : 'CC0'}`,
            }),
          ]),
        ],
      );
      onlineRow.appendChild(row);
    }
  };

  const askOnline = (term: string): void => {
    window.clearTimeout(onlineTimer);
    if (!term || onlineOff) {
      clear(onlineRow);
      setText(onlineCount, '');
      return;
    }
    onlineTimer = window.setTimeout(() => {
      // Anything fetched for the last search and never used goes now, so the
      // recordings do not fill with everything that was ever clicked.
      session.releaseLoans();
      onlineTerm = term;
      setText(onlineCount, 'looking…');
      void searchFreesound(term)
        .then((page) => {
          // A reply for something typed three keystrokes ago is not an answer.
          if (onlineTerm !== term) return;
          drawOnline(page.sounds);
          setText(
            onlineCount,
            page.sounds.length ? `${page.sounds.length} of ${page.total} · previews` : 'none found',
          );
          onlineSection.style.display = page.sounds.length ? '' : 'none';
        })
        .catch((error: unknown) => {
          if (onlineTerm !== term) return;
          clear(onlineRow);
          // A deployment with no key is not a fault to keep reporting: the
          // group goes away and stays away rather than saying so every time.
          if (error instanceof FreesoundError && error.fault.kind === 'off') {
            onlineOff = true;
            onlineSection.style.display = 'none';
            return;
          }
          setText(onlineCount, error instanceof Error ? error.message : 'that did not work');
        });
    }, ONLINE_WAIT);
  };

  /*
   * Outside the `sections` list, because those are filtered from a list held
   * in memory and this one has to go and ask. `fill` returning true keeps the
   * group mounted while the answer is on its way.
   */
  sections.push({
    node: onlineSection,
    picks: onlinePicks,
    fill: (term: string): boolean => {
      askOnline(term);
      return Boolean(term) && !onlineOff;
    },
  });

  /* ---------- made from what you said ---------- */

  /**
   * The same box, read as a sentence rather than as a name.
   *
   * One box and two answers, because "huge bell" is both a thing the library
   * has a name for and a thing worth building, and asking somebody to decide
   * which of two boxes they meant before they have typed anything is asking
   * the wrong question. What comes back from the library is a sound that
   * exists; what comes back from here is one made to order, at settings no
   * entry in the library happens to sit on.
   */
  const sayRow = el('div', { class: 'pick-row pick-row--scroll' });
  const sayNote = el('span', { class: 'hint' });
  const sayPicks: Pick[] = [];
  const saySection = el('div', { class: 'pick-group' }, [
    el('div', { class: 'pick-group__title' }, [
      el('span', { text: 'Made from your words' }),
      helpButton('describe', 'describing a sound'),
      sayNote,
    ]),
    sayRow,
  ]);

  const quoted = (words: readonly string[]): string => words.map((w) => `“${w}”`).join(', ');

  const fillSaid = (term: string): boolean => {
    sayPicks.length = 0;
    clear(sayRow);
    if (!term) return false;

    const reading = describe(term);
    /*
     * A bare voice name is already a button three rows down, and building it
     * again at the settings it already has would be two of the same thing.
     * A stack never is: two voices as one sound is not something any single
     * button can offer, however plainly it was asked for.
     */
    const offer = reading.shaped
      ? reading.suggestions
      : reading.suggestions.filter((suggestion) => suggestion.over?.length);
    const worth = offer.length > 0;
    if (worth) {
      for (const suggestion of offer) {
        // A description that asked for one sound made of several arrives as a
        // stack, which the cue carries as one source with others under it.
        const source: CueSource = {
          kind: 'design',
          name: suggestion.voice,
          ...(suggestion.over?.length
            ? {
                with: suggestion.over.map((part) => ({
                  kind: 'design' as const,
                  name: part.voice,
                  mix: part.mix,
                })),
              }
            : {}),
        };
        const pick = pickButton(suggestion.name, source, () => false, suggestion);
        pick.node.title = suggestion.why.join(' · ');
        sayPicks.push(pick);
        sayRow.appendChild(pick.node);
      }
    }

    // Words it did not understand are handed back rather than swallowed,
    // which is the only way anybody finds out what it does understand. Held
    // until there are two words, so it does not scold you halfway through
    // typing a name.
    const complain = reading.unknown.length > 0 && term.split(/\s+/).length > 1;
    setText(
      sayNote,
      complain ? `nothing here for ${quoted(reading.unknown)}` : worth ? 'built to order' : '',
    );
    return worth || complain;
  };

  sections.push({ node: saySection, picks: sayPicks, fill: fillSaid });

  /* ---------- packs ---------- */

  const mineSection = el('div', {});
  const packSections = el('div', {});
  const packInput = el('input', {
    type: 'file',
    style: { display: 'none' },
    attrs: { accept: 'application/json,.json', multiple: '' },
    on: {
      change: (event) => {
        const input = event.currentTarget as HTMLInputElement;
        for (const file of Array.from(input.files ?? [])) void session.loadPack(file);
        input.value = '';
      },
    },
  }) as HTMLInputElement;

  const loadPacks = button(
    {
      class: 'chip chip--sm',
      style: { width: '100%' },
      title:
        'A sound pack is a small file describing how to make its sounds. Anything ' +
        'written for @web-kits/audio works, and nothing is uploaded or downloaded ' +
        'to use one.',
      on: { click: () => packInput.click() },
    },
    ['Load a sound pack'],
  );

  /* ---------- recordings of your own ---------- */

  const sampleSections = el('div', {});

  /** What is typed in the recordings search, lower case. */
  let sampleQuery = '';
  /** The last thing painted, so the search can repaint without new state. */
  let lastPacks: AppState['packs'] = [];
  let lastMine: AppState['mine'] = [];
  let lastSamples: AppState['samples'] = [];

  const takeFiles = (input: HTMLInputElement): void => {
    void session.addSamples(Array.from(input.files ?? []));
    input.value = '';
  };

  // Zips as well as loose audio, because a Freesound pack arrives as one and
  // nobody should have to unpack four hundred files by hand first.
  const sampleInput = el('input', {
    type: 'file',
    style: { display: 'none' },
    attrs: { accept: 'audio/*,.zip,application/zip', multiple: '' },
    on: { change: (event) => takeFiles(event.currentTarget as HTMLInputElement) },
  }) as HTMLInputElement;

  /*
   * A whole folder, which is how a sound archive actually arrives.
   *
   * `webkitdirectory` is the only way a browser offers this, and it is set as
   * an attribute rather than a property because it is not in the typed DOM.
   * Files picked this way carry `webkitRelativePath`, which is what lets the
   * folders an archive filed its sounds under survive the import as tags.
   */
  const folderInput = el('input', {
    type: 'file',
    style: { display: 'none' },
    attrs: { multiple: '', webkitdirectory: '', directory: '' },
    on: { change: (event) => takeFiles(event.currentTarget as HTMLInputElement) },
  }) as HTMLInputElement;

  const loadSamples = button(
    {
      class: 'chip chip--sm',
      title:
        'Put your own recordings on the timeline — audio files or a zip. They get ' +
        'the same level, room, push and automation everything else does, and stay ' +
        'in this browser.',
      on: { click: () => sampleInput.click() },
    },
    ['Add recordings'],
  );

  const loadFolder = button(
    {
      class: 'chip chip--sm',
      title:
        'Add a whole folder of recordings at once. The folders they sit in ' +
        'become tags, so an archive keeps the way it was filed.',
      on: { click: () => folderInput.click() },
    },
    ['Add a folder'],
  );

  /*
   * What is owed to whom, as a file.
   *
   * A CC-BY sound requires its author be credited wherever the work is used,
   * and a library of four hundred is past the point where anyone remembers
   * which ones those are. This writes the list. Sounds under CC0 are left out
   * because they ask for nothing and a list padded with them is one nobody
   * reads. See `audio/samples.ts`.
   */
  const credits = button(
    {
      class: 'chip chip--sm',
      title: 'Write out the authors and licences of every recording that asks to be credited',
      on: { click: () => session.saveCredits() },
    },
    ['Save credits'],
  );

  /*
   * Finding one sound among hundreds.
   *
   * A palette of forty voices is a wall you can read. Four hundred recordings
   * is not, and the difference is that a recording cannot be found by knowing
   * what it is made of — only by what it is called and where it was filed.
   */
  const sampleFind = el('input', {
    type: 'search',
    // Two searches share this look and are different things: one filters the
    // recordings already here, the other asks Freesound. Named apart so a
    // stylesheet can treat them alike and everything else can tell them apart.
    class: 'pick-find pick-find--held',
    attrs: { placeholder: 'Find a recording', 'aria-label': 'Find a recording' },
    on: {
      input: (event) => {
        sampleQuery = (event.currentTarget as HTMLInputElement).value.trim().toLowerCase();
        paintedSamples = null;
        paintPacks(lastPacks, lastMine, lastSamples);
      },
    },
  }) as HTMLInputElement;

  /* ---------- out of a recording ---------- */

  /**
   * Sounds pulled out of a file and rebuilt from the palette.
   *
   * Three offers per sound rather than one answer, and no verdict on which is
   * right. The app cannot tell a good rebuild from a hopeless one — measured,
   * a recording of its own work scores between seventy three and ninety six,
   * and a sound it has no way of making scores between seventy and seventy
   * six — so it puts three in front of you, plays whichever you touch, and
   * leaves the choosing to ears.
   */
  const heardList = el('div', { class: 'heard-list' });
  const heardNote = el('div', { class: 'hint' });
  /**
   * The offers on screen, so the one that is armed can be lit.
   *
   * Kept apart from the picker's own sections because these are not sounds to
   * choose between by name — the search box has nothing to say about them,
   * and filtering them would hide the one you were listening to.
   */
  const heardWays: { node: HTMLElement; id: string }[] = [];

  const heardInput = el('input', {
    type: 'file',
    style: { display: 'none' },
    attrs: { accept: 'audio/*,video/*' },
    on: {
      change: (event) => {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (file) void session.extractFrom(file);
        input.value = '';
      },
    },
  }) as HTMLInputElement;

  const heardOpen = button(
    {
      class: 'chip chip--sm',
      style: { width: '100%' },
      title:
        'Find the separate sounds in an audio or video file and rebuild each ' +
        'one out of these voices. Nothing is uploaded. What comes back is ' +
        'editable — a voice and five numbers — rather than a recording.',
      on: { click: () => heardInput.click() },
    },
    ['Take sounds out of a recording'],
  );

  const heardPlaceAll = button(
    {
      class: 'chip chip--sm',
      style: { flex: '1 1 0' },
      title: 'Put the closest of each where it was in the recording',
      on: { click: () => session.placeAllExtracted() },
    },
    ['Place them all'],
  );
  const heardClear = button(
    { class: 'chip chip--sm', on: { click: () => session.clearExtracted() } },
    ['Forget'],
  );
  const heardActions = el('div', { style: { display: 'flex', gap: '4px', marginTop: '6px' } }, [
    heardPlaceAll,
    heardClear,
  ]);

  const heardBody = el('div', {}, [
    heading('From a recording', 'extract', { marginTop: '12px' }),
    heardOpen,
    heardInput,
    heardNote,
    heardList,
    heardActions,
  ]);

  /** What the list was last drawn from, so it is redrawn only when it moves. */
  let paintedHeard: AppState['extract'] | null = null;

  const paintHeard = (extract: AppState['extract'], project: AppState['project']): void => {
    if (extract === paintedHeard) return;
    paintedHeard = extract;

    setText(
      heardNote,
      extract.busy
        ? extract.busy
        : extract.sounds.length
          ? `${extract.sounds.length} sounds from ${extract.from}. ` +
            'The number is how alike, not how good — listen.'
          : '',
    );
    heardActions.style.display = extract.sounds.length ? 'flex' : 'none';

    clear(heardList);
    heardWays.length = 0;
    for (const sound of extract.sounds) {
      const ways = [sound, ...sound.also];
      heardList.appendChild(
        el('div', { class: 'heard-row' }, [
          el('span', {
            class: 'heard-row__at',
            text: timecode(sound.heard.at, project.fps),
            title: `${sound.heard.length.toFixed(2)}s long`,
          }),
          el(
            'div',
            { class: 'heard-row__ways' },
            ways.map((way, at) => {
              const node = button(
                {
                  class: 'cell pick heard-way',
                  title:
                    `${way.name} — ${(way.match * 100).toFixed(0)}% alike. ` +
                    (at ? 'Another way of making it.' : 'The closest one found.'),
                  on: { click: () => session.chooseMade(way) },
                },
                [
                  // Just the voices on the button. The full name, the size and
                  // the room are in the tooltip: three of these have to sit in
                  // a column narrow enough to leave room for the number, and
                  // what tells them apart is which voices they are made of.
                  el('span', {
                    text: [way.source.name, ...(way.source.with ?? []).map((part) => part.name)].join(' + '),
                  }),
                  el('span', { class: 'heard-way__match', text: `${(way.match * 100).toFixed(0)}` }),
                ],
              );
              heardWays.push({ node, id: way.preset.id });
              return node;
            }),
          ),
          button(
            {
              class: 'chip chip--sm',
              title: 'Put the closest one where it was in the recording',
              on: { click: () => session.placeMade(sound.heard.at, sound) },
            },
            ['Place'],
          ),
        ]),
      );
    }
  };

  /** Filter, which is what makes several hundred sounds usable at all. */
  const search = el('input', {
    class: 'pick-search',
    type: 'search',
    attrs: {
      placeholder: 'Find a sound, or describe one',
      'aria-label': 'Find a sound, or describe one',
      title:
        'A name finds it. A sentence builds it: "a huge metal door slamming in ' +
        'a warehouse", "very quick bright tick, no reverb". Words it does not ' +
        'know are listed back to you.',
    },
  }) as HTMLInputElement;

  /**
   * Whether the search is the reason the browser is open.
   *
   * So that clearing the box puts it back, the way a group that opened itself
   * closes again, while a browser somebody opened for themselves is left
   * alone.
   */
  let browseOpenedBySearch = false;

  /**
   * Open the grouped browser when a word only matches inside it.
   *
   * It is folded away until it is wanted, which is right for browsing and
   * wrong for searching: typing "piano" matched the three piano gestures, the
   * filter dutifully opened the group holding them, and all of it happened
   * inside a closed box. The word came back with nothing, which reads as the
   * app not having a piano at all — and finding these by name is the whole
   * reason the instruments were folded into the library.
   *
   * The fold is moved directly rather than through its button, so a search
   * never changes what somebody chose to have open next time.
   */
  function revealBrowse(want: boolean): void {
    const wrap = foldWraps.get('kinds');
    const head = foldHeads.get('kinds');
    if (!wrap || !head) return;

    const shut = wrap.classList.contains('folds--shut');
    if (want && shut) {
      browseOpenedBySearch = true;
    } else if (want || !browseOpenedBySearch) {
      return;
    } else {
      browseOpenedBySearch = false;
    }
    toggleClass(wrap, 'folds--shut', !want);
    head.setAttribute('aria-expanded', want ? 'true' : 'false');
  }

  function applyFilter(): void {
    const term = search.value.trim().toLowerCase();
    for (const section of sections) {
      if (section.fill) {
        section.node.style.display = section.fill(term) ? '' : 'none';
        continue;
      }
      let showing = 0;
      for (const pick of section.picks) {
        const keep = !term || pick.label.toLowerCase().includes(term);
        pick.node.style.display = keep ? '' : 'none';
        if (keep) showing++;
      }
      section.node.style.display = showing ? '' : 'none';
      /*
       * A group that matches opens itself, and closes again when the box is
       * cleared. Otherwise typing a word would hide every group that did not
       * match and show an empty one that did, which reads as the search being
       * broken rather than as the group being shut.
       */
      const group = openable.find((o) => o.node === section.node);
      if (group) group.open(Boolean(term) && showing > 0);
    }

    // Anything the browser holds is behind a fold of its own.
    const inside = sections.some(
      (section) => browseBody.contains(section.node) && section.node.style.display !== 'none',
    );
    revealBrowse(Boolean(term) && inside);

    // Buttons the filter just built have never been lit, and the next state
    // update may be a long way off if nothing is clicked.
    paintChosen();
  }
  search.addEventListener('input', applyFilter);

  /**
   * Step through what the filter left, hearing each one.
   *
   * The point of the box is not only to find a sound by name but to narrow
   * three hundred down to a handful and then compare them. Arrow keys with
   * the box still focused is what makes that a single movement rather than a
   * round trip to the mouse for every sound.
   */
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();

    const visible = sections
      .flatMap((section) => section.picks)
      .filter((pick) => pick.node.style.display !== 'none');
    if (!visible.length) return;

    const at = visible.findIndex((pick) => pick.node.classList.contains('is-on'));
    const to =
      at < 0
        ? 0
        : Math.max(0, Math.min(visible.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)));

    // A click rather than setting the source directly, so this and the mouse
    // can never come to mean different things. It does not take focus, so the
    // box stays ready for the next key.
    visible[to].node.click();
    visible[to].node.scrollIntoView({ block: 'nearest' });
  });

  // Everything after this point is a pack.
  builtIn = sections.length;

  const layerRow = el('div', { class: 'pick-row' });

  /*
   * What the layer you are placing on is for.
   *
   * One line, for whichever is chosen, rather than four at once. The four
   * names were always good and never meant anything, and a mix is mostly an
   * order of importance: this is where that order is said.
   */
  const layerJobLine = el('div', { class: 'hint layer-job' });

  const balanceButton = button(
    {
      class: 'chip chip--sm',
      title:
        'Set every layer to the level its job asks for, so the piece is not flat. ' +
        'Anything you move afterwards wins, and undo takes it back',
      on: { click: () => session.balanceLayers() },
    },
    ['Balance'],
  );

  // ---------- cue inspector ----------
  const cueTitle = el('div', { class: 'status-head__meta', text: 'Nothing selected' });
  const cueTime = el('div', { class: 'hint', text: 'Click the timeline to place a sound.' });

  const field = (
    label: string,
    min: number,
    max: number,
    step: number,
    onInput: (value: number) => void,
  ): { row: HTMLElement; input: HTMLInputElement; out: HTMLElement } => {
    const input = el('input', {
      class: 'range',
      type: 'range',
      attrs: { min: String(min), max: String(max), step: String(step) },
    }) as HTMLInputElement;
    const out = el('div', { class: 'range__value' });
    input.addEventListener('input', () => onInput(Number(input.value)));
    return {
      row: el('div', { class: 'range-row' }, [
        el('div', { class: 'setting-row__label', text: label }),
        input,
        out,
      ]),
      input,
      out,
    };
  };

  /**
   * The sound the fields are showing.
   *
   * With several chosen this is the first of them, and a change reaches all
   * of them. Showing the first rather than nothing is what makes setting six
   * sounds to the same length a single movement.
   */
  let selected: Cue | null = null;
  let chosen = 0;
  const patch = (p: Partial<Cue>): void => {
    if (selected) session.updateSelected(p);
  };

  const gain = field('Level', 0, 1.5, 0.01, (v) => patch({ gain: v }));
  const tune = field('Tune', -24, 24, 1, (v) => patch({ tune: v }));
  // The same range the timeline holds an edge drag to, so the two agree.
  const length = field('Length', MIN_LENGTH, MAX_LENGTH, 0.01, (v) => patch({ length: v }));
  // Its own room and its own push, rather than the single reverb at the end
  // of the chain that every sound used to have to share.
  const space = field('Space', 0, 1, 0.01, (v) => patch({ space: v }));
  const drive = field('Drive', 0, 1, 0.01, (v) => patch({ drive: v }));
  /*
   * How much this placement differs from another of the same sound.
   *
   * Below the room and the push because it is the only one of these that is
   * about the placement rather than the sound: turning it up does not change
   * what a sound is, it changes how much this one differs from the next one
   * like it. At nothing, six of them in a row are six copies of one file,
   * which is what a synthesised effect always used to be.
   */
  const vary = field('Variation', 0, 1, 0.01, (v) => patch({ vary: v }));

  /* ---------- what the selected sound is made of ---------- */

  /**
   * The stack, and the controls for it.
   *
   * Redrawn whenever it changes rather than kept in step piece by piece,
   * because it is at most four rows and the alternative is a small machine
   * for deciding which of four rows moved.
   */
  const madeOfRow = el('div', { class: 'stack-list' });
  const stackButton = button(
    {
      class: 'chip chip--sm stack-add',
      style: { width: '100%' },
      title:
        'Play the armed sound as part of this one. A stack is one sound: it ' +
        'moves once, stretches once and sits in one room.',
      on: { click: () => session.stackArmed() },
    },
    ['Add'],
  );
  const madeOf = el('div', { style: { marginTop: '10px' } }, [
    el('div', { class: 'setting-row__label section-title--asks' }, [
      el('span', { text: 'Made of' }),
      helpButton('stack', 'stacking sounds'),
    ]),
    madeOfRow,
    stackButton,
  ]);

  /** What the stack was last drawn from, so it is redrawn only when it moves. */
  let paintedStack = '';

  const paintStack = (cue: Cue | null, armed: CueSource): void => {
    const parts = cue?.source.with ?? [];
    const label = (source: CueSource): string =>
      source.kind === 'pitched'
        ? `${source.name} ${noteName(source.midi ?? DEFAULT_MIDI)}`
        : String(source.name);

    const key = cue ? `${label(cue.source)}|${parts.map((p) => `${label(p)}:${p.mix}`).join('|')}` : '';
    if (key !== paintedStack) {
      paintedStack = key;
      clear(madeOfRow);
      if (cue) {
        // The sound itself first, with nothing to set: it is the one thing in
        // a stack that is not a proportion of something else.
        madeOfRow.appendChild(
          el('div', { class: 'stack-row stack-row--head' }, [
            el('span', { class: 'stack-row__name', text: label(cue.source) }),
          ]),
        );
        parts.forEach((part, at) => {
          const amount = el('input', {
            class: 'range',
            type: 'range',
            attrs: { min: '0', max: '1', step: '0.05', 'aria-label': `how much ${label(part)}` },
          }) as HTMLInputElement;
          amount.value = String(part.mix ?? 1);
          amount.addEventListener('input', () => session.setStackMix(at, Number(amount.value)));
          madeOfRow.appendChild(
            el('div', { class: 'stack-row' }, [
              el('span', { class: 'stack-row__name', text: label(part) }),
              amount,
              button(
                {
                  class: 'tl__layer-btn tl__layer-btn--remove',
                  title: `Take ${label(part)} off`,
                  on: { click: () => session.unstack(at) },
                },
                ['×'],
              ),
            ]),
          );
        });
      }
    }

    const full = parts.length >= SoundDesignSession.MAX_STACK;
    // Adding the sound to itself is legal and pointless, so the button says
    // what it would actually do rather than offering it.
    const same = cue !== null && armed.kind === cue.source.kind && armed.name === cue.source.name;
    stackButton.disabled = full || same;
    setText(
      stackButton,
      full
        ? 'Four voices is the most a stack holds'
        : same
          ? 'Choose another sound to add'
          : `Add ${armed.name} to it`,
    );
  };

  const anchorButtons: { anchor: Anchor; node: HTMLButtonElement }[] = (
    [
      { anchor: 'start' as Anchor, label: 'Starts on it' },
      { anchor: 'end' as Anchor, label: 'Ends on it' },
    ]
  ).map((option) => ({
    anchor: option.anchor,
    node: button(
      {
        class: 'cell',
        style: { flex: '1 1 0' },
        title:
          option.anchor === 'end'
            ? 'The sound finishes on the marker, for risers and swells that lead into a cut'
            : 'The sound begins on the marker',
        on: { click: () => patch({ anchor: option.anchor }) },
      },
      [el('span', { text: option.label })],
    ),
  }));

  const nudgeRow = el('div', { style: { display: 'flex', gap: '4px' } }, [
    button({ class: 'chip chip--sm', title: 'Back one frame', on: { click: () => session.nudgeSelection(-1) } }, ['−1f']),
    button({ class: 'chip chip--sm', title: 'On one frame', on: { click: () => session.nudgeSelection(1) } }, ['+1f']),
    button({ class: 'chip chip--sm', title: 'Play from just before this sound', on: { click: () => selected && session.previewInContext(selected) } }, ['In context']),
  ]);

  const muteButton = button(
    { class: 'chip chip--sm', title: 'Silence without deleting, to compare', on: { click: () => patch({ muted: !selected?.muted }) } },
    ['Mute'],
  );

  /**
   * Keep this sound, exactly as it is now, under a name.
   *
   * Getting a voice, a length, a pitch, a level, a room and a push to sit
   * right together is most of the work, and until now it lived only in the
   * one place it was placed.
   */
  const saveButton = button(
    {
      class: 'chip chip--sm',
      title: 'Keep this sound as it is, under a name, for this and every other project',
      on: {
        click: () => {
          if (!selected) return;
          const suggested = String(selected.source.name);
          const name = window.prompt('Name this sound', suggested);
          if (name !== null) session.saveAsMine(selected, name);
        },
      },
    },
    ['Save as mine'],
  );

  const forgetButton = button(
    {
      class: 'chip chip--sm chip--danger',
      title: 'Forget this saved sound. Anything already placed from it stays where it is.',
      on: {
        click: () => {
          if (selected?.source.kind === 'pack' && selected.source.pack === MINE_ID) {
            session.removeMine(String(selected.source.name));
          }
        },
      },
    },
    ['Forget'],
  );
  const deleteButton = button(
    { class: 'chip chip--sm chip--danger', on: { click: () => session.removeSelected() } },
    ['Delete'],
  );

  const cueBody = el('div', { class: 'card', style: { padding: '12px 14px 14px' } }, [
    cueTitle,
    cueTime,
    gain.row,
    tune.row,
    length.row,
    space.row,
    drive.row,
    vary.row,
    madeOf,
    el('div', { class: 'setting-row__label', style: { marginTop: '10px' }, text: 'Lands so that it' }),
    el('div', { style: { display: 'flex', gap: '4px', marginTop: '6px' } }, anchorButtons.map((a) => a.node)),
    el('div', { style: { marginTop: '10px' } }, [nudgeRow]),
    el('div', { style: { display: 'flex', gap: '4px', marginTop: '6px' } }, [muteButton, deleteButton]),
    el('div', { style: { display: 'flex', gap: '4px', marginTop: '6px' } }, [saveButton, forgetButton]),
  ]);

  // ---------- export ----------
  const exportStatus = el('div', { class: 'hint', style: { marginTop: '8px' } });

  const settings: ExportSettings = { ...DEFAULT_EXPORT };

  /** A labelled switch that flips one setting. */
  const toggle = (
    label: string,
    title: string,
    on: boolean,
    onChange: (value: boolean) => void,
    after?: HTMLElement,
  ): HTMLElement => {
    const node = button(
      {
        class: 'switch',
        attrs: { role: 'switch', 'aria-label': label },
        on: {
          click: () => {
            const next = !node.classList.contains('is-on');
            toggleClass(node, 'is-on', next);
            onChange(next);
          },
        },
      },
      [el('i', { class: 'switch__thumb' })],
    );
    toggleClass(node, 'is-on', on);
    return el('div', { class: 'setting-row', title }, [
      el('div', { class: 'setting-row__label', text: label }),
      ...(after ? [after] : []),
      node,
    ]);
  };

  const loudnessValue = el('div', {
    class: 'hint',
    style: { marginRight: '8px', whiteSpace: 'nowrap' },
    text: `${DEFAULT_TARGET_LUFS} LUFS`,
  });

  /** A row of buttons that write the same thing in two formats. */
  /** Every button that starts a render, so none of them runs while one is. */
  const exportButtons: HTMLButtonElement[] = [];

  const formats = (
    label: string,
    title: string,
    write: (format: 'wav' | 'mp3') => void,
    accent = false,
  ): HTMLElement => {
    const wav = button(
      {
        class: accent ? 'btn-accent' : 'chip chip--sm',
        style: { flex: '1 1 0' },
        on: { click: () => write('wav') },
      },
      ['WAV'],
    );
    const mp3 = button(
      { class: 'chip chip--sm', style: { flex: '1 1 0' }, on: { click: () => write('mp3') } },
      ['MP3'],
    );
    exportButtons.push(wav, mp3);
    return el('div', { style: { marginTop: '10px' }, title }, [
      el('div', { class: 'setting-row__label', text: label }),
      el('div', { style: { display: 'flex', gap: '4px', marginTop: '6px' } }, [wav, mp3]),
    ]);
  };

  const markerButton = button(
    {
      class: 'chip chip--sm',
      title: 'A spreadsheet of every sound and the frame it lands on, for whoever picks this up next',
      on: { click: () => session.exportMarkers() },
    },
    ['Marker list'],
  );
  exportButtons.push(markerButton);

  const midiButton = button(
    {
      class: 'chip chip--sm',
      title:
        'The same thing as a MIDI file, which a music program opens on its own ' +
        'timeline in sync, with every sound on a row of its own',
      on: { click: () => session.exportTimelineMidi() },
    },
    ['MIDI'],
  );
  exportButtons.push(midiButton);

  // Two ways of handing the timing to somebody else, side by side.
  markerButton.style.flex = '1 1 0';
  midiButton.style.flex = '1 1 0';
  const handoffRow = el('div', { style: { display: 'flex', gap: '4px' } }, [
    markerButton,
    midiButton,
  ]);

  const exportBody = el('div', { class: 'card card--export', style: { padding: '12px 14px 14px' } }, [
    /*
     * Off by default, so a reverb tail at the end of the piece is allowed to
     * finish. Either way the file starts at zero and lines up when dropped at
     * the head of the composition.
     */
    toggle(
      'Cut to video length',
      'End the file exactly where the video ends, cutting anything still sounding',
      settings.trimToDuration,
      (on) => {
        settings.trimToDuration = on;
      },
    ),
    toggle(
      'Stop it clipping',
      'A hundred sounds on one frame add up past what a file can hold, and the ' +
        'part that does not fit is heard as a crack on the loudest moment. This ' +
        'holds those moments back instead, and leaves everything else alone.',
      settings.limit,
      (on) => {
        settings.limit = on;
      },
    ),
    toggle(
      'Match loudness',
      'Bring every export to the same loudness, so two pieces cut together sit ' +
        'the same way against picture without anyone reaching for a fader.',
      settings.target !== null,
      (on) => {
        settings.target = on ? DEFAULT_TARGET_LUFS : null;
        loudnessValue.style.opacity = on ? '1' : '0.4';
      },
      loudnessValue,
    ),
    el('div', { class: 'rule' }),
    formats('One mixed file', 'Everything in one file', (f) => void session.exportAudio(f, settings), true),
    formats(
      'One file per layer',
      'All the same length and all starting at zero, so they sit on separate tracks and stay in sync',
      (f) => void session.exportStems(f, settings),
    ),
    formats(
      'One file per sound',
      'Every impact in one file, every whoosh in another, so they can be balanced against each other later',
      (f) => void session.exportPerSound(f, settings),
    ),
    el('div', { style: { marginTop: '10px' } }, [handoffRow]),
    exportStatus,
  ]);

  // ---------- session ----------
  const openInput = el('input', {
    type: 'file',
    style: { display: 'none' },
    attrs: { accept: 'application/json,.json' },
    on: {
      change: (event) => {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (file) void session.openSession(file);
        input.value = '';
      },
    },
  }) as HTMLInputElement;

  /**
   * Start again on nothing.
   *
   * Asks first, and says what it is throwing away, because the piece is kept
   * from one visit to the next now: this is the only thing in the app that
   * gets rid of it, so it is the only place that could lose work nobody meant
   * to lose.
   */
  const newProject = button(
    {
      class: 'chip chip--sm chip--danger',
      style: { width: '100%' },
      title: 'Clear the timeline and the clip, and start on nothing',
      on: {
        click: () => {
          const { project } = session.store.state;
          const count = project.cues.length;
          const has = count > 0 || project.videoName;
          const what = count ? `${count} sound${count === 1 ? '' : 's'}` : 'the clip';
          if (has && !window.confirm(`Start a new project? This throws away ${what}.`)) return;
          void session.newProject();
        },
      },
    },
    ['New project'],
  );

  const sessionBody = el('div', {}, [
    el('div', {
      class: 'hint',
      style: { marginBottom: '6px' },
      text: 'Kept as you work, so closing the page and coming back picks up where you left off.',
    }),
    el('div', { style: { display: 'flex', gap: '4px' } }, [
      button({ class: 'chip chip--sm', style: { flex: '1 1 0' }, on: { click: () => session.saveSession() } }, ['Save session']),
      button({ class: 'chip chip--sm', style: { flex: '1 1 0' }, on: { click: () => openInput.click() } }, ['Open session']),
      openInput,
    ]),
    el('div', { style: { marginTop: '4px' } }, [newProject]),
  ]);

  const paletteBody = el('div', {}, [
    el('div', { class: 'hint', style: { marginBottom: '6px' } , text:
      'Write all 37 sounds to a file others can install and play.' }),
    button(
      {
        class: 'chip chip--sm',
        style: { width: '100%' },
        title: 'Write the palette as a @web-kits/audio patch file',
        on: { click: () => session.exportPatch() },
      },
      ['Export patch'],
    ),
  ]);

  /*
   * Marked as the panel the work happens in, not a panel of readouts.
   *
   * A narrow window hides the instrument inspector, which is fair: reverb, EQ
   * and the engine light are things you glance at. This one is where a sound
   * is chosen, described, stacked, edited and exported, so hiding it leaves a
   * timeline you can drop sounds onto and nothing else — no way to say which
   * sound, no way to get a file out. See `layout.css`.
   */
  /*
   * The panel in three parts, so the tab strip can show one at a time.
   *
   * Split here rather than in the wrapper because only this file knows which
   * piece is which. Choosing a sound and editing the one already down are two
   * different jobs, and a newcomer doing the first should not be scrolling
   * past the second. Export, session and palette are neither, so they stay on
   * show under whichever tab is up.
   */
  const soundsPage = el('div', { class: 'panel-page' }, [
    el('div', {}, [
      heading('Place', 'place'),
      search,
      // First, because a sound you made is the one you are most likely
      // reaching for.
      mineSection,
      // What you asked for before what merely matches it, since somebody who
      // typed a sentence meant the sentence.
      saySection,
      // Then the library, because a typed word is answered best by the list
      // that was built to be searched.
      librarySection,
      // Under the library: what this app can make comes before what has to be
      // downloaded and credited.
      onlineSection,
      previewing,
      /*
       * The whole grouped palette behind one fold.
       *
       * Twelve groups were collapsed to one line each, which was still twelve
       * lines and three hundred pixels of headings for something most people
       * never open: the search and the library shelf above are how a sound is
       * actually found. Browsing is the fallback, so it costs one line until
       * it is wanted, and inside it the groups still open one at a time.
       */
      foldable('kinds', 'Browse', 'library', browseBody, { marginTop: '8px' }, true),
      packSections,
      el('div', { style: { marginTop: '10px' } }, [loadPacks, packInput]),
      sampleSections,
      // One row of three. The help dot used to sit under a full-width button
      // on a line of its own, which reads as a stray character.
      el('div', { class: 'pick-actions pick-actions--three' }, [
        loadSamples,
        sampleInput,
        loadFolder,
        folderInput,
        credits,
        helpButton('recordings', 'your own recordings'),
      ]),
      heardBody,
      el('div', { class: 'layer-head' }, [
        heading('On layer', 'timeline', { marginTop: '12px' }),
        balanceButton,
      ]),
      layerRow,
      layerJobLine,
    ]),
  ]);

  // Not folded: it has a tab of its own now, and a fold inside a tab is one
  // click to reach the thing the tab was already for.
  const selectedPage = el('div', { class: 'panel-page' }, [
    heading('Selected sound', 'sound'),
    cueBody,
  ]);

  const tail = el('div', { class: 'panel-tail' }, [
    foldable('export', 'Export', 'export', exportBody),
    foldable('session', 'Session', 'session', sessionBody),
    foldable('palette', 'Palette', 'export', paletteBody),
  ]);

  const root = el('aside', { class: 'inspector inspector--work' }, [
    soundsPage,
    selectedPage,
    tail,
  ]);

  let paintedLayers: AppState['project']['layers'] | null = null;
  let paintedPacks: AppState['packs'] | null = null;
  let paintedMine: AppState['mine'] | null = null;
  let paintedSamples: AppState['samples'] | null = null;

  /**
   * Rebuild the pack sections.
   *
   * Packs change rarely, so the whole lot is redrawn rather than worked out
   * one by one. Cutting the section list back to the built in ones first is
   * what stops a removed pack's sounds going on being filtered and lit.
   */
  function paintPacks(
    packs: AppState['packs'],
    mine: AppState['mine'],
    recordings: AppState['samples'],
  ): void {
    lastPacks = packs;
    lastMine = mine;
    lastSamples = recordings;
    sections.length = builtIn;
    clear(mineSection);
    clear(packSections);
    clear(sampleSections);

    if (mine.length) {
      mineSection.appendChild(
        pickGroup(
          `Mine · ${mine.length}`,
          mine.map((sound) =>
            pickButton(
              sound.name,
              { kind: 'pack', name: sound.name, pack: MINE_ID },
              (c) => c.kind === 'pack' && c.pack === MINE_ID && c.name === sound.name,
            ),
          ),
        ),
      );
    }

    for (const pack of packs) {
      const remove = button(
        {
          class: 'tl__layer-btn tl__layer-btn--remove',
          title: `Remove ${pack.name}`,
          on: { click: () => session.removePack(pack.id) },
        },
        ['×'],
      );
      packSections.appendChild(
        pickGroup(
          `${pack.name} · ${pack.sounds.length}`,
          pack.sounds.map((sound) =>
            pickButton(
              sound.name,
              { kind: 'pack', name: sound.name, pack: pack.id },
              (c) => c.kind === 'pack' && c.pack === pack.id && c.name === sound.name,
            ),
          ),
          remove,
        ),
      );
    }

    /*
     * Recordings, in one group with a length on each.
     *
     * The length is on the button because it is the one thing about a
     * recording the app cannot change: a voice stretches to whatever it is
     * asked for, and a file is as long as it is. Knowing that before placing
     * one is the difference between choosing and discovering.
     */
    if (recordings.length) {
      const forget = button(
        {
          class: 'tl__layer-btn tl__layer-btn--remove',
          title: 'Remove the last recording added',
          on: { click: () => session.removeSample(recordings[recordings.length - 1].id) },
        },
        ['×'],
      );

      /*
       * Matched on the name and on the folders it came out of, so a search for
       * "door" finds both `oak-door.wav` and everything filed under `Doors`.
       *
       * Both sides are flattened the same way first. A Freesound name arrives
       * as `sound-37` and is shown as `sound 37`, so someone typing what they
       * can see in their downloads folder was finding nothing at all.
       */
      const flat = (text: string): string => text.toLowerCase().replace(/[_\-\s]+/g, ' ').trim();
      const query = flat(sampleQuery);
      const matching = query
        ? recordings.filter(
            (sample) =>
              flat(sample.name).includes(query) ||
              (sample.tags ?? []).some((tag) => flat(tag).includes(query)),
          )
        : recordings;

      /*
       * Only ever this many buttons.
       *
       * Every pick is a live button that the filter walks on every keystroke,
       * so a library of four hundred is four hundred nodes being measured to
       * show the twelve anyone is looking at. The search is how the rest are
       * reached, and the count says how many are behind it.
       */
      const shown = matching.slice(0, SHOW_AT_MOST);
      const title =
        matching.length === recordings.length
          ? `Recordings · ${recordings.length}`
          : `Recordings · ${matching.length} of ${recordings.length}`;

      sampleSections.appendChild(sampleFind);
      sampleSections.appendChild(
        pickGroup(
          shown.length < matching.length ? `${title} · showing ${shown.length}` : title,
          shown.map((sample) =>
            pickButton(
              `${sample.name} ${sample.duration.toFixed(1)}s`,
              { kind: 'sample', name: sample.id },
              (c) => c.kind === 'sample' && c.name === sample.id,
              null,
              // Who made it and under what licence, where it can be read
              // without taking up a line in a list of four hundred.
              creditTitle(sample),
            ),
          ),
          forget,
        ),
      );
      if (!matching.length) {
        sampleSections.appendChild(
          el('div', { class: 'pick-none', text: `Nothing matching “${sampleQuery}”` }),
        );
      }
    }
  }

  return {
    el: root,
    soundsPage,
    selectedPage,
    tail,
    openGroup,
    showExport,

    update(state: AppState) {
      const { project } = state;
      armed = { source: state.currentSource, preset: state.currentPreset };

      if (
        state.packs !== paintedPacks ||
        state.mine !== paintedMine ||
        state.samples !== paintedSamples
      ) {
        paintedSamples = state.samples;
        paintedPacks = state.packs;
        paintedMine = state.mine;
        paintPacks(state.packs, state.mine, state.samples);
        applyFilter();
      }

      paintHeard(state.extract, project);
      paintChosen();

      if (project.layers !== paintedLayers) {
        paintedLayers = project.layers;
        clear(layerRow);
        for (const layer of project.layers) {
          const job = layerJob(layer.id);
          layerRow.appendChild(
            button(
              {
                class: 'cell pick',
                ...(job ? { title: job.job } : {}),
                on: { click: () => session.setActiveLayer(layer.id) },
              },
              [el('span', { text: layer.name })],
            ),
          );
        }
      }
      Array.from(layerRow.children).forEach((node, i) =>
        toggleClass(node as HTMLElement, 'is-on', project.layers[i]?.id === state.activeLayerId),
      );

      // A layer somebody added has no job, and inventing one for it would be
      // a guess presented as advice.
      const onJob = layerJob(state.activeLayerId);
      setText(layerJobLine, onJob ? onJob.job : '');
      layerJobLine.style.display = onJob ? '' : 'none';

      const picked = new Set(state.selection);
      const all = project.cues.filter((cue) => picked.has(cue.id));
      chosen = all.length;
      selected = all[0] ?? null;
      const has = selected !== null;
      cueBody.style.opacity = has ? '1' : '0.5';
      cueBody.style.pointerEvents = has ? '' : 'none';

      if (selected) {
        const on = selected.source.with ?? [];
        const label =
          selected.source.kind === 'pitched'
            ? `${selected.source.name} ${noteName((selected.source.midi ?? DEFAULT_MIDI) + selected.tune)}`
            : on.length
              ? `${selected.source.name} with ${on.map((part) => part.name).join(' and ')}`
              : String(selected.source.name);
        setText(cueTitle, chosen > 1 ? `${chosen} sounds` : label);
        setText(
          cueTime,
          chosen > 1
            ? `from ${timecode(all[0].time, project.fps)}, changes reach all of them`
            : `at ${timecode(selected.time, project.fps)}`,
        );
        gain.input.value = String(selected.gain);
        setText(gain.out, selected.gain.toFixed(2));
        tune.input.value = String(selected.tune);
        setText(tune.out, `${selected.tune > 0 ? '+' : ''}${selected.tune}`);
        length.input.value = String(selected.length);
        setText(length.out, `${selected.length.toFixed(2)}s`);
        space.input.value = String(selected.space);
        setText(space.out, selected.space ? selected.space.toFixed(2) : 'dry');
        drive.input.value = String(selected.drive);
        setText(drive.out, selected.drive ? selected.drive.toFixed(2) : 'off');
        vary.input.value = String(selected.vary);
        // "same" rather than "off", because what nothing here means is that
        // every placement of this sound is the same sound.
        setText(vary.out, selected.vary ? selected.vary.toFixed(2) : 'same');
        // Only with one chosen: four sounds can all be given the same extra,
        // but showing one of their stacks and calling it theirs would be a lie.
        madeOf.style.display = chosen === 1 ? '' : 'none';
        paintStack(selected, state.currentSource);
        anchorButtons.forEach((a) => toggleClass(a.node, 'is-on', selected?.anchor === a.anchor));
        toggleClass(muteButton, 'is-on', selected.muted);
        // Forgetting only means anything for a sound you saved yourself, and
        // saving one only means anything when there is exactly one to save.
        const isMine = selected.source.kind === 'pack' && selected.source.pack === MINE_ID;
        forgetButton.style.display = isMine && chosen === 1 ? '' : 'none';
        saveButton.style.display = chosen === 1 ? '' : 'none';
      } else {
        setText(cueTitle, 'Nothing selected');
        setText(cueTime, 'Click the timeline to place a sound.');
      }

      /*
       * Nothing else may be started while an export runs.
       *
       * Three clicks on WAV used to start three renders at once and write
       * three identical files — minutes of wasted work on a long clip, and
       * three save prompts to dismiss.
       */
      const busy = state.exporting !== null;
      for (const node of exportButtons) node.disabled = busy;
      setText(exportStatus, state.exporting ?? '');
    },
  };
}
