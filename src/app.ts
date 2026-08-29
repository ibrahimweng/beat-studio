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
import {
  flushProject,
  heldProject,
  heldSamples,
  heldTakes,
  heldVideo,
  isKeeping,
  keepProject,
  keepTakes,
  startKeeping,
  stopKeeping,
  takeOverKeeping,
} from './keep.ts';
import { createHelp } from './ui/help.ts';
import { createKeepNotice } from './ui/keep-notice.ts';
import { createWorkPanel } from './ui/sound-design/work-panel.ts';
import { createVideoStage } from './ui/sound-design/stage.ts';
import { createVideoWindow } from './ui/video-window.ts';
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

  /*
   * With the timeline armed, whatever is played lands on it.
   *
   * Caught at the one place every note and hit passes through, so the drums,
   * the keys and the guitar are all covered, by keyboard and by mouse alike,
   * without four separate wires. Only from the instrument screens: on the
   * timeline a pad key already places its own sound, and capturing there as
   * well would put down two.
   */
  session.capture((source) => {
    const state = session.store.state;
    if (state.armed && state.mode === 'play') soundDesign.addCueAtPlayhead(source);
  });

  const tour = createTour();
  const help = createHelp({ onReplayTour: () => tour.start() });

  // Instrument half.
  const rail = createRail(session, { onHelp: () => help.toggle() });
  const topbar = createTopbar(session, {
    onToggleVideo: () => videoWindow.toggle(),
    hasVideo: () => soundDesign.store.state.videoReady,
  });
  const stage = createStage(session);
  const dock = createDock(session);
  const mixer = createMixer(session);
  const inspector = createInspector(session);

  // Sound design half.
  const soundDesignBar = createSoundDesignBar(soundDesign);
  const videoStage = createVideoStage(soundDesign);
  // The instruments screen borrows the same video element rather than making
  // a second one, so there is only ever one clip at one moment.
  const videoWindow = createVideoWindow({
    video: videoStage.video,
    home: () => videoStage.el,
    /*
     * What the × means depends on where it was pressed.
     *
     * On the sound design screen it is the same statement as turning the
     * Window toggle off, and it has to be, or the next render would open it
     * again. On the instruments there is no toggle and no stage: it means
     * the window itself is not wanted, until the Video chip asks for it.
     */
    onClose: () => {
      if (session.store.state.mode === 'sound-design') {
        session.store.set({ videoWindow: false });
      } else {
        videoWindow.forget();
      }
    },
  });
  const timeline = createTimeline(soundDesign);
  const soundDesignPanel = createWorkPanel(soundDesign);
  const divider = createDivider({
    container: () => main,
    timeline: () => timeline.el,
    onResize: () => timeline.relayout(),
  });

  soundDesign.attachVideo(videoStage.video);

  const main = el('div', { class: 'main' });
  const keepNotice = createKeepNotice({
    onTakeOver: () => takeOverKeeping(session.store.state.project),
  });

  const views: View[] = [
    rail, topbar, stage, dock, mixer, inspector,
    soundDesignBar, videoStage, timeline, soundDesignPanel, keepNotice,
  ];

  const shell = el('div', { class: 'app' }, [rail.el, main, videoWindow.el]);
  /*
   * The notice sits above the app rather than over it.
   *
   * Floated at the top it covered the timecode, the frame rate and the
   * snapping — controls somebody might well want while deciding which tab to
   * keep. A state that lasts until it is dealt with should take its own room
   * rather than borrow somebody else's.
   */
  root.appendChild(el('div', { class: 'frame' }, [keepNotice.el, shell]));

  /**
   * What is currently on screen: the mode, and whether the video is floating.
   *
   * Both, because the timeline screen has two layouts — one with the stage
   * above it and one without — and swapping between them is the same
   * re-mount as swapping screens.
   */
  let mounted = '';
  let aside: HTMLElement | null = null;

  /** Swap the whole middle column and the right panel when the layout changes. */
  const mount = (state: AppState): void => {
    const mode = state.mode;
    const floating = mode === 'play' || state.videoWindow;
    const key = `${mode}:${floating}`;
    if (mounted === key) return;
    const before = mounted;
    mounted = key;

    // Leaving the sound design screen stops its clock, the same way arriving
    // at it stops the instrument transport. The browser pauses a video that
    // has been taken out of the page, but the scheduler behind it would carry
    // on running and the transport would still read as playing.
    if (mode === 'play' && !before.startsWith('play')) soundDesign.pause();

    /*
     * The stage comes out when the video is floating.
     *
     * There is one video element and two places it can be. On the instrument
     * screens the floating window is the only one there is. On the timeline
     * it is a choice, and choosing the window means the stage above the lanes
     * is not just empty but gone, so the height it was using goes to the
     * timeline — which is the reason to want the window here at all.
     */
    main.replaceChildren(
      ...(mode === 'play'
        ? [topbar.el, stage.el, dock.el, mixer.el]
        : floating
          ? [soundDesignBar.el, timeline.el]
          : [soundDesignBar.el, videoStage.el, divider.el, timeline.el]),
    );
    if (mode === 'sound-design' && !floating) divider.refresh();

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

  /**
   * Put the video wherever it belongs for the screen and the setting.
   *
   * Run on every state change rather than only when the screens swap, so a
   * clip loaded while the instruments are already up brings the window with
   * it, and so the toggle on the timeline bar takes effect at once. The
   * mounting above has already happened, which matters: stowing the video
   * into a stage that is not on the page yet would put it nowhere.
   */
  const placeVideo = (state: AppState): void => {
    const onPlay = state.mode === 'play';
    const floating = onPlay ? videoWindow.wanted : state.videoWindow;
    // Opened from the timeline's own setting, which says nothing about
    // whether the instrument screens want the window when you get there.
    if (state.videoReady && floating) videoWindow.open(onPlay);
    else videoWindow.stow();
  };

  const render = (state: AppState, previous: AppState | null): void => {
    mount(state);
    placeVideo(state);
    for (const view of views) view.update(state, previous);
    /*
     * Keep the piece whenever it changes, so a reload picks it up again.
     *
     * Here rather than inside the session, because this is the one place
     * every change to the project arrives — an edit, an undo, a session file
     * opened, a clip loaded — and hooking each of those separately is how one
     * of them ends up not being kept.
     */
    if (previous && state.project !== previous.project) keepProject(state.project);
    // Takes are their own store: they belong to the instruments rather than to
    // the piece, and survive "New project" the way the patterns do.
    if (previous && state.takes !== previous.takes && isKeeping()) {
      void keepTakes(state.takes);
    }
  };

  /*
   * Carry on from wherever the last visit left off.
   *
   * Before anything subscribes, so the timeline is drawn once, with the work
   * already on it, rather than drawn empty and then filled in — and so the
   * piece just read back is not immediately written out again as if it were
   * an edit. The clip cannot come with it: it lives in a store that has to be
   * waited for, so it follows a moment later.
   */
  /*
   * Claim the keeping before reading anything back.
   *
   * A second tab on the same piece is the one way this app can lose work: both
   * write to one place, the last to save wins, and the other tab carries on
   * drawing sounds that are no longer stored anywhere. So one tab keeps, the
   * rest say so and offer to take over. See `keep.ts`.
   */
  session.store.set({ keeping: startKeeping((keeping) => session.store.set({ keeping })) });

  const kept = heldProject();
  if (kept) soundDesign.restoreProject(kept);

  const unsubscribe = session.store.subscribe((state, previous) => render(state, previous));
  render(session.state, null);

  // Takes come back with the rest. Their audio is decoded when one is first
  // played, since decoding needs an audio context and that needs a gesture.
  void heldTakes().then((takes) => {
    if (takes.length && !session.store.state.takes.length) session.store.set({ takes });
  });

  // Recordings likewise, and for the same reason: a piece using one draws it
  // at once from the length written down, and it gets its audio the first
  // time anything asks to hear it.
  void heldSamples().then((list) => {
    soundDesign.restoreSamples(list);
    /*
     * After what was kept, not before: the shelves are only filled for
     * somebody who has no recordings at all, and until this has come back
     * from the database nobody knows whether that is true.
     */
    void soundDesign.stockLibrary();
  });

  if (kept?.videoName) {
    void heldVideo().then(async (file) => {
      if (!file) {
        session.store.set({
          status: `${kept.videoName} was not kept — load it again to see the picture`,
        });
        return;
      }
      const back = await soundDesign.restoreVideo(file);
      session.store.set({
        status: back
          ? `carrying on with ${kept.cues.length} sound${kept.cues.length === 1 ? '' : 's'}`
          : `${file.name} would not load — load it again to see the picture`,
      });
    });
  } else if (kept) {
    session.store.set({
      status: `carrying on with ${kept.cues.length} sound${kept.cues.length === 1 ? '' : 's'}`,
    });
  }

  /*
   * Write anything still waiting before the page goes.
   *
   * `pagehide` rather than `beforeunload`, which phones do not reliably fire,
   * and `visibilitychange` as well because a tab that is switched away from
   * may never come back. Both are the exact moment the settling delay in
   * `keep.ts` would otherwise lose the last edit — and a reload is the case
   * this is all here for.
   */
  const onLeaving = (): void => {
    flushProject();
    // Handing the claim over on the way out means the tab left behind starts
    // keeping at once rather than after the claim goes stale.
    stopKeeping();
  };
  const onHidden = (): void => {
    if (document.visibilityState === 'hidden') flushProject();
  };
  window.addEventListener('pagehide', onLeaving);
  document.addEventListener('visibilitychange', onHidden);

  const detachKeyboard = attachKeyboard(session, soundDesign);
  const stopMeters = startMeterLoop(session, stage, mixer);

  return () => {
    detachKeyboard();
    stopMeters();
    unsubscribe();
    window.removeEventListener('pagehide', onLeaving);
    document.removeEventListener('visibilitychange', onHidden);
    // Anything the settling delay was still holding on to, and then let the
    // claim go so the next tab picks it up without waiting it out.
    flushProject();
    stopKeeping();
    tour.close();
    help.close();
    // The help listens on the document for the small "?" buttons, which
    // would outlive the app's own tree unless it is told to let go.
    help.destroy();
    soundDesign.stopShuttle();
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
