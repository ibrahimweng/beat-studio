import type { AudioEngineOptions } from './audio/engine.ts';
import { PAD_KEYS } from './constants.ts';
import { Session } from './session.ts';
import { SoundDesignSession } from './sound-design-session.ts';
import type { AppState } from './store.ts';
import { el } from './ui/dom.ts';
import { createRail } from './ui/rail.ts';
import { createSoundDesignBar } from './ui/sound-design/bar.ts';
import { createDivider } from './ui/sound-design/divider.ts';
import {
  flushProject,
  heldProject,
  heldSamples,
  heldVideo,
  keepProject,
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
import type { View } from './ui/view.ts';

/**
 * Build the app and attach it to `root`.
 *
 * One screen: a video, a timeline under it, and a panel down the side saying
 * what belongs where. There used to be a second half, three instrument
 * screens running on bars and tempo, and it was half the interface for a job
 * nobody opened this app to do. What those instruments make is still here, in
 * the library, filed under the moment it serves. Returns a teardown function.
 */
export function mountApp(root: HTMLElement, options: AudioEngineOptions = {}): () => void {
  const session = new Session(options);
  const soundDesign = new SoundDesignSession(session.engine, session.store);

  const tour = createTour({
    onShow: (tab, reveal) => {
      soundDesign.setPanelTab(tab);
      if (reveal) soundDesignPanel.openGroup(reveal);
    },
  });
  const help = createHelp({ onReplayTour: () => tour.start() });

  const rail = createRail(session, { onHelp: () => help.toggle() });
  const soundDesignBar = createSoundDesignBar(soundDesign);
  const videoStage = createVideoStage(soundDesign);
  // The instruments screen borrows the same video element rather than making
  // a second one, so there is only ever one clip at one moment.
  const videoWindow = createVideoWindow({
    video: videoStage.video,
    home: () => videoStage.el,
    // The same statement as turning the Window toggle off, and it has to be,
    // or the next render would open it again.
    onClose: () => session.store.set({ videoWindow: false }),
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
    rail, soundDesignBar, videoStage, timeline, soundDesignPanel, keepNotice,
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
   * Whether the video is floating, which is the one thing that changes the
   * layout: with the clip in a window the stage above the lanes is not just
   * empty but gone, and the height it was using goes to the timeline. That is
   * the reason to want the window at all.
   */
  let mounted = '';

  /** Swap the middle column when the video moves into or out of its window. */
  const mount = (state: AppState): void => {
    const floating = state.videoWindow;
    const key = String(floating);
    if (mounted === key) return;
    const first = mounted === '';
    mounted = key;

    // There is one video element and two places it can be. In the window, the
    // stage above the lanes is gone rather than empty, and the height it was
    // using goes to the timeline.
    main.replaceChildren(
      ...(floating
        ? [soundDesignBar.el, timeline.el]
        : [soundDesignBar.el, videoStage.el, divider.el, timeline.el]),
    );
    if (!floating) divider.refresh();

    if (first) {
      shell.appendChild(soundDesignPanel.el);
      // The walkthrough points at parts of the screen, so it waits until
      // there is a screen to point at.
      requestAnimationFrame(() => tour.maybeStart());
    }
  };

  soundDesign.effects = {
    onTime: (time) => {
      timeline.setTime(time);
      soundDesignBar.setTime(time);
    },
    flashCue: (id) => timeline.flashCue(id),
  };

  /**
   * Put the video wherever the setting says.
   *
   * Run on every state change rather than only when the layout swaps, so the
   * toggle on the timeline bar takes effect at once. The mounting above has
   * already happened, which matters: stowing the video into a stage that is
   * not on the page yet would put it nowhere.
   */
  const placeVideo = (state: AppState): void => {
    if (state.videoReady && state.videoWindow) videoWindow.open();
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

  return () => {
    detachKeyboard();
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

/** Keyboard control. */
function attachKeyboard(session: Session, soundDesign: SoundDesignSession): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    // Somewhere text is being typed. Nothing here applies.
    if (inField(event)) return;

    // Editing shortcuts first, because they are the ones meant to carry a
    // modifier and would otherwise be turned away with the browser's own.
    if (editKey(soundDesign, event)) return;

    // A control that uses this key itself keeps it.
    if (controlKeeps(event)) return;
    if (ignore(event)) return;

    soundDesignKey(session, soundDesign, event);
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
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

