import type { SoundDesignSession } from '../../sound-design-session.ts';
import type { AppState } from '../../store.ts';
import { button, el, setText } from '../dom.ts';
import type { View } from '../view.ts';

export interface VideoStageView extends View {
  video: HTMLVideoElement;
}

/** How far in the picture can be taken, and the smallest step either way. */
const MOST = 16;
const STEP = 1.6;

/**
 * The video the sound is being made for.
 *
 * The file is read straight off disk, so nothing is uploaded and the clip
 * never leaves the machine. Its own audio is muted by default and is never
 * part of an export, because the deliverable is the sound you are making.
 *
 * The picture can be gone into and moved about, which it could not before:
 * it fit the stage and that was the only size it had. That is fine for
 * watching and wrong for the work -- finding the exact frame a foot lands on
 * means looking closely at a corner of a picture that is a third of the
 * window, and a tool called Hand that cannot move the picture is a tool that
 * does not do what its name says.
 */
export function createVideoStage(session: SoundDesignSession): VideoStageView {
  const video = el('video', {
    class: 'vstage__video',
    attrs: { playsinline: '', preload: 'metadata' },
  });
  video.muted = true;

  const picker = el('input', {
    class: 'vstage__file',
    type: 'file',
    attrs: { accept: 'video/*' },
    on: {
      change: (event) => {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (file) void session.loadVideo(file);
        input.value = '';
      },
    },
  });

  const drop = el('div', { class: 'vstage__drop' }, [
    el('div', { style: { textAlign: 'center' } }, [
      el('div', { class: 'vstage__drop-title', text: 'Drop a video here' }),
      el('div', {
        class: 'vstage__drop-hint',
        text: 'or choose a file. It stays on your machine and is never uploaded.',
      }),
      button({ class: 'chip vstage__pick', on: { click: () => picker.click() } }, ['Choose a video']),
    ]),
  ]);

  /**
   * How far in, and how far off centre.
   *
   * One is the picture fitting the stage, which is where it starts and what
   * Fit returns it to. The offset is in screen pixels from the middle, which
   * is what the transform wants and what the pointer arithmetic is already
   * in -- keeping it in picture coordinates would mean converting twice on
   * every frame of a drag for no gain.
   */
  let scale = 1;
  let offset = { x: 0, y: 0 };

  /**
   * The way back, and the only thing on screen that says you are zoomed.
   *
   * Every editor shows the magnification somewhere, because "why is the
   * picture cut off" is otherwise a question with no answer on screen. It is
   * not there at all at Fit, where it would be saying nothing.
   */
  const fitButton = button(
    {
      class: 'chip chip--sm vstage__fit',
      title: 'Back to the whole picture',
      on: { click: () => setView(1, { x: 0, y: 0 }) },
    },
    ['Fit'],
  );

  const root = el('div', { class: 'vstage' }, [video, drop, fitButton, picker]);

  /**
   * The size the picture actually covers at rest, letterboxing excluded.
   *
   * Measured against the video's own box rather than the stage's, which are
   * not the same thing: the stage carries fourteen pixels of padding all
   * round, so taking the stage's width here overstated the picture by nearly
   * thirty pixels and let a drag pull it that far off an edge. `clientWidth`
   * rather than a bounding rectangle, because a rectangle is measured after
   * the transform and this is the size the transform is applied to.
   */
  function fitted(): { width: number; height: number } {
    const wide = video.videoWidth || 16;
    const tall = video.videoHeight || 9;
    const at = Math.min(video.clientWidth / wide, video.clientHeight / tall);
    return { width: wide * at, height: tall * at };
  }

  /**
   * How far off centre the picture may go before it pulls away from an edge.
   *
   * Without this a drag can throw the picture off the side and leave you
   * looking at the empty stage with no way of knowing which direction it
   * went. Zero on an axis that still fits, so a wide clip in a tall stage
   * moves sideways only.
   */
  function room(at: number): { x: number; y: number } {
    const size = fitted();
    return {
      x: Math.max(0, (size.width * at - video.clientWidth) / 2),
      y: Math.max(0, (size.height * at - video.clientHeight) / 2),
    };
  }

  function setView(at: number, to: { x: number; y: number }): void {
    /*
     * Snapped near the bottom, because 1.6 does not divide back out cleanly.
     *
     * Two presses in and two alt-presses back out is 2.56 / 1.6 / 1.6, which
     * in binary is 1.0000000000000002 rather than 1 -- so the picture stayed
     * magnified by a fifteenth of a millionth of a percent, which is to say
     * invisibly, and the Fit chip stayed on screen with nothing left to do.
     * A tenth of a percent is far below anything anybody can see and far
     * above the error.
     */
    const wanted = Math.min(MOST, Math.max(1, at));
    scale = wanted < 1.001 ? 1 : wanted;
    const edge = room(scale);
    offset = {
      x: Math.min(edge.x, Math.max(-edge.x, to.x)),
      y: Math.min(edge.y, Math.max(-edge.y, to.y)),
    };
    // Written rather than left to a class, since it is a continuous value.
    video.style.transform =
      scale === 1 ? '' : `translate(${offset.x}px, ${offset.y}px) scale(${scale})`;
    root.classList.toggle('is-zoomed', scale > 1);
    setText(fitButton, `${Math.round(scale * 100)}% · Fit`);
  }

  /** Back to the whole picture, for a new clip or a move between homes. */
  const refit = (): void => setView(1, { x: 0, y: 0 });

  /**
   * Go in or out around a point, leaving what is under it where it is.
   *
   * Zooming around the middle would be simpler and is the thing that makes
   * magnification annoying to use: what you were looking at slides away as
   * you go in, so every step needs a drag after it to find the subject again.
   */
  function zoomAround(clientX: number, clientY: number, to: number): void {
    const box = root.getBoundingClientRect();
    const from = scale;
    const next = Math.min(MOST, Math.max(1, to));
    if (next === from) return;
    if (next === 1) return refit();

    const px = clientX - (box.x + box.width / 2);
    const py = clientY - (box.y + box.height / 2);
    const k = next / from;
    setView(next, {
      x: px - (px - offset.x) * k,
      y: py - (py - offset.y) * k,
    });
  }

  /** Drag the picture along under a still stage. */
  function panFrom(event: PointerEvent): void {
    const fromX = event.clientX;
    const fromY = event.clientY;
    const was = { ...offset };
    root.classList.add('is-grabbing');

    const move = (e: PointerEvent): void => {
      setView(scale, { x: was.x + (e.clientX - fromX), y: was.y + (e.clientY - fromY) });
    };
    const up = (): void => {
      root.classList.remove('is-grabbing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /**
   * The two tools that mean something over a picture, and nothing else.
   *
   * Cut, Range and Pen are about the timeline; there is nothing on a frame
   * for them to act on, so they say so once rather than doing something
   * surprising or nothing at all. Move is not here for the same reason it is
   * not on the timeline's tool handler: it is the tool that leaves every
   * surface behaving as it already did.
   */
  function toolPress(event: PointerEvent): void {
    if (event.button !== 0) return;
    if (!session.store.state.videoReady) return;
    const tool = session.store.state.tool;
    if (tool === 'move') return;

    event.preventDefault();
    event.stopPropagation();

    if (tool === 'hand') {
      if (scale === 1) {
        session.store.set({ status: 'the picture already fits — zoom in first, then drag it about' });
        return;
      }
      panFrom(event);
      return;
    }
    if (tool === 'zoom') {
      const out = event.altKey || event.metaKey || event.ctrlKey;
      zoomAround(event.clientX, event.clientY, out ? scale / STEP : scale * STEP);
      return;
    }
    session.store.set({ status: `the ${tool} tool works on the timeline, not on the picture` });
  }

  /**
   * Pinch to zoom the picture, two fingers to move it.
   *
   * A trackpad pinch arrives as a wheel event with `ctrlKey` set, which is
   * the only way a browser reports one. Two fingers without it is a scroll,
   * and there is nothing to scroll here -- so it moves the picture instead,
   * which is what two fingers do over a zoomed image everywhere else.
   *
   * Neither asks which tool is held. A gesture is not a tool: the hand and
   * the zoom exist for a mouse, which has no way to say "closer" without
   * one, and somebody pinching has already said it.
   */
  root.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) {
        event.preventDefault();
        // Exponential, so pinching out and back in lands where it started.
        zoomAround(event.clientX, event.clientY, scale * Math.exp(-event.deltaY / 180));
        return;
      }
      // Nothing to move while the whole picture is showing, so the scroll is
      // left to whatever is underneath rather than swallowed.
      if (scale <= 1) return;
      event.preventDefault();
      setView(scale, { x: offset.x - event.deltaX, y: offset.y - event.deltaY });
    },
    { passive: false },
  );

  root.addEventListener('pointerdown', toolPress, true);

  // A stage that changes size changes how far the picture may be moved, and
  // a picture left beyond the new edge would be stuck there.
  const watch = new ResizeObserver(() => setView(scale, offset));
  watch.observe(root);

  // Accept a file dropped anywhere on the stage.
  root.addEventListener('dragover', (event) => {
    event.preventDefault();
    root.classList.add('is-over');
  });
  root.addEventListener('dragleave', () => root.classList.remove('is-over'));
  root.addEventListener('drop', (event) => {
    event.preventDefault();
    root.classList.remove('is-over');
    const file = event.dataTransfer?.files?.[0];
    if (file) void session.loadVideo(file);
  });

  /** What was loaded and where it was living, to notice either changing. */
  let showing = { name: null as string | null, floating: false };

  return {
    el: root,
    video,
    update(state: AppState) {
      drop.style.display = state.videoReady ? 'none' : '';
      video.style.display = state.videoReady ? '' : 'none';

      /*
       * A new clip, or the picture moving into its own window, starts again
       * at Fit.
       *
       * The transform rides on the video element, and that element is lent to
       * the floating window rather than copied into it -- so a magnification
       * worked out against the stage would follow it into a box a fifth of
       * the size and put the picture somewhere off screen.
       */
      const now = { name: state.project.videoName, floating: state.videoWindow };
      if (now.name !== showing.name || now.floating !== showing.floating) {
        showing = now;
        refit();
      }
    },
  };
}
