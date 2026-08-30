import type { AudioEngineOptions } from './audio/engine.ts';
import { PAD_KEYS } from './constants.ts';
import { TOOLS } from './store.ts';
import { Session } from './session.ts';
import { SoundDesignSession } from './sound-design-session.ts';
import type { AppState } from './store.ts';
import { el } from './ui/dom.ts';
import { createRail } from './ui/rail.ts';
import { createSoundDesignBar } from './ui/sound-design/bar.ts';
import { createTransport } from './ui/sound-design/transport.ts';
import { createDivider, createPanelDivider } from './ui/sound-design/divider.ts';
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
  const soundDesignBar = createSoundDesignBar(soundDesign, {
    onExport: () => soundDesignPanel.showExport(),
    panels: () =>
      soundDesignPanel
        .places()
        .map(({ panel, side }) => ({ id: panel.id, title: panel.title, open: side !== null })),
    onTogglePanel: (id) => soundDesignPanel.toggle(id),
    onResetLayout: () => soundDesignPanel.resetLayout(),
  });
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
  const transport = createTransport(soundDesign);
  const timeline = createTimeline(soundDesign, { transport: transport.el });
  const soundDesignPanel = createWorkPanel(soundDesign, {
    // A column appearing or emptying changes how much width the lanes have.
    onLayout: () => {
      timeline.relayout();
      leftDivider.refresh();
      panelDivider.refresh();
    },
  });
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
    rail, soundDesignBar, transport, videoStage, timeline, soundDesignPanel, keepNotice,
  ];

  const panelDivider = createPanelDivider({
    container: () => shell,
    panel: () => soundDesignPanel.docks.right,
    onResize: () => timeline.relayout(),
  });
  const leftDivider = createPanelDivider({
    container: () => shell,
    panel: () => soundDesignPanel.docks.left,
    onResize: () => timeline.relayout(),
    side: 'left',
  });

  /*
   * The columns go either side of the work, with the work between them.
   *
   * The left one is empty to begin with and takes no width until something is
   * dragged into it, so this reads as one column until somebody asks for two.
   */
  const shell = el('div', { class: 'app' }, [
    rail.el,
    soundDesignPanel.docks.left,
    leftDivider.el,
    main,
    videoWindow.el,
  ]);
  /*
   * The notice sits above the app rather than over it.
   *
   * Floated at the top it covered the timecode, the frame rate and the
   * snapping — controls somebody might well want while deciding which tab to
   * keep. A state that lasts until it is dealt with should take its own room
   * rather than borrow somebody else's.
   */
  root.appendChild(el('div', { class: 'frame' }, [keepNotice.el, shell]));

  /*
   * The tool the pointer is holding, written once for the whole screen.
   *
   * An attribute on the shell rather than a cursor set on each of the dozen
   * surfaces underneath, so a tool cannot be half applied: whatever is under
   * the pointer, the shape it takes says which tool is held. It sat on the
   * timeline until the picture gained a zoom of its own, and a stage that is
   * not inside the timeline cannot read an attribute that is.
   */
  const writeTool = (state: AppState): void => {
    shell.dataset.tool = state.tool;
  };
  // Written now as well as on every change: subscribing does not deliver the
  // state as it stands, and a shell with no tool on it at all is a shell that
  // matches "not the move tool".
  writeTool(session.store.state);
  session.store.subscribe(writeTool);

  /*
   * Alt, watched only so the zoom tool can say which way it will go.
   *
   * On the window rather than on a panel because a modifier held down before
   * the pointer arrives is the common case, and an element only hears about
   * keys while it has focus. Both edges are needed: releasing alt somewhere
   * else would otherwise leave the cursor promising a zoom out that is no
   * longer what a click does. Blur clears it for the same reason -- alt is
   * often what took the window away.
   */
  const readAlt = (event: KeyboardEvent): void => {
    shell.classList.toggle('is-alt', event.altKey);
  };
  window.addEventListener('keydown', readAlt);
  window.addEventListener('keyup', readAlt);
  window.addEventListener('blur', () => shell.classList.remove('is-alt'));

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
      shell.appendChild(panelDivider.el);
      shell.appendChild(soundDesignPanel.docks.right);
      panelDivider.refresh();
      leftDivider.refresh();
      // The walkthrough points at parts of the screen, so it waits until
      // there is a screen to point at.
      requestAnimationFrame(() => tour.maybeStart());
    }
  };

  soundDesign.effects = {
    onTime: (time) => {
      timeline.setTime(time);
      transport.setTime(time);
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

/**
 * The speeds J and L step through, as every edit suite has them.
 *
 * Two, four, eight. Tapping again goes up a rung; tapping the opposite key
 * starts again at the bottom going the other way.
 */
const SHUTTLE_STEPS = [2, 4, 8] as const;

/** The next rung up, staying at the top once it is reached. */
function nextShuttle(rate: number): number {
  const way = Math.sign(rate) || 1;
  const at = SHUTTLE_STEPS.indexOf(Math.abs(rate) as (typeof SHUTTLE_STEPS)[number]);
  const next = SHUTTLE_STEPS[Math.min(at + 1, SHUTTLE_STEPS.length - 1)];
  return way * next;
}

/** Keyboard control. */
function attachKeyboard(session: Session, soundDesign: SoundDesignSession): () => void {
  /*
   * Which way and how fast a held shuttle is running, or 0 for stopped.
   *
   * Per attachment rather than per module, so two apps mounted on one page do
   * not share one speed between them.
   */
  const shuttle = { rate: 0 };

  const onKeyDown = (event: KeyboardEvent): void => {
    // Somewhere text is being typed. Nothing here applies.
    if (inField(event)) return;

    // Editing shortcuts first, because they are the ones meant to carry a
    // modifier and would otherwise be turned away with the browser's own.
    if (editKey(soundDesign, event)) return;

    // A control that uses this key itself keeps it.
    if (controlKeeps(event)) return;
    if (ignore(event)) return;

    soundDesignKey(session, soundDesign, event, shuttle);
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
 *
 * Some letters are shared, and the record button decides who has those.
 *
 * There are thirteen drum pads on the letter keys and an editor wants some of
 * the same letters for its tools. Six are claimed twice: T, H, J, K, L and S.
 * You are either playing something in or you are editing, never both in the
 * same keystroke, and record already said as much on its own tooltip -- so it
 * is what settles those six. Armed they are drums; otherwise they are tools,
 * which is what somebody arriving from an edit suite will try first.
 *
 * Only those six, though. C, V, Z and P are not pads, and arming once took
 * them anyway: reaching for the blade with record on did nothing at all and
 * said nothing about why. A clash is settled where there is one.
 */
function soundDesignKey(
  session: Session,
  soundDesign: SoundDesignSession,
  event: KeyboardEvent,
  shuttle: { rate: number },
): void {
  const key = event.key;
  const lower = key.toLowerCase();
  const chosen = session.state.selection.length;

  /* ---- the same under either mode, because none of them is a letter ---- */

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

  if (key === 'Home') {
    event.preventDefault();
    soundDesign.seek(0);
    return;
  }

  if (key === 'End') {
    event.preventDefault();
    soundDesign.seek(soundDesign.project.duration);
    return;
  }

  if (key === 'Delete' || key === 'Backspace') {
    // A drawn stretch of time is a selection too, and the more deliberate
    // one: it was just drawn, where sounds can stay chosen from something
    // done a while ago.
    if (session.state.range) {
      event.preventDefault();
      soundDesign.clearRange();
      return;
    }
    if (chosen) {
      event.preventDefault();
      soundDesign.removeSelected();
      return;
    }
    return;
  }

  if (key === 'Escape') {
    if (session.state.range) session.setRange(null);
    soundDesign.select([]);
    return;
  }

  /*
   * Armed: the letters that are drums are drums. The rest are still tools.
   *
   * This used to swallow every letter while the record button was on, which
   * is more than the clash needs. Only six letters are claimed twice -- T, H,
   * J, K, L and S -- and C, V, Z and P are not pads at all, so arming meant
   * giving up four tools to a conflict they were never in. Reaching for the
   * blade with record on did nothing and said nothing.
   */
  if (session.state.armed) {
    const pad = PAD_KEYS[lower];
    if (pad) {
      if (!event.repeat) {
        event.preventDefault();
        soundDesign.addCueAtPlayhead({ kind: 'kit', name: pad });
      }
      return;
    }
  }

  /* ---- otherwise: the letters are an editor's ---- */

  const tool = TOOLS.find((one) => one.key.toLowerCase() === lower);
  if (tool && !event.shiftKey) {
    event.preventDefault();
    session.setTool(tool.id);
    return;
  }

  /*
   * J, K and L: the one habit every editor brings with them.
   *
   * Tapping J or L again goes up through the speeds rather than starting
   * over, which is the whole point of them -- you find a moment by
   * overshooting fast and walking back slowly. K stops, and so does the
   * opposite key, because pressing L while running backwards means "no, the
   * other way".
   */
  if (lower === 'j' || lower === 'l') {
    event.preventDefault();
    const back = lower === 'j';
    const going = shuttle.rate;
    const sameWay = back ? going < 0 : going > 0;
    shuttle.rate = sameWay ? nextShuttle(going) : (back ? -SHUTTLE_STEPS[0] : SHUTTLE_STEPS[0]);
    soundDesign.shuttle(shuttle.rate);
    return;
  }

  if (lower === 'k') {
    event.preventDefault();
    shuttle.rate = 0;
    soundDesign.stopShuttle();
    return;
  }

  // Snapping cycles rather than toggles, because there are three of them and
  // one key: frame, then beat, then off, then round again.
  if (lower === 's') {
    event.preventDefault();
    const order = ['frame', 'beat', 'off'] as const;
    const at = order.indexOf(soundDesign.project.snap);
    soundDesign.setSnap(order[(at + 1) % order.length]);
  }
}

