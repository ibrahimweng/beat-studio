import { KIT_SOUNDS, MINE_ID, NAMES } from '../../constants.ts';
import {
  DEFAULT_EXPORT,
  DEFAULT_TARGET_LUFS,
  type ExportSettings,
  type SoundDesignSession,
} from '../../sound-design-session.ts';
import type { AppState } from '../../store.ts';
import { timecode } from '../../timeline/project.ts';
import { DESIGN_GROUPS, type Anchor, type Cue, type CueSource } from '../../timeline/types.ts';
import { button, clear, el, setText, toggleClass } from '../dom.ts';
import type { View } from '../view.ts';

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
export function createSoundDesignPanel(session: SoundDesignSession): View {
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
    chosen: (source: CueSource) => boolean;
  }

  /** A titled row of sounds, which hides itself when the filter empties it. */
  interface Section {
    node: HTMLElement;
    picks: Pick[];
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

  const pickButton = (
    label: string,
    source: CueSource,
    chosen: (current: CueSource) => boolean,
  ): Pick => ({
    node: button(
      // Choosing plays it, so a list this long can be worked through by ear.
      { class: 'cell pick', on: { click: () => session.chooseSource(source) } },
      [el('span', { text: label })],
    ),
    label,
    chosen,
  });

  /** A titled row of sounds, which disappears when the filter empties it. */
  const pickGroup = (title: string, group: Pick[], extra?: HTMLElement): HTMLElement => {
    const node = el('div', { class: 'pick-group' }, [
      el('div', { class: 'pick-group__title' }, [el('span', { text: title }), ...(extra ? [extra] : [])]),
      el('div', { class: 'pick-row' }, group.map((p) => p.node)),
    ]);
    sections.push({ node, picks: group });
    return node;
  };

  // Twenty four in one row is a wall. Grouped by what they are for, it reads.
  const designSections = DESIGN_GROUPS.map((group) =>
    pickGroup(
      group.title,
      group.names.map((name) =>
        pickButton(name, { kind: 'design', name }, (c) => c.kind === 'design' && c.name === name),
      ),
    ),
  );

  const kitSection = pickGroup(
    'Kit',
    KIT_PICKS.map((pick) =>
      pickButton(pick.label, { kind: 'kit', name: pick.name }, (c) =>
        sameSource(c, { kind: 'kit', name: pick.name }),
      ),
    ),
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
  );

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

  /** Filter, which is what makes several hundred sounds usable at all. */
  const search = el('input', {
    class: 'pick-search',
    type: 'search',
    attrs: { placeholder: 'Find a sound', 'aria-label': 'Find a sound' },
  }) as HTMLInputElement;

  function applyFilter(): void {
    const term = search.value.trim().toLowerCase();
    for (const section of sections) {
      let showing = 0;
      for (const pick of section.picks) {
        const keep = !term || pick.label.toLowerCase().includes(term);
        pick.node.style.display = keep ? '' : 'none';
        if (keep) showing++;
      }
      section.node.style.display = showing ? '' : 'none';
    }
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
  const length = field('Length', 0.02, 4, 0.01, (v) => patch({ length: v }));
  // Its own room and its own push, rather than the single reverb at the end
  // of the chain that every sound used to have to share.
  const space = field('Space', 0, 1, 0.01, (v) => patch({ space: v }));
  const drive = field('Drive', 0, 1, 0.01, (v) => patch({ drive: v }));

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
  const formats = (
    label: string,
    title: string,
    write: (format: 'wav' | 'mp3') => void,
    accent = false,
  ): HTMLElement =>
    el('div', { style: { marginTop: '10px' }, title }, [
      el('div', { class: 'setting-row__label', text: label }),
      el('div', { style: { display: 'flex', gap: '4px', marginTop: '6px' } }, [
        button(
          {
            class: accent ? 'btn-accent' : 'chip chip--sm',
            style: { flex: '1 1 0' },
            on: { click: () => write('wav') },
          },
          ['WAV'],
        ),
        button(
          { class: 'chip chip--sm', style: { flex: '1 1 0' }, on: { click: () => write('mp3') } },
          ['MP3'],
        ),
      ]),
    ]);

  const exportBody = el('div', { class: 'card', style: { padding: '12px 14px 14px' } }, [
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
    el('div', { style: { marginTop: '10px' } }, [
      button(
        {
          class: 'chip chip--sm',
          style: { width: '100%' },
          title: 'A spreadsheet of every sound and the frame it lands on, for whoever picks this up next',
          on: { click: () => session.exportMarkers() },
        },
        ['Marker list'],
      ),
    ]),
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

  const sessionBody = el('div', { style: { display: 'flex', gap: '4px' } }, [
    button({ class: 'chip chip--sm', style: { flex: '1 1 0' }, on: { click: () => session.saveSession() } }, ['Save session']),
    button({ class: 'chip chip--sm', style: { flex: '1 1 0' }, on: { click: () => openInput.click() } }, ['Open session']),
    openInput,
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

  const root = el('aside', { class: 'inspector' }, [
    el('div', {}, [
      el('div', { class: 'section-title', text: 'Place' }),
      search,
      // First, because a sound you made is the one you are most likely
      // reaching for.
      mineSection,
      ...designSections,
      kitSection,
      pitchedSection,
      packSections,
      el('div', { style: { marginTop: '10px' } }, [loadPacks, packInput]),
      el('div', { class: 'section-title', style: { marginTop: '12px' }, text: 'On layer' }),
      layerRow,
    ]),
    el('div', {}, [el('div', { class: 'section-title', text: 'Selected sound' }), cueBody]),
    el('div', {}, [el('div', { class: 'section-title', text: 'Export' }), exportBody]),
    el('div', {}, [el('div', { class: 'section-title', text: 'Session' }), sessionBody]),
    el('div', {}, [el('div', { class: 'section-title', text: 'Palette' }), paletteBody]),
  ]);

  let paintedLayers: AppState['project']['layers'] | null = null;
  let paintedPacks: AppState['packs'] | null = null;
  let paintedMine: AppState['mine'] | null = null;

  /**
   * Rebuild the pack sections.
   *
   * Packs change rarely, so the whole lot is redrawn rather than worked out
   * one by one. Cutting the section list back to the built in ones first is
   * what stops a removed pack's sounds going on being filtered and lit.
   */
  function paintPacks(packs: AppState['packs'], mine: AppState['mine']): void {
    sections.length = builtIn;
    clear(mineSection);
    clear(packSections);

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
  }

  return {
    el: root,

    update(state: AppState) {
      const { project, currentSource } = state;

      if (state.packs !== paintedPacks || state.mine !== paintedMine) {
        paintedPacks = state.packs;
        paintedMine = state.mine;
        paintPacks(state.packs, state.mine);
        applyFilter();
      }

      for (const section of sections) {
        for (const pick of section.picks) {
          toggleClass(pick.node, 'is-on', pick.chosen(currentSource));
        }
      }

      if (project.layers !== paintedLayers) {
        paintedLayers = project.layers;
        clear(layerRow);
        for (const layer of project.layers) {
          layerRow.appendChild(
            button(
              { class: 'cell pick', on: { click: () => session.setActiveLayer(layer.id) } },
              [el('span', { text: layer.name })],
            ),
          );
        }
      }
      Array.from(layerRow.children).forEach((node, i) =>
        toggleClass(node as HTMLElement, 'is-on', project.layers[i]?.id === state.activeLayerId),
      );

      const picked = new Set(state.selection);
      const all = project.cues.filter((cue) => picked.has(cue.id));
      chosen = all.length;
      selected = all[0] ?? null;
      const has = selected !== null;
      cueBody.style.opacity = has ? '1' : '0.5';
      cueBody.style.pointerEvents = has ? '' : 'none';

      if (selected) {
        const label =
          selected.source.kind === 'pitched'
            ? `${selected.source.name} ${noteName((selected.source.midi ?? DEFAULT_MIDI) + selected.tune)}`
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

      setText(exportStatus, state.exporting ?? '');
    },
  };
}
