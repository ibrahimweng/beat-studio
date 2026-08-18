import { el } from './dom.ts';

/**
 * Icons are built from styled boxes rather than SVG, matching the design,
 * where every glyph is a small arrangement of bars and rings. They inherit
 * `currentColor`, so hover and active states come free.
 */

/** Waveform mark used on the logo and the mode badge. */
export function waveMark(
  heights: number[],
  width: number,
  gap: number,
  accentCount: number,
): HTMLElement {
  return el(
    'span',
    {
      style: {
        display: 'flex',
        alignItems: 'flex-end',
        gap: `${gap}px`,
        height: `${Math.max(...heights)}px`,
      },
    },
    heights.map((h, i) =>
      el('i', {
        style: {
          width: `${width}px`,
          height: `${h}px`,
          borderRadius: '1px',
          background: i < accentCount ? 'var(--ac)' : 'var(--txt-3)',
        },
      }),
    ),
  );
}

/** Concentric rings — the drum kit. */
export function drumsIcon(): HTMLElement {
  return el(
    'span',
    {
      style: {
        position: 'relative',
        width: '17px',
        height: '17px',
        borderRadius: '50%',
        border: '1.4px solid currentColor',
      },
    },
    [
      el('i', {
        style: {
          position: 'absolute',
          inset: '4px',
          borderRadius: '50%',
          border: '1.4px solid currentColor',
          opacity: '0.5',
        },
      }),
    ],
  );
}

/** Three keys, the middle one short — the piano. */
export function keysIcon(): HTMLElement {
  const key = (height: number, opacity: number): HTMLElement =>
    el('i', {
      style: {
        width: '3px',
        height: `${height}px`,
        borderRadius: '0 0 1px 1px',
        background: 'currentColor',
        opacity: String(opacity),
      },
    });
  return el(
    'span',
    { style: { display: 'flex', gap: '1.5px', alignItems: 'flex-start' } },
    [key(16, 1), key(10, 0.45), key(16, 1)],
  );
}

/** Four strings, thin to thick — the guitar. */
export function guitarIcon(): HTMLElement {
  const string = (height: number, opacity: number): HTMLElement =>
    el('i', {
      style: { height: `${height}px`, background: 'currentColor', opacity: String(opacity) },
    });
  return el(
    'span',
    {
      style: { display: 'flex', flexDirection: 'column', gap: '2.5px', width: '17px' },
    },
    [string(1, 0.55), string(1, 0.75), string(1.6, 1), string(2.2, 0.8)],
  );
}

/** A 3x3 grid with the downbeats lit — the sequencer. */
export function sequencerIcon(): HTMLElement {
  return el(
    'span',
    {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 3px)',
        gap: '2.5px',
      },
    },
    Array.from({ length: 9 }, (_, i) =>
      el('i', {
        style: {
          height: '3px',
          borderRadius: '1px',
          background: i % 4 === 0 ? 'var(--ac)' : 'currentColor',
          opacity: i % 4 === 0 ? '1' : '0.45',
        },
      }),
    ),
  );
}

/** An uneven waveform — recorded takes. */
export function takesIcon(): HTMLElement {
  return el(
    'span',
    { style: { display: 'flex', alignItems: 'center', gap: '2px', height: '17px' } },
    [7, 15, 10, 17, 6].map((h) =>
      el('i', {
        style: {
          width: '1.6px',
          height: `${h}px`,
          borderRadius: '1px',
          background: 'currentColor',
        },
      }),
    ),
  );
}
