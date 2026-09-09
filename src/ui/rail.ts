import type { Session } from '../session.ts';
import type { AppState, Tool } from '../store.ts';
import { TOOLS } from '../store.ts';
import { button, el, toggleClass } from './dom.ts';
import { speakMark, splitMark, toolIcon, waveMark } from './icons.ts';
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
 *
 * There are two places to go again, at the top, and it is worth saying why that
 * is not the old rail coming back. The old one offered six, five of which were a
 * drum machine running on bars and tempo — a different app wearing the same
 * chrome, and the reason the whole thing went. These two are two views of one
 * piece of work: a recording is taken apart on one and its parts are put to
 * picture on the other, and the parts arrive on the timeline the moment you
 * press Place. A switch between two halves of one job is worth thirty two pixels
 * in a way that a switch between two apps never was.
 */
export interface RailOptions {
  onHelp: () => void;
}

/** The two screens, in the order the work happens. */
const SCREENS = [
  {
    id: 'separate' as const,
    name: 'Take apart',
    job: 'Read a recording and divide it into its parts',
  },
  {
    id: 'design' as const,
    name: 'Sound design',
    job: 'Put sound to picture on the timeline',
  },
  {
    id: 'voiceover' as const,
    name: 'Voiceover',
    job: 'Put a voice to a script, and place it on the piece',
  },
];

export function createRail(session: Session, options: RailOptions = { onHelp: () => {} }): View {
  const engineLed = el('i', { class: 'led led--lg' });

  const screens = SCREENS.map((screen) => ({
    id: screen.id,
    node: button(
      {
        class: 'rail__screen',
        title: `${screen.name} — ${screen.job}`,
        attrs: { 'aria-label': screen.name, 'aria-pressed': 'false' },
        dataset: { screen: screen.id },
        on: { click: () => session.setScreen(screen.id) },
      },
      [
        screen.id === 'separate'
          ? splitMark()
          : screen.id === 'voiceover'
            ? speakMark()
            : waveMark([5, 11, 8, 3], 2, 2, 2),
      ],
    ),
  }));

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
    el('div', { class: 'rail__screens' }, screens.map((screen) => screen.node)),
    el('div', { class: 'rule' }),
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
      for (const screen of screens) {
        const on = state.screen === screen.id;
        toggleClass(screen.node, 'is-on', on);
        screen.node.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      /*
       * The tools belong to the timeline, so they are out of reach without one.
       *
       * Not hidden: a strip that changes length when you change screen makes the
       * whole window shift, and a tool that has quietly gone is worse to come
       * back to than one that is plainly not available yet.
       */
      const design = state.screen === 'design';
      for (const tool of tools) {
        const on = state.tool === tool.id;
        tool.node.disabled = !design;
        toggleClass(tool.node, 'is-on', on);
        tool.node.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    },
  };
}
