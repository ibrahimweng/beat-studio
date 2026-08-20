import type { SoundDesignSession } from '../../sound-design-session.ts';
import type { AppState } from '../../store.ts';
import { clear, el } from '../dom.ts';

/** Height of the strip, matched in the stylesheet. */
const HEIGHT = 34;

export interface MotionStrip {
  /** Sits under the ruler, inside the scrolling column. */
  el: HTMLElement;
  /** Sits in the layer name column, level with the strip. */
  label: HTMLElement;
  draw(state: AppState, pxPerSec: number): void;
}

/**
 * How much the picture changes, drawn along the timeline.
 *
 * This is the visual equivalent of a waveform. Every cut and fast move shows
 * up as a spike, and the marks above it are the moments being suggested.
 * Click a mark to place the current sound there.
 */
export function createMotionStrip(session: SoundDesignSession): MotionStrip {
  const canvas = el('canvas', { class: 'strip__canvas' }) as HTMLCanvasElement;
  const marks = el('div', { class: 'strip__marks' });
  const root = el('div', { class: 'strip' }, [canvas, marks]);
  const label = el('div', { class: 'strip__label' }, [
    el('div', { class: 'tl__layer-name', text: 'Motion' }),
  ]);

  let painted = '';

  return {
    el: root,
    label,

    draw(state: AppState, pxPerSec: number) {
      const { detect } = state;
      const visible = detect.samples.length > 0;
      root.style.display = visible ? '' : 'none';
      label.style.display = visible ? '' : 'none';
      if (!visible) {
        // Leaving old marks in the page would show them again the moment the
        // strip reappeared for a different video.
        clear(marks);
        painted = '';
        return;
      }

      const width = Math.max(1, Math.round(state.project.duration * pxPerSec));
      // Redrawing a wide canvas is not free, so only do it when something moved.
      const key = `${width}|${detect.samples.length}|${detect.peaks.length}|${detect.status}`;
      if (key === painted) return;
      painted = key;

      drawCurve(canvas, detect.samples, width, state.project.duration);
      drawMarks(marks, detect.peaks, pxPerSec, session);
    },
  };
}

function drawCurve(
  canvas: HTMLCanvasElement,
  samples: AppState['detect']['samples'],
  width: number,
  duration: number,
): void {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.round(HEIGHT * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${HEIGHT}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx || !duration) return;
  ctx.scale(ratio, ratio);

  const peak = samples.reduce((max, s) => Math.max(max, s.energy), 0) || 1;
  const accent =
    getComputedStyle(document.documentElement).getPropertyValue('--ac').trim() || '#0c8ce9';

  ctx.clearRect(0, 0, width, HEIGHT);
  ctx.beginPath();
  ctx.moveTo(0, HEIGHT);
  for (const sample of samples) {
    const x = (sample.t / duration) * width;
    // A square root curve lifts the quieter movement into view, which is
    // where the smaller hits live.
    const y = HEIGHT - Math.sqrt(sample.energy / peak) * (HEIGHT - 2);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, HEIGHT);
  ctx.closePath();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.28;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawMarks(
  container: HTMLElement,
  peaks: AppState['detect']['peaks'],
  pxPerSec: number,
  session: SoundDesignSession,
): void {
  clear(container);
  for (const peak of peaks) {
    container.appendChild(
      el('button', {
        class: 'strip__mark',
        type: 'button',
        title: `Place the chosen sound here (${peak.t.toFixed(2)}s)`,
        style: { left: `${peak.t * pxPerSec}px` },
        on: {
          click: (event) => {
            event.stopPropagation();
            session.placeHit(peak.t);
          },
        },
      }),
    );
  }
}
