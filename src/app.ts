import type { AudioEngineOptions } from './audio/engine.ts';
import { KEY_ROWS, PAD_KEYS } from './constants.ts';
import { Session } from './session.ts';
import { SoundDesignSession } from './sound-design-session.ts';
import type { AppState } from './store.ts';
import { createDock } from './ui/dock.ts';
import { el } from './ui/dom.ts';
import { createInspector } from './ui/inspector.ts';
import { createMixer } from './ui/mixer.ts';
import { createRail } from './ui/rail.ts';
import { createSoundDesignBar } from './ui/sound-design/bar.ts';
import { createDivider } from './ui/sound-design/divider.ts';
import { createHelp } from './ui/sound-design/help.ts';
import { createSoundDesignPanel } from './ui/sound-design/panel.ts';
import { createVideoStage } from './ui/sound-design/stage.ts';
import { createTimeline } from './ui/sound-design/timeline.ts';
import { createTour } from './ui/sound-design/tour.ts';
import { createStage } from './ui/stage.ts';
import { createTopbar } from './ui/topbar.ts';
import type { View } from './ui/view.ts';

/**
 * Build the app and attach it to `root`.
 *
 * There are two halves. The instrument half is for working out sounds, and
 * the sound design half is for placing them against a video. They share one
 * audio engine and nothing else. Returns a teardown function.
 */
export function mountApp(root: HTMLElement, options: AudioEngineOptions = {}): () => void {
  const session = new Session(options);
  const soundDesign = new SoundDesignSession(session.engine, session.store);

  const tour = createTour();
  const help = createHelp({ onReplayTour: () => tour.start() });

  // Instrument half.
  const rail = createRail(session, { onHelp: () => help.toggle() });
  const topbar = createTopbar(session);
  const stage = createStage(session);
  const dock = createDock(session);
  const mixer = createMixer(session);
  const inspector = createInspector(session);

  // Sound design half.
  const soundDesignBar = createSoundDesignBar(soundDesign);
  const videoStage = createVideoStage(soundDesign);
  const timeline = createTimeline(soundDesign);
  const soundDesignPanel = createSoundDesignPanel(soundDesign);
  const divider = createDivider({
    container: () => main,
    timeline: () => timeline.el,
    onResize: () => timeline.relayout(),
  });

  soundDesign.attachVideo(videoStage.video);

  const views: View[] = [
    rail, topbar, stage, dock, mixer, inspector,
    soundDesignBar, videoStage, timeline, soundDesignPanel,
  ];

  const main = el('div', { class: 'main' });
  const shell = el('div', { class: 'app' }, [rail.el, main]);
  root.appendChild(shell);

  let mounted: 'play' | 'sound-design' | null = null;
  let aside: HTMLElement | null = null;

  /** Swap the whole middle column and the right panel when the mode changes. */
  const mount = (mode: 'play' | 'sound-design'): void => {
    if (mounted === mode) return;
    mounted = mode;

    // Leaving the sound design screen stops its clock, the same way arriving
    // at it stops the instrument transport. The browser pauses a video that
    // has been taken out of the page, but the scheduler behind it would carry
    // on running and the transport would still read as playing.
    if (mode === 'play') soundDesign.pause();

    main.replaceChildren(
      ...(mode === 'play'
        ? [topbar.el, stage.el, dock.el, mixer.el]
        : [soundDesignBar.el, videoStage.el, divider.el, timeline.el]),
    );
    if (mode === 'sound-design') divider.refresh();

    const next = mode === 'play' ? inspector.el : soundDesignPanel.el;
    if (aside) shell.replaceChild(next, aside);
    else shell.appendChild(next);
    aside = next;

    // The walkthrough points at parts of the sound design screen, so it waits
    // until that screen is actually on show.
    if (mode === 'sound-design') requestAnimationFrame(() => tour.maybeStart());
  };

  soundDesign.effects = {
    onTime: (time) => {
      timeline.setTime(time);
      soundDesignBar.setTime(time);
    },
    flashCue: (id) => timeline.flashCue(id),
  };

  session.effects = {
    flashPad: (pad) => stage.flashPad(pad),
    flashKey: (midi) => stage.flashKey(midi),
    flashLane: (lane) => dock.flashLane(lane),
    flashTake: (id, seconds) => dock.flashTake(id, seconds),
    movePlayhead: (step) => dock.movePlayhead(step),
    hidePlayhead: () => dock.hidePlayhead(),
  };

  const render = (state: AppState, previous: AppState | null): void => {
    mount(state.mode);
    for (const view of views) view.update(state, previous);
  };

  const unsubscribe = session.store.subscribe((state, previous) => render(state, previous));
  render(session.state, null);

  const detachKeyboard = attachKeyboard(session, soundDesign);
  const stopMeters = startMeterLoop(session, stage, mixer);

  return () => {
    detachKeyboard();
    stopMeters();
    unsubscribe();
    tour.close();
    help.close();
    soundDesign.dispose();
    session.dispose();
  };
}

/** Keyboard control, which differs between the two halves of the app. */
function attachKeyboard(session: Session, soundDesign: SoundDesignSession): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    // Somewhere text is being typed. Nothing here applies.
    if (inField(event)) return;

    // Editing shortcuts next, because they are the ones meant to carry a
    // modifier and would otherwise be turned away with the browser's own.
    if (session.state.mode === 'sound-design' && editKey(soundDesign, event)) return;

    // A control that uses this key itself keeps it.
    if (controlKeeps(event)) return;
    if (ignore(event)) return;

    if (session.state.mode === 'sound-design') soundDesignKey(session, soundDesign, event);
    else handleKey(session, event, true);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (inField(event) || controlKeeps(event) || ignore(event)) return;
    if (session.state.mode !== 'sound-design') handleKey(session, event, false);
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}

/**
 * Whether something is being typed into.
 *
 * Only places that take text. A slider is focused after it is dragged, and
 * leaving the whole keyboard turned off afterwards would mean that moving a
 * level and then pressing delete did nothing at all, which is not what
 * anyone expects from having touched a fader.
 */
function inField(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'textarea') return true;
  if (tag !== 'input') return target.isContentEditable;
  const type = (target as HTMLInputElement).type;
  return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color'].includes(type);
}

/**
 * Whether the focused control uses this key for itself.
 *
 * A slider moves on the arrows and a menu opens on them, so those keys are
 * left where they are. Everything else still reaches the timeline.
 */
function controlKeeps(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'select') return true;
  if (tag !== 'input') return false;

  const type = (target as HTMLInputElement).type;
  if (type === 'range') {
    return event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End';
  }
  if (type === 'checkbox' || type === 'radio') return event.key === ' ';
  return false;
}

/** Leave browser and system shortcuts alone. */
function ignore(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

/**
 * The shortcuts that carry a modifier, which are the ones any editor has.
 *
 * Returns whether it did something, so the caller knows to stop. Both
 * spellings of redo are taken, since which one is expected depends on where
 * someone learned to use a computer.
 */
function editKey(soundDesign: SoundDesignSession, event: KeyboardEvent): boolean {
  if (!event.metaKey && !event.ctrlKey) return false;

  const done = (run: () => void): boolean => {
    event.preventDefault();
    run();
    return true;
  };

  switch (event.key.toLowerCase()) {
    case 'z':
      return done(() => (event.shiftKey ? soundDesign.redo() : soundDesign.undo()));
    case 'y':
      return done(() => soundDesign.redo());
    case 'a':
      return done(() => soundDesign.selectAll());
    case 'c':
      return done(() => soundDesign.copySelection());
    case 'x':
      return done(() => soundDesign.cutSelection());
    case 'v':
      return done(() => soundDesign.paste());
    case 'd':
      return done(() => soundDesign.duplicateSelection());
    default:
      return false;
  }
}

/**
 * Sound design keys.
 *
 * Arrows move the playhead a frame at a time, which is most of the work.
 * Holding shift moves the selected sound instead, so a hit that feels late
 * can be pulled back without losing your place.
 */
function soundDesignKey(session: Session, soundDesign: SoundDesignSession, event: KeyboardEvent): void {
  const key = event.key;
  const chosen = session.state.selection.length;

  if (key === ' ') {
    event.preventDefault();
    soundDesign.togglePlay();
    return;
  }

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    event.preventDefault();
    const direction = key === 'ArrowLeft' ? -1 : 1;
    if (event.shiftKey && chosen) soundDesign.nudgeSelection(direction);
    else soundDesign.stepFrames(direction);
    return;
  }

  if ((key === 'Delete' || key === 'Backspace') && chosen) {
    event.preventDefault();
    soundDesign.removeSelected();
    return;
  }

  if (key === 'Escape') {
    soundDesign.select([]);
    return;
  }

  // Tapping a pad key drops that sound at the playhead, so a pass can be
  // played in by hand and tidied up afterwards.
  const pad = PAD_KEYS[key.toLowerCase()];
  if (pad && !event.repeat) {
    event.preventDefault();
    soundDesign.addCueAtPlayhead({ kind: 'kit', name: pad });
  }
}

function handleKey(session: Session, event: KeyboardEvent, down: boolean): void {
  const key = event.key.toLowerCase();
  const { view, octave } = session.state;

  if (down && key === ' ') {
    event.preventDefault();
    session.togglePlay();
    return;
  }

  // R is a piano key in the upper row, so it only records outside the keys view.
  if (down && key === 'r' && view !== 'keys') {
    event.preventDefault();
    session.toggleRecord();
    return;
  }

  if (view === 'drums') {
    const pad = PAD_KEYS[key];
    if (pad && down && !event.repeat) session.hitPad(pad);
    return;
  }

  const base = (octave + 1) * 12;
  for (const row of KEY_ROWS) {
    const index = row.row.indexOf(key);
    if (index < 0) continue;
    const midi = base + row.oct * 12 + row.semis[index];
    if (down) {
      if (event.repeat) return;
      session.playNote(midi, view === 'guitar' ? 'guitar' : 'piano');
    } else {
      session.releaseNote(midi);
    }
    return;
  }
}

/**
 * Drive the output meters and the recording clock from the display refresh.
 *
 * These read the engine directly rather than going through the store: they
 * change every frame, and pushing that through state would mean re-running
 * every view sixty times a second for two numbers.
 */
function startMeterLoop(
  session: Session,
  stage: ReturnType<typeof createStage>,
  mixer: ReturnType<typeof createMixer>,
): () => void {
  let frame = 0;

  const tick = (): void => {
    mixer.setLevel(session.engine.peak());
    const sampleRate = session.engine.context?.sampleRate ?? 48000;
    stage.tickRecording(session.recorder.recording, session.recorder.elapsed, sampleRate);
    frame = requestAnimationFrame(tick);
  };

  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
