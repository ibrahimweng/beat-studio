import type { AudioEngineOptions } from './audio/engine.ts';
import { KEY_ROWS, PAD_KEYS } from './constants.ts';
import { ScoreSession } from './score-session.ts';
import { Session } from './session.ts';
import type { AppState } from './store.ts';
import { createDock } from './ui/dock.ts';
import { el } from './ui/dom.ts';
import { createInspector } from './ui/inspector.ts';
import { createMixer } from './ui/mixer.ts';
import { createRail } from './ui/rail.ts';
import { createScoreBar } from './ui/score/bar.ts';
import { createDivider } from './ui/score/divider.ts';
import { createHelp } from './ui/score/help.ts';
import { createTour } from './ui/score/tour.ts';
import { createScorePanel } from './ui/score/panel.ts';
import { createVideoStage } from './ui/score/stage.ts';
import { createTimeline } from './ui/score/timeline.ts';
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
  const score = new ScoreSession(session.engine, session.store);

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
  const scoreBar = createScoreBar(score);
  const videoStage = createVideoStage(score);
  const timeline = createTimeline(score);
  const scorePanel = createScorePanel(score);
  const divider = createDivider({
    container: () => main,
    timeline: () => timeline.el,
    onResize: () => timeline.relayout(),
  });

  score.attachVideo(videoStage.video);

  const views: View[] = [
    rail, topbar, stage, dock, mixer, inspector,
    scoreBar, videoStage, timeline, scorePanel,
  ];

  const main = el('div', { class: 'main' });
  const shell = el('div', { class: 'app' }, [rail.el, main]);
  root.appendChild(shell);

  let mounted: 'play' | 'score' | null = null;
  let aside: HTMLElement | null = null;

  /** Swap the whole middle column and the right panel when the mode changes. */
  const mount = (mode: 'play' | 'score'): void => {
    if (mounted === mode) return;
    mounted = mode;

    main.replaceChildren(
      ...(mode === 'play'
        ? [topbar.el, stage.el, dock.el, mixer.el]
        : [scoreBar.el, videoStage.el, divider.el, timeline.el]),
    );
    if (mode === 'score') divider.refresh();

    const next = mode === 'play' ? inspector.el : scorePanel.el;
    if (aside) shell.replaceChild(next, aside);
    else shell.appendChild(next);
    aside = next;

    // The walkthrough points at parts of the sound design screen, so it waits
    // until that screen is actually on show.
    if (mode === 'score') requestAnimationFrame(() => tour.maybeStart());
  };

  score.effects = {
    onTime: (time) => {
      timeline.setTime(time);
      scoreBar.setTime(time);
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

  const detachKeyboard = attachKeyboard(session, score);
  const stopMeters = startMeterLoop(session, stage, mixer);

  return () => {
    detachKeyboard();
    stopMeters();
    unsubscribe();
    tour.close();
    help.close();
    score.dispose();
    session.dispose();
  };
}

/** Keyboard control, which differs between the two halves of the app. */
function attachKeyboard(session: Session, score: ScoreSession): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (ignore(event)) return;
    if (session.state.mode === 'score') scoreKey(session, score, event);
    else handleKey(session, event, true);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (ignore(event)) return;
    if (session.state.mode !== 'score') handleKey(session, event, false);
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}

function ignore(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (target && /input|textarea|select/i.test(target.tagName)) return true;
  // Leave browser and system shortcuts alone.
  return event.metaKey || event.ctrlKey || event.altKey;
}

/**
 * Sound design keys.
 *
 * Arrows move the playhead a frame at a time, which is most of the work.
 * Holding shift moves the selected sound instead, so a hit that feels late
 * can be pulled back without losing your place.
 */
function scoreKey(session: Session, score: ScoreSession, event: KeyboardEvent): void {
  const key = event.key;
  const selected = session.state.selectedCueId;

  if (key === ' ') {
    event.preventDefault();
    score.togglePlay();
    return;
  }

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    event.preventDefault();
    const direction = key === 'ArrowLeft' ? -1 : 1;
    if (event.shiftKey && selected) score.nudgeCue(selected, direction);
    else score.stepFrames(direction);
    return;
  }

  if ((key === 'Delete' || key === 'Backspace') && selected) {
    event.preventDefault();
    score.removeCue(selected);
    return;
  }

  if (key === 'Escape') {
    score.select(null);
    return;
  }

  // Tapping a pad key drops that sound at the playhead, so a pass can be
  // played in by hand and tidied up afterwards.
  const pad = PAD_KEYS[key.toLowerCase()];
  if (pad && !event.repeat) {
    event.preventDefault();
    score.addCueAtPlayhead({ kind: 'kit', name: pad });
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
