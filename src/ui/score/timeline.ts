import type { ScoreSession } from '../../score-session.ts';
import type { AppState } from '../../store.ts';
import { cueLength, cueStart, timecode } from '../../timeline/project.ts';
import type { Cue, Project } from '../../timeline/types.ts';
import { button, clear, el, toggleClass } from '../dom.ts';
import type { View } from '../view.ts';

const MIN_PX_PER_SEC = 8;
const MAX_PX_PER_SEC = 600;

export interface TimelineView extends View {
  /** Move the playhead. Called many times a second, so it avoids the store. */
  setTime(time: number): void;
  flashCue(id: string): void;
}

/**
 * The cue list drawn against video time.
 *
 * Time runs left to right in seconds, not in bars, because that is what the
 * video is measured in. Each cue is drawn from the moment it starts sounding
 * to the moment it stops, so a riser anchored to its end visibly reaches back
 * from the hit it leads into.
 */
export function createTimeline(session: ScoreSession): TimelineView {
  let pxPerSec = 60;
  let painted: Project | null = null;
  let paintedZoom = -1;

  const cueNodes = new Map<string, HTMLElement>();

  const ruler = el('div', { class: 'tl__ruler' });
  const lanes = el('div', { class: 'tl__lanes' });
  // Marks where the video stops, so the empty space beyond it reads as empty.
  const beyond = el('div', { class: 'tl__beyond' });
  const playhead = el('div', { class: 'tl__playhead' });
  const gutter = el('div', { class: 'tl__gutter' });

  const content = el('div', { class: 'tl__content' }, [ruler, lanes, beyond, playhead]);
  const viewport = el('div', { class: 'tl__viewport' }, [content]);

  const zoomOut = button({ class: 'chip chip--sm', title: 'Zoom out', on: { click: () => setZoom(pxPerSec / 1.6) } }, ['−']);
  const zoomIn = button({ class: 'chip chip--sm', title: 'Zoom in', on: { click: () => setZoom(pxPerSec * 1.6) } }, ['+']);
  const zoomFit = button({ class: 'chip chip--sm', title: 'Fit the whole video', on: { click: fit } }, ['Fit']);

  const root = el('section', { class: 'tl' }, [
    el('div', { class: 'tl__bar' }, [
      el('div', { class: 'micro-label', text: 'Timeline' }),
      el('div', { class: 'dock__spacer' }),
      zoomOut,
      zoomFit,
      zoomIn,
    ]),
    el('div', { class: 'tl__body' }, [gutter, viewport]),
  ]);

  function setZoom(value: number): void {
    pxPerSec = Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, value));
    paint(session.project, true);
  }

  function fit(): void {
    const duration = session.project.duration;
    if (duration <= 0) return;
    const width = viewport.clientWidth || 800;
    setZoom((width - 24) / duration);
  }

  // Framing the whole clip on load is almost always what you want first.
  session.onVideoLoaded = () => window.setTimeout(fit, 0);

  /** Turn a pointer event into a time on the timeline. */
  function timeAt(event: PointerEvent, lane: HTMLElement): number {
    const rect = lane.getBoundingClientRect();
    return Math.max(0, (event.clientX - rect.left) / pxPerSec);
  }

  function paint(project: Project, force = false): void {
    const changed =
      force ||
      painted === null ||
      painted.cues !== project.cues ||
      painted.layers !== project.layers ||
      painted.duration !== project.duration ||
      painted.fps !== project.fps;
    if (!changed && paintedZoom === pxPerSec) return;

    painted = project;
    paintedZoom = pxPerSec;

    const duration = Math.max(project.duration, 1);
    content.style.width = `${duration * pxPerSec + 24}px`;
    beyond.style.left = `${project.duration * pxPerSec}px`;
    beyond.style.display = project.duration > 0 ? '' : 'none';

    paintRuler(project, duration);
    paintLanes(project);
  }

  function paintRuler(project: Project, duration: number): void {
    clear(ruler);
    // Aim for a label every 80 pixels or so, on a round number of seconds.
    const targets = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = targets.find((s) => s * pxPerSec >= 80) ?? 600;

    for (let t = 0; t <= duration + 0.0001; t += step) {
      ruler.appendChild(
        el('div', {
          class: 'tl__tick',
          style: { left: `${t * pxPerSec}px` },
        }, [el('span', { text: timecode(t, project.fps) })]),
      );
    }
  }

  function paintLanes(project: Project): void {
    clear(lanes);
    clear(gutter);
    cueNodes.clear();

    // Keeps the name column lined up with the ruler above the lanes.
    gutter.appendChild(el('div', { class: 'tl__gutter-spacer' }));

    for (const layer of project.layers) {
      const name = el('div', { class: 'tl__layer-name', text: layer.name });
      const mute = button(
        {
          class: 'tl__layer-btn',
          title: `Mute ${layer.name}`,
          on: { click: () => session.updateLayer(layer.id, { muted: !layer.muted }) },
        },
        ['M'],
      );
      toggleClass(mute, 'is-on', layer.muted);

      const solo = button(
        {
          class: 'tl__layer-btn',
          title: `Solo ${layer.name}`,
          on: { click: () => session.updateLayer(layer.id, { solo: !layer.solo }) },
        },
        ['S'],
      );
      toggleClass(solo, 'is-on', layer.solo);

      gutter.appendChild(
        el('div', { class: 'tl__gutter-row' }, [name, mute, solo]),
      );

      const lane = el('div', {
        class: 'tl__lane',
        dataset: { layer: layer.id },
        on: {
          pointerdown: (event) => {
            // Clicking empty space places the current sound here.
            if (event.target !== lane) return;
            event.preventDefault();
            session.setActiveLayer(layer.id);
            session.addCue(timeAt(event, lane), undefined, layer.id);
          },
        },
      });
      toggleClass(lane, 'is-muted', layer.muted);

      for (const cue of project.cues) {
        if (cue.layerId !== layer.id) continue;
        const node = buildCue(cue);
        cueNodes.set(cue.id, node);
        lane.appendChild(node);
      }

      lanes.appendChild(lane);
    }
  }

  /**
   * A cue is drawn as a solid head at the moment it is pinned to, with a
   * translucent tail showing how long it sounds for.
   *
   * Only the head takes pointer events. The tail is see-through in both
   * senses, so a long sound never stops you placing another one underneath
   * it, which is exactly what you do when a whoosh runs beneath an impact.
   */
  function buildCue(cue: Cue): HTMLElement {
    const start = cueStart(cue);
    const width = Math.max(10, cueLength(cue) * pxPerSec);
    const endAnchored = cue.anchor === 'end';

    const head = el('div', {
      class: 'cue__head',
      title: `${cue.source.name} at ${timecode(cue.time, session.project.fps)}`,
      on: {
        pointerdown: (event) => {
          event.preventDefault();
          event.stopPropagation();
          session.select(cue.id);
          session.audition(cue);
          beginDrag(event, head, cue);
        },
      },
    }, [el('span', { class: 'cue__label', text: String(cue.source.name) })]);

    const node = el('div', {
      class: 'cue',
      dataset: { cue: cue.id },
      style: { left: `${start * pxPerSec}px`, width: `${width}px` },
    }, [el('i', { class: 'cue__tail' }), head]);

    toggleClass(node, 'is-muted', cue.muted);
    toggleClass(node, 'is-tail', endAnchored);
    return node;
  }

  /** Drag a cue along its lane to retime it. */
  function beginDrag(event: PointerEvent, node: HTMLElement, cue: Cue): void {
    const startX = event.clientX;
    const startTime = cue.time;
    node.setPointerCapture(event.pointerId);
    let moved = false;

    const move = (e: PointerEvent): void => {
      const delta = (e.clientX - startX) / pxPerSec;
      if (!moved && Math.abs(e.clientX - startX) < 3) return;
      moved = true;
      session.updateCue(cue.id, { time: Math.max(0, startTime + delta) });
    };

    const end = (): void => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
    };

    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
  }

  return {
    el: root,

    update(state: AppState) {
      paint(state.project);
      for (const [id, node] of cueNodes) {
        toggleClass(node, 'is-selected', state.selectedCueId === id);
      }
    },

    setTime(time: number) {
      playhead.style.transform = `translateX(${time * pxPerSec}px)`;
      // Keep the playhead in view while it runs past the right hand edge.
      const x = time * pxPerSec;
      const left = viewport.scrollLeft;
      const width = viewport.clientWidth;
      if (x < left || x > left + width - 60) {
        viewport.scrollLeft = Math.max(0, x - width * 0.35);
      }
    },

    flashCue(id: string) {
      const node = cueNodes.get(id);
      if (!node) return;
      node.classList.add('is-firing');
      window.setTimeout(() => node.classList.remove('is-firing'), 140);
    },
  };
}
