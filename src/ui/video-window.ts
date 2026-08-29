import { button, el } from './dom.ts';
import { timecode } from '../timeline/project.ts';

/** Where the window was left, so it opens where you put it last time. */
const STORAGE_KEY = 'toolcraft.st88.videowin';
/** Small enough to tuck into a corner, big enough to still read the picture. */
const MIN_W = 180;
const MIN_H = 120;
/** How much of the window has to stay on screen, so it can always be grabbed. */
const KEEP_ON = 48;

/**
 * How much of the left edge belongs to the rail, in pixels.
 *
 * Held in step with `.rail` in `layout.css` by hand, which is a small cost
 * against the window being able to cover the app's only navigation.
 */
const RAIL_W = 64;

/*
 * Where the window was left, which is all that is kept.
 *
 * Whether it was open used to be kept too, because the instrument screens had
 * no other way to see the clip and so had their own answer to that. There are
 * no instrument screens, and the one toggle that opens this now lives on the
 * timeline bar. A flag that only one caller ever set, and that nothing sets
 * any more, is a flag that quietly reads false forever on the machines of the
 * people who once turned it off.
 */
interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEFAULT: Placed = { x: 24, y: 96, w: 360, h: 220 };

export interface VideoWindow {
  el: HTMLElement;
  /** Take the video out of its usual home and show it here. */
  open(): void;
  /** Put the video back and hide the window. */
  close(): void;
  /** Put the video back without treating it as the window being dismissed. */
  stow(): void;
  /** Whether it is on show right now. */
  readonly showing: boolean;
  /** Keep the window inside the viewport after it changed size. */
  reflow(): void;
}

/**
 * The video, floating over the timeline.
 *
 * Choosing the window means the stage above the lanes is gone rather than
 * empty, and the height it was using goes to the timeline. That is the reason
 * to want it: on a long clip with several layers, the lanes are what you are
 * working in and the picture only has to be visible.
 *
 * It borrows the one video element the app has rather than making a second
 * one. Two video elements would mean two decoders, two positions, and two
 * things to keep in step, and they would drift apart within a minute. Moved
 * rather than copied, there is only ever one clip, at one moment.
 */
export function createVideoWindow(options: {
  /** The video element, shared with the sound design screen. */
  video: HTMLVideoElement;
  /** Where the video belongs when this window is not showing it. */
  home: () => HTMLElement;
  /**
   * The × was pressed, as opposed to the window being stowed for a screen
   * that does not float it.
   *
   * The two screens mean different things by it, and only the app knows which
   * one is up, so the meaning is decided there rather than here.
   */
  onClose?: () => void;
}): VideoWindow {
  const placed = load();
  const { video } = options;

  const time = el('div', { class: 'vwin__time', text: '0:00' });

  const play = button(
    {
      class: 'vwin__btn',
      title: 'Play or pause the video',
      on: {
        click: () => {
          if (video.paused) void video.play();
          else video.pause();
        },
      },
    },
    [el('i', { class: 'vwin__play' })],
  );

  const scrub = el('input', {
    class: 'vwin__scrub',
    type: 'range',
    attrs: { min: '0', max: '1000', value: '0', step: '1', title: 'Scrub' },
    on: {
      input: (event) => {
        const at = Number((event.currentTarget as HTMLInputElement).value) / 1000;
        if (video.duration) video.currentTime = at * video.duration;
      },
    },
  }) as HTMLInputElement;

  const shut = button(
    { class: 'vwin__btn vwin__btn--shut', title: 'Hide the video', on: { click: () => close() } },
    ['×'],
  );

  // The whole strip is the handle, so there is a lot to take hold of. The
  // buttons inside it stop the press reaching here, or you could never press
  // one without also starting a drag.
  const bar = el('div', { class: 'vwin__bar' }, [
    el('div', { class: 'vwin__grip' }),
    time,
    el('div', { class: 'vwin__spacer' }),
    play,
    shut,
  ]);

  const hold = el('div', { class: 'vwin__hold' });
  const corner = el('i', { class: 'vwin__corner', attrs: { title: 'Drag to resize' } });

  const root = el('div', { class: 'vwin' }, [bar, hold, scrub, corner]);
  root.style.display = 'none';

  // ---------- where it sits ----------

  function apply(): void {
    // Clamped on every move and on every window resize, so it can never end
    // up somewhere it cannot be reached.
    const maxW = Math.max(MIN_W, window.innerWidth - KEEP_ON);
    const maxH = Math.max(MIN_H, window.innerHeight - KEEP_ON);
    placed.w = Math.max(MIN_W, Math.min(maxW, placed.w));
    placed.h = Math.max(MIN_H, Math.min(maxH, placed.h));
    // Never over the rail. It is the only way to get from one screen to
    // another, and a window that can be parked on top of it is a window that
    // can strand you: measured in a browser, dragging it left far enough made
    // every rail button unclickable.
    placed.x = Math.max(RAIL_W, Math.min(window.innerWidth - KEEP_ON, placed.x));
    placed.y = Math.max(0, Math.min(window.innerHeight - KEEP_ON, placed.y));

    root.style.left = `${placed.x}px`;
    root.style.top = `${placed.y}px`;
    root.style.width = `${placed.w}px`;
    root.style.height = `${placed.h}px`;
  }

  /** Drag the strip to move it, drag the corner to resize it. */
  function grab(node: HTMLElement, onMove: (dx: number, dy: number) => void): void {
    node.addEventListener('pointerdown', (event) => {
      // Only the strip itself, not the buttons sitting on it.
      if (event.target !== node && node === bar) return;
      event.preventDefault();
      node.setPointerCapture(event.pointerId);
      root.classList.add('is-moving');

      const from = { x: event.clientX, y: event.clientY };
      const move = (e: PointerEvent): void => {
        onMove(e.clientX - from.x, e.clientY - from.y);
        from.x = e.clientX;
        from.y = e.clientY;
        apply();
      };
      const end = (): void => {
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', end);
        node.removeEventListener('pointercancel', end);
        root.classList.remove('is-moving');
        save(placed);
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', end);
      node.addEventListener('pointercancel', end);
    });
  }

  grab(bar, (dx, dy) => {
    placed.x += dx;
    placed.y += dy;
  });
  grab(corner, (dx, dy) => {
    placed.w += dx;
    placed.h += dy;
  });

  // ---------- opening and closing ----------

  function open(): void {
    hold.appendChild(video);
    // The stage hides the video until a clip is loaded; in here it is the
    // whole point of the window, so it is always shown and the window itself
    // is what appears and disappears.
    video.style.display = '';
    root.style.display = '';
    apply();
    save(placed);
  }

  function put(): void {
    root.style.display = 'none';
    options.home().prepend(video);
  }

  /**
   * The × was pressed.
   *
   * The same statement as turning the Window toggle off, and it has to be, or
   * the next render would open it straight back up. Decided by the caller
   * rather than here, so this only hides and says so.
   */
  function close(): void {
    put();
    options.onClose?.();
  }


  // ---------- what it reads ----------

  const tick = (): void => {
    const at = video.currentTime || 0;
    if (video.duration) scrub.value = String(Math.round((at / video.duration) * 1000));
    time.textContent = timecode(at, 30);
    root.classList.toggle('is-playing', !video.paused);
  };
  video.addEventListener('timeupdate', tick);
  video.addEventListener('play', tick);
  video.addEventListener('pause', tick);
  video.addEventListener('loadedmetadata', tick);

  // Held inside the viewport whether or not it is on screen, so it is never
  // shown somewhere the window has since been resized past.
  window.addEventListener('resize', () => apply());

  return {
    el: root,
    open,
    close,
    stow: put,
    get showing() {
      return root.style.display !== 'none';
    },
    reflow: apply,
  };
}

function load(): Placed {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT };
    const held = JSON.parse(raw) as Partial<Placed>;
    return {
      x: num(held.x, DEFAULT.x),
      y: num(held.y, DEFAULT.y),
      w: num(held.w, DEFAULT.w),
      h: num(held.h, DEFAULT.h),
    };
  } catch {
    return { ...DEFAULT };
  }
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function save(placed: Placed): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(placed));
  } catch {
    // A browser with storage turned off still gets a window that works; it
    // just opens where it started every time.
  }
}
