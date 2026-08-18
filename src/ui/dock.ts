import { BANK_KEYS, LANES, MAX_STEPS } from '../constants.ts';
import type { Session } from '../session.ts';
import type { AppState } from '../store.ts';
import type { LaneKey, Take } from '../types.ts';
import { button, clear, el, setText, toggleClass } from './dom.ts';
import type { View } from './view.ts';

export interface DockView extends View {
  flashLane(lane: LaneKey): void;
  flashTake(id: string, seconds: number): void;
  movePlayhead(step: number): void;
  hidePlayhead(): void;
}

/**
 * The bottom dock: a step sequencer and the list of recorded takes, sharing
 * one bar of controls.
 *
 * The grid is built once at the maximum step count and cells beyond the
 * current setting are hidden, so switching 16 to 32 steps and toggling steps
 * never rebuild the DOM — they only change classes.
 */
export function createDock(session: Session): DockView {
  // ---------- bar ----------
  const seqTab = button({ class: 'tab', on: { click: () => session.setDock('seq') } }, ['Sequencer']);
  const takesTab = button({ class: 'tab', on: { click: () => session.setDock('takes') } }, ['Takes']);

  const bankButtons = BANK_KEYS.map((key) =>
    button(
      { class: 'cell', on: { click: () => session.setBank(key) } },
      [el('span', { text: key })],
    ),
  );

  const status = el('div', {
    class: 'hint',
    style: {
      marginRight: '10px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      minWidth: '0',
    },
  });

  const bar = el('div', { class: 'dock__bar' }, [
    seqTab,
    takesTab,
    el('div', { class: 'dock__divider' }),
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [
      el('div', { class: 'micro-label', style: { marginRight: '4px' }, text: 'Pattern' }),
      ...bankButtons,
    ]),
    el('div', { class: 'dock__spacer' }),
    status,
    button({ class: 'chip chip--sm', on: { click: () => session.loadSeed() } }, ['Seed beat']),
    button(
      { class: 'chip chip--sm chip--danger', style: { marginLeft: '6px' }, on: { click: () => session.clearPattern() } },
      ['Clear'],
    ),
  ]);

  // ---------- sequencer ----------
  const rulerTicks = Array.from({ length: MAX_STEPS }, () => el('span'));
  const ruler = el('div', { class: 'seq__ruler' }, [
    el('div'),
    el('div', { class: 'seq__ticks' }, rulerTicks),
  ]);

  const playhead = el('div', { class: 'seq__playhead' });
  const laneLeds = new Map<LaneKey, HTMLElement>();
  const laneCells = new Map<LaneKey, HTMLElement[]>();

  const lanes = LANES.map((lane) => {
    const led = el('i', { class: 'led' });
    laneLeds.set(lane.key, led);

    const cells = Array.from({ length: MAX_STEPS }, (_, step) =>
      button({
        class: 'step',
        attrs: { 'aria-label': `${lane.label} step ${step + 1}` },
        on: { click: () => session.toggleStep(lane.key, step) },
      }),
    );
    laneCells.set(lane.key, cells);

    return el('div', { class: 'lane' }, [
      el('div', { class: 'lane__name' }, [led, el('div', { class: 'lane__label', text: lane.label })]),
      el('div', { class: 'lane__cells' }, cells),
    ]);
  });

  const sequencer = el('div', { class: 'dock__body' }, [
    ruler,
    el('div', { class: 'seq__grid' }, [playhead, el('div', { class: 'seq__lanes' }, lanes)]),
  ]);

  // ---------- takes ----------
  const takesBody = el('div', { class: 'dock__body takes' });
  const takeLeds = new Map<string, HTMLElement>();

  const root = el('section', { class: 'dock' }, [bar, sequencer]);
  let mountedPanel: HTMLElement = sequencer;

  let paintedSteps = -1;

  return {
    el: root,

    update(state: AppState, previous: AppState | null) {
      toggleClass(seqTab, 'is-on', state.dock === 'seq');
      toggleClass(takesTab, 'is-on', state.dock === 'takes');
      bankButtons.forEach((node, i) => toggleClass(node, 'is-on', state.bank === BANK_KEYS[i]));
      setText(status, state.status ?? `pattern ${state.bank} · ${state.steps} steps`);

      if (state.steps !== paintedSteps) {
        paintedSteps = state.steps;
        rulerTicks.forEach((tick, i) => {
          tick.style.display = i < state.steps ? '' : 'none';
          setText(tick, i % 4 === 0 ? String(Math.floor(i / 4) + 1) : '·');
        });
        for (const cells of laneCells.values()) {
          cells.forEach((cell, i) => {
            cell.style.display = i < state.steps ? '' : 'none';
            toggleClass(cell, 'is-beat', i % 4 === 0);
          });
        }
      }

      const pattern = state.banks[state.bank];
      const previousPattern = previous ? previous.banks[previous.bank] : null;
      if (pattern !== previousPattern) {
        for (const lane of LANES) {
          const cells = laneCells.get(lane.key);
          const steps = pattern[lane.key];
          if (!cells || !steps) continue;
          for (let i = 0; i < MAX_STEPS; i++) toggleClass(cells[i], 'is-on', steps[i]);
        }
      }

      if (!previous || state.takes !== previous.takes) {
        renderTakes(takesBody, takeLeds, state.takes, session);
      }

      const panel = state.dock === 'seq' ? sequencer : takesBody;
      if (panel !== mountedPanel) {
        root.replaceChild(panel, mountedPanel);
        mountedPanel = panel;
      }
    },

    flashLane(lane: LaneKey) {
      const led = laneLeds.get(lane);
      if (!led) return;
      led.style.background = 'var(--ac)';
      window.setTimeout(() => {
        led.style.background = '';
      }, 130);
    },

    flashTake(id: string, seconds: number) {
      const led = takeLeds.get(id);
      if (!led) return;
      led.style.background = 'var(--ac)';
      window.setTimeout(() => {
        led.style.background = '';
      }, seconds * 1000);
    },

    movePlayhead(step: number) {
      const steps = paintedSteps > 0 ? paintedSteps : 16;
      const span = 'calc(100% - var(--lane-offset))';
      playhead.style.opacity = '1';
      playhead.style.width = `calc(${span} / ${steps})`;
      playhead.style.left = `calc(var(--lane-offset) + ${span} * ${step / steps})`;
    },

    hidePlayhead() {
      playhead.style.opacity = '0';
    },
  };
}

/** Rebuild the takes list. Takes change rarely, so a full redraw is fine. */
function renderTakes(
  container: HTMLElement,
  leds: Map<string, HTMLElement>,
  takes: readonly Take[],
  session: Session,
): void {
  clear(container);
  leds.clear();

  if (!takes.length) {
    container.appendChild(
      el('div', { class: 'takes__empty' }, [
        el('div', { class: 'takes__empty-title', text: 'No takes yet' }),
        el('div', {
          class: 'takes__empty-hint',
          text: 'hit record, play over the loop, hit record again to land a take',
        }),
      ]),
    );
    return;
  }

  for (const take of takes) {
    const led = el('i', { class: 'led led--md' });
    leds.set(take.id, led);

    const layerButton = button(
      { class: 'take-btn', on: { click: () => session.toggleLayer(take.id) } },
      [el('span', { text: 'Layer' })],
    );
    toggleClass(layerButton, 'is-on', take.layered);

    container.appendChild(
      el('div', { class: 'take' }, [
        el('div', { class: 'take__id' }, [
          led,
          el('div', { style: { minWidth: '0' } }, [
            el('div', { class: 'take__name', text: take.name }),
            el('div', { class: 'take__meta', text: take.meta }),
          ]),
        ]),
        el(
          'div',
          { class: 'take__wave' },
          take.bars.map((height) => el('i', { style: { height: `${height}%` } })),
        ),
        el('div', { class: 'take__actions' }, [
          button({ class: 'take-btn', on: { click: () => session.playTake(take.id) } }, [
            el('span', { text: 'Play' }),
          ]),
          layerButton,
          button(
            { class: 'take-btn take-btn--sm', on: { click: () => void session.exportTake('wav', take.id) } },
            [el('span', { text: 'WAV' })],
          ),
          button(
            { class: 'take-btn take-btn--sm', on: { click: () => void session.exportTake('mp3', take.id) } },
            [el('span', { text: 'MP3' })],
          ),
          button(
            { class: 'take-btn take-btn--sm', on: { click: () => void session.exportTake('midi', take.id) } },
            [el('span', { text: 'MID' })],
          ),
          button(
            {
              class: 'take-btn take-btn--close',
              title: `Delete ${take.name}`,
              on: { click: () => session.deleteTake(take.id) },
            },
            [el('span', { text: '×' })],
          ),
        ]),
      ]),
    );
  }
}
