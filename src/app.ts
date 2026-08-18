import type { AudioEngineOptions } from './audio/engine.ts';
import { KEY_ROWS, PAD_KEYS } from './constants.ts';
import { Session } from './session.ts';
import type { AppState } from './store.ts';
import { createDock } from './ui/dock.ts';
import { el } from './ui/dom.ts';
import { createInspector } from './ui/inspector.ts';
import { createMixer } from './ui/mixer.ts';
import { createRail } from './ui/rail.ts';
import { createStage } from './ui/stage.ts';
import { createTopbar } from './ui/topbar.ts';
import type { View } from './ui/view.ts';

/**
 * Build the instrument and attach it to `root`.
 *
 * Views are created once and updated from the store; nothing here re-creates
 * DOM in response to state. Returns a teardown function.
 */
export function mountApp(root: HTMLElement, options: AudioEngineOptions = {}): () => void {
  const session = new Session(options);

  const rail = createRail(session);
  const topbar = createTopbar(session);
  const stage = createStage(session);
  const dock = createDock(session);
  const mixer = createMixer(session);
  const inspector = createInspector(session);

  const views: View[] = [rail, topbar, stage, dock, mixer, inspector];

  root.appendChild(
    el('div', { class: 'app' }, [
      rail.el,
      el('div', { class: 'main' }, [topbar.el, stage.el, dock.el, mixer.el]),
      inspector.el,
    ]),
  );

  // Visual feedback the session asks for while playing or sequencing.
  session.effects = {
    flashPad: (pad) => stage.flashPad(pad),
    flashKey: (midi) => stage.flashKey(midi),
    flashLane: (lane) => dock.flashLane(lane),
    flashTake: (id, seconds) => dock.flashTake(id, seconds),
    movePlayhead: (step) => dock.movePlayhead(step),
    hidePlayhead: () => dock.hidePlayhead(),
  };

  const render = (state: AppState, previous: AppState | null): void => {
    for (const view of views) view.update(state, previous);
  };

  const unsubscribe = session.store.subscribe((state, previous) => render(state, previous));
  render(session.state, null);

  const detachKeyboard = attachKeyboard(session);
  const stopMeters = startMeterLoop(session, stage, mixer);

  return () => {
    detachKeyboard();
    stopMeters();
    unsubscribe();
    session.dispose();
  };
}

/**
 * Computer-keyboard control: space for transport, R to record, the pad row for
 * drums, and two chromatic rows for pitched instruments.
 */
function attachKeyboard(session: Session): () => void {
  const onKeyDown = (event: KeyboardEvent): void => handleKey(session, event, true);
  const onKeyUp = (event: KeyboardEvent): void => handleKey(session, event, false);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}

function handleKey(session: Session, event: KeyboardEvent, down: boolean): void {
  const target = event.target as HTMLElement | null;
  if (target && /input|textarea|select/i.test(target.tagName)) return;
  // Leave browser and OS shortcuts alone.
  if (event.metaKey || event.ctrlKey || event.altKey) return;

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
