import type { Session } from '../session.ts';
import type { AppState, Tool } from '../store.ts';
import { TOOLS } from '../store.ts';
import { button, el, toggleClass } from './dom.ts';
import { toolIcon } from './icons.ts';
import { helpButton } from './help.ts';
import type { View } from './view.ts';

/**
 * The left strip: which tool the pointer is holding, help, and the engine.
 *
 * It used to offer six places to go, five of which were a drum machine
 * running on bars and tempo, and then for a while it offered one place to go
 * on a screen that had only one place. Sixty four pixels of column for a
 * button that went where you already were.
 *
 * An editor puts its tools there, so that is what is there. Five of them,
 * taken from Audition's set and cut down to the ones that mean anything
 * against a row of sounds rather than a spectrogram: move, range, cut, hand,
 * zoom. Move is what the timeline always did, so nothing anybody already
 * knows has changed; the other four were things you could not do at all.
 */
export interface RailOptions {
  onHelp: () => void;
}

export function createRail(session: Session, options: RailOptions = { onHelp: () => {} }): View {
  const engineLed = el('i', { class: 'led led--lg' });

  const tools = TOOLS.map((tool) => ({
    id: tool.id as Tool,
    node: button(
      {
        class: 'rail__tool',
        // The letter is in the tooltip because that is how somebody moves
        // from clicking these to never looking at them again.
        title: `${tool.name} (${tool.key}) — ${tool.job}`,
        attrs: { 'aria-label': `${tool.name} tool`, 'aria-pressed': 'false' },
        dataset: { tool: tool.id },
        on: { click: () => session.setTool(tool.id as Tool) },
      },
      [toolIcon(tool.id), el('span', { class: 'rail__key', text: tool.key })],
    ),
  }));

  const help = button(
    {
      class: 'rail__btn rail__help',
      title: 'How this works',
      attrs: { 'aria-label': 'Help' },
      on: { click: () => options.onHelp() },
    },
    ['?'],
  );

  const power = button(
    {
      class: 'rail__power',
      title: 'Audio engine',
      attrs: { 'aria-label': 'Start audio engine' },
      on: { click: () => session.powerUp() },
    },
    [engineLed],
  );

  const root = el('nav', { class: 'rail', attrs: { 'aria-label': 'Tools' } }, [
    el('div', { class: 'rail__tools' }, tools.map((tool) => tool.node)),
    el('div', { class: 'rail__toolhelp' }, [helpButton('tools', 'the tools')]),
    el('div', { class: 'rail__spacer' }),
    help,
    power,
  ]);

  return {
    el: root,
    update(state: AppState) {
      engineLed.style.background = state.ready ? 'var(--ac)' : 'var(--led-dead)';
      for (const tool of tools) {
        const on = state.tool === tool.id;
        toggleClass(tool.node, 'is-on', on);
        tool.node.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    },
  };
}
