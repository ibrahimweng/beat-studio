import { el } from './dom.ts';

/** Thumb size, needed to keep the travel inside the track. */
const THUMB = 9;
/** Pixels of vertical drag that sweep a knob from 0 to 1. */
const KNOB_TRAVEL = 160;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Start a drag that follows the pointer until it is released.
 *
 * Pointer capture keeps events coming to this element even when the pointer
 * leaves it, so a knob does not stall when the cursor slides off — and unlike
 * window listeners, the browser cleans it up for us.
 */
function beginDrag(
  node: HTMLElement,
  event: PointerEvent,
  onMove: (event: PointerEvent) => void,
): void {
  event.preventDefault();
  node.setPointerCapture(event.pointerId);

  const move = (e: PointerEvent): void => onMove(e);
  const end = (): void => {
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', end);
    node.removeEventListener('pointercancel', end);
  };

  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
}

export interface Knob {
  el: HTMLElement;
  set(value: number): void;
}

/**
 * A rotary control. Dragging up increases; the pointer sweeps 270 degrees,
 * from -135 at zero to +135 at one.
 */
export function createKnob(options: {
  name: string;
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  onStart?: () => void;
}): Knob {
  const rotor = el('div', { class: 'knob__rotor' }, [
    el('i', { class: 'knob__pointer' }),
    el('i', { class: 'knob__dot' }),
  ]);
  const readout = el('div', { class: 'knob__value' });

  let current = options.value;

  const dial = el('div', {
    class: 'knob',
    attrs: { role: 'slider', 'aria-label': options.name },
    on: {
      pointerdown: (event) => {
        options.onStart?.();
        const startValue = current;
        const startY = event.clientY;
        beginDrag(dial, event, (e) => {
          apply(clamp01(startValue + (startY - e.clientY) / KNOB_TRAVEL));
        });
      },
    },
  }, [rotor]);

  function paint(): void {
    rotor.style.transform = `rotate(${-135 + current * 270}deg)`;
    readout.textContent = options.format(current);
    dial.setAttribute('aria-valuenow', String(Math.round(current * 100)));
  }

  function apply(value: number): void {
    current = value;
    paint();
    options.onChange(value);
  }

  paint();

  return {
    el: el('div', { class: 'knob-card' }, [dial, readout]),
    set: apply,
  };
}

export interface Slider {
  el: HTMLElement;
  set(value: number): void;
}

/**
 * A horizontal fader with tick markers, used for master volume. The travel is
 * inset by half a thumb at each end so the thumb never overhangs the track.
 */
export function createSliderH(options: {
  name: string;
  value: number;
  ticks: number;
  onChange: (value: number) => void;
  onStart?: () => void;
}): Slider {
  const fill = el('i', { class: 'slider-h__fill' });
  const thumb = el('i', { class: 'slider-h__thumb' });
  let current = options.value;

  const track = el(
    'div',
    {
      class: 'slider-h',
      attrs: { role: 'slider', 'aria-label': options.name },
      on: {
        pointerdown: (event) => {
          options.onStart?.();
          const rect = track.getBoundingClientRect();
          const read = (e: PointerEvent): number =>
            clamp01((e.clientX - rect.left - THUMB / 2) / (rect.width - THUMB));
          apply(read(event));
          beginDrag(track, event, (e) => apply(read(e)));
        },
      },
    },
    [
      el('i', { class: 'slider-h__track' }),
      fill,
      el(
        'div',
        { class: 'slider-h__ticks' },
        Array.from({ length: options.ticks }, () => el('i')),
      ),
      thumb,
    ],
  );

  function apply(value: number): void {
    current = value;
    fill.style.width = `${value * 100}%`;
    thumb.style.left = `calc(${value * 100}% - ${(value * THUMB).toFixed(2)}px)`;
    track.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    options.onChange(value);
  }

  apply(current);
  return { el: track, set: apply };
}

/** A vertical fader, used for the three EQ bands. Up is more. */
export function createSliderV(options: {
  name: string;
  value: number;
  onChange: (value: number) => void;
  onStart?: () => void;
}): Slider {
  const thumb = el('i', { class: 'slider-v__thumb' });
  let current = options.value;

  const track = el(
    'div',
    {
      class: 'slider-v',
      attrs: { role: 'slider', 'aria-label': options.name },
      on: {
        pointerdown: (event) => {
          options.onStart?.();
          const rect = track.getBoundingClientRect();
          const read = (e: PointerEvent): number =>
            clamp01(1 - (e.clientY - rect.top - THUMB / 2) / (rect.height - THUMB));
          apply(read(event));
          beginDrag(track, event, (e) => apply(read(e)));
        },
      },
    },
    [el('i', { class: 'slider-v__track' }), el('i', { class: 'slider-v__centre' }), thumb],
  );

  function apply(value: number): void {
    current = value;
    // 88px track less the 9px thumb leaves 79px of travel.
    thumb.style.top = `${(THUMB / 2 + (1 - value) * 79).toFixed(2)}px`;
    track.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    options.onChange(value);
  }

  apply(current);
  return { el: track, set: apply };
}
