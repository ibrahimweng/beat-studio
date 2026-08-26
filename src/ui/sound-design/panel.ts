import { KIT_SOUNDS, NAMES } from '../../constants.ts';
import type { SoundDesignSession } from '../../sound-design-session.ts';
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
  // Twenty four in one row is a wall. Grouped by what they are for, it reads.
  const designButtons: HTMLButtonElement[] = [];
  const designNames: string[] = [];
  const designSections = DESIGN_GROUPS.map((group) => {
    const buttons = group.names.map((name) => {
      const node = button(
        { class: 'cell pick', on: { click: () => session.setSource({ kind: 'design', name }) } },
        [el('span', { text: name })],
      );
      designButtons.push(node);
      designNames.push(name);
      return node;
    });
    return el('div', { class: 'pick-group' }, [
      el('div', { class: 'pick-group__title', text: group.title }),
      el('div', { class: 'pick-row' }, buttons),
    ]);
  });

  const kitButtons = KIT_PICKS.map((pick) =>
    button(
      { class: 'cell pick', on: { click: () => session.setSource({ kind: 'kit', name: pick.name }) } },
      [el('span', { text: pick.label })],
    ),
  );

  const pitchedButtons = PITCHED.map((pick) =>
    button(
      {
        class: 'cell pick',
        on: {
          click: () =>
            session.setSource({ kind: 'pitched', name: pick.name, midi: DEFAULT_MIDI }),
        },
      },
      [el('span', { text: pick.label })],
    ),
  );

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

  let selected: Cue | null = null;
  const patch = (p: Partial<Cue>): void => {
    if (selected) session.updateCue(selected.id, p);
  };

  const gain = field('Level', 0, 1.5, 0.01, (v) => patch({ gain: v }));
  const tune = field('Tune', -24, 24, 1, (v) => patch({ tune: v }));
  const length = field('Length', 0.02, 4, 0.01, (v) => patch({ length: v }));

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
    button({ class: 'chip chip--sm', title: 'Back one frame', on: { click: () => selected && session.nudgeCue(selected.id, -1) } }, ['−1f']),
    button({ class: 'chip chip--sm', title: 'On one frame', on: { click: () => selected && session.nudgeCue(selected.id, 1) } }, ['+1f']),
    button({ class: 'chip chip--sm', title: 'Play from just before this sound', on: { click: () => selected && session.previewInContext(selected) } }, ['In context']),
  ]);

  const muteButton = button(
    { class: 'chip chip--sm', title: 'Silence without deleting, to compare', on: { click: () => patch({ muted: !selected?.muted }) } },
    ['Mute'],
  );
  const deleteButton = button(
    { class: 'chip chip--sm chip--danger', on: { click: () => selected && session.removeCue(selected.id) } },
    ['Delete'],
  );

  const cueBody = el('div', { class: 'card', style: { padding: '12px 14px 14px' } }, [
    cueTitle,
    cueTime,
    gain.row,
    tune.row,
    length.row,
    el('div', { class: 'setting-row__label', style: { marginTop: '10px' }, text: 'Lands so that it' }),
    el('div', { style: { display: 'flex', gap: '4px', marginTop: '6px' } }, anchorButtons.map((a) => a.node)),
    el('div', { style: { marginTop: '10px' } }, [nudgeRow]),
    el('div', { style: { display: 'flex', gap: '4px', marginTop: '6px' } }, [muteButton, deleteButton]),
  ]);

  // ---------- export ----------
  const exportStatus = el('div', { class: 'hint', style: { marginTop: '8px' } });

  /**
   * Off by default, so a reverb tail at the end of the piece is allowed to
   * finish. Either way the file starts at zero and lines up when dropped at
   * the head of the composition.
   */
  let trim = false;
  const trimToggle = button(
    {
      class: 'switch',
      attrs: { role: 'switch', 'aria-label': 'Match the video length exactly' },
      on: {
        click: () => {
          trim = !trim;
          toggleClass(trimToggle, 'is-on', trim);
        },
      },
    },
    [el('i', { class: 'switch__thumb' })],
  );

  const exportBody = el('div', { class: 'card', style: { padding: '12px 14px 14px' } }, [
    el('div', { class: 'setting-row' }, [
      el('div', { class: 'setting-row__label', text: 'Cut to video length' }),
      trimToggle,
    ]),
    el('div', { class: 'rule' }),
    el('div', { class: 'setting-row__label', text: 'One mixed file' }),
    el('div', { style: { display: 'flex', gap: '4px', marginTop: '6px' } }, [
      button({ class: 'btn-accent', style: { flex: '1 1 0' }, on: { click: () => void session.exportAudio('wav', trim) } }, ['WAV']),
      button({ class: 'chip chip--sm', style: { flex: '1 1 0' }, on: { click: () => void session.exportAudio('mp3', trim) } }, ['MP3']),
    ]),
    el('div', { class: 'setting-row__label', style: { marginTop: '12px' }, text: 'One file per layer' }),
    el('div', { style: { display: 'flex', gap: '4px', marginTop: '6px' } }, [
      button({ class: 'chip chip--sm', style: { flex: '1 1 0' }, on: { click: () => void session.exportStems('wav', trim) } }, ['WAV stems']),
      button({ class: 'chip chip--sm', style: { flex: '1 1 0' }, on: { click: () => void session.exportStems('mp3', trim) } }, ['MP3 stems']),
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
      ...designSections,
      el('div', { class: 'section-title', style: { marginTop: '12px' }, text: 'Kit' }),
      el('div', { class: 'pick-row' }, kitButtons),
      el('div', { class: 'section-title', style: { marginTop: '12px' }, text: 'Pitched' }),
      el('div', { class: 'pick-row' }, pitchedButtons),
      el('div', { class: 'section-title', style: { marginTop: '12px' }, text: 'On layer' }),
      layerRow,
    ]),
    el('div', {}, [el('div', { class: 'section-title', text: 'Selected sound' }), cueBody]),
    el('div', {}, [el('div', { class: 'section-title', text: 'Export' }), exportBody]),
    el('div', {}, [el('div', { class: 'section-title', text: 'Session' }), sessionBody]),
    el('div', {}, [el('div', { class: 'section-title', text: 'Palette' }), paletteBody]),
  ]);

  let paintedLayers: AppState['project']['layers'] | null = null;

  return {
    el: root,

    update(state: AppState) {
      const { project, currentSource, selectedCueId } = state;

      designButtons.forEach((node, i) =>
        toggleClass(
          node,
          'is-on',
          currentSource.kind === 'design' && currentSource.name === designNames[i],
        ),
      );
      kitButtons.forEach((node, i) =>
        toggleClass(node, 'is-on', sameSource(currentSource, { kind: 'kit', name: KIT_PICKS[i].name })),
      );
      pitchedButtons.forEach((node, i) =>
        toggleClass(node, 'is-on', sameSource(currentSource, { kind: 'pitched', name: PITCHED[i].name })),
      );

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

      selected = project.cues.find((c) => c.id === selectedCueId) ?? null;
      const has = selected !== null;
      cueBody.style.opacity = has ? '1' : '0.5';
      cueBody.style.pointerEvents = has ? '' : 'none';

      if (selected) {
        const label =
          selected.source.kind === 'pitched'
            ? `${selected.source.name} ${noteName((selected.source.midi ?? DEFAULT_MIDI) + selected.tune)}`
            : String(selected.source.name);
        setText(cueTitle, label);
        setText(cueTime, `at ${timecode(selected.time, project.fps)}`);
        gain.input.value = String(selected.gain);
        setText(gain.out, selected.gain.toFixed(2));
        tune.input.value = String(selected.tune);
        setText(tune.out, `${selected.tune > 0 ? '+' : ''}${selected.tune}`);
        length.input.value = String(selected.length);
        setText(length.out, `${selected.length.toFixed(2)}s`);
        anchorButtons.forEach((a) => toggleClass(a.node, 'is-on', selected?.anchor === a.anchor));
        toggleClass(muteButton, 'is-on', selected.muted);
      } else {
        setText(cueTitle, 'Nothing selected');
        setText(cueTime, 'Click the timeline to place a sound.');
      }

      setText(exportStatus, state.exporting ?? '');
    },
  };
}
