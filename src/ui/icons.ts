import { el, svg } from './dom.ts';

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

/** A frame with a mark under it, for the sound design screen. */
export function soundDesignIcon(): HTMLElement {
  return el(
    'span',
    { style: { display: 'flex', flexDirection: 'column', gap: '3px', width: '18px' } },
    [
      el('i', {
        style: {
          height: '11px',
          border: '1.4px solid currentColor',
          borderRadius: '2px',
        },
      }),
      el(
        'span',
        { style: { display: 'flex', alignItems: 'flex-end', gap: '2px', height: '5px' } },
        [3, 5, 2].map((h, i) =>
          el('i', {
            style: {
              width: '2px',
              height: `${h}px`,
              borderRadius: '1px',
              background: i === 1 ? 'var(--ac)' : 'currentColor',
            },
          }),
        ),
      ),
    ],
  );
}

/*
 * The tools, which are the one place this file draws rather than builds.
 *
 * Everything above is an arrangement of bars and rings, because that is what
 * the marks in this app are. A pointer, a blade, a hand and a lens are not:
 * they are pictures everybody already knows, and a box approximation of a
 * known picture reads as a worse version of it rather than as a style. The
 * glyphs in the moment rows are drawn the same way for the same reason.
 */
const stroke = (d: string, size = 16): SVGElement =>
  svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' }, [
    svg('path', {
      d,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  ]);

/** One tool's mark, by the id the store holds. */
export function toolIcon(tool: string): SVGElement {
  switch (tool) {
    // An arrow, filled, because a hollow pointer reads as a cursor bug.
    case 'move':
      return svg('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, [
        svg('path', { d: 'M4 2.2 12.4 8.6 8.6 9.1 10.6 13 8.9 13.8 7 9.9 4.4 12z', fill: 'currentColor' }),
      ]);
    /*
     * An I-beam, which is the same mark the pointer takes over the lanes.
     *
     * Two uprights with a bar between them was the obvious drawing and came
     * out as a capital H, which is a letter sitting in a row of pictures. The
     * I-beam is what every editor uses for choosing a stretch, and it agrees
     * with the cursor this tool sets.
     */
    case 'range':
      return stroke('M5 3h6M8 3v10M5 13h6');
    /*
     * A blade, with the cut running on below it.
     *
     * A stem over an opening V was meant to be a razor on a line and read as
     * a stick figure. A tapering blade is the shape the thing actually has.
     */
    case 'cut':
      return svg('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, [
        svg('path', { d: 'M6.1 2h3.8l1.1 7.2H5z', fill: 'currentColor' }),
        svg('path', {
          d: 'M8 9.9V14',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 1.5,
          'stroke-linecap': 'round',
          'stroke-dasharray': '1.6 1.8',
        }),
      ]);
    // A hand, cut to the two fingers and a thumb that still read at 16px.
    case 'hand':
      return stroke('M6 8.5V4.2a1.1 1.1 0 0 1 2.2 0v3.6M8.2 7.8V3.4a1.1 1.1 0 0 1 2.2 0v4.4M10.4 8.2V5.4a1.1 1.1 0 0 1 2.1 0V10a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8.4a1.05 1.05 0 0 1 2 0');
    // A lens with a handle, and nothing inside it: a plus would say zoom in
    // when the same tool goes both ways.
    case 'zoom':
      return stroke('M7.2 2.6a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2M10.6 10.6 14 14');
    /*
     * A nib on a line, rather than the whole pen.
     *
     * At sixteen pixels a drawn pen is a diagonal smudge; what says pen is
     * the nib and the stroke coming away from it, which is also what this
     * tool does -- you drag and a curve follows.
     */
    case 'pen':
      return svg('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, [
        svg('path', { d: 'M11.2 1.9 14 4.7l-6.4 6.4-3.5.7.7-3.5z', fill: 'currentColor' }),
        svg('path', {
          d: 'M1.6 14.4c2.4 0 3.2-2.2 5.2-2.2',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 1.5,
          'stroke-linecap': 'round',
        }),
      ]);
    default:
      return stroke('M4 8h8');
  }
}
