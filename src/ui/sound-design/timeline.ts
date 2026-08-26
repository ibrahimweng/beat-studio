import type { SoundDesignSession } from '../../sound-design-session.ts';
import type { AppState } from '../../store.ts';
import { cueLength, cueStart, timecode } from '../../timeline/project.ts';
import type { AutoPoint, Cue, Layer, Project } from '../../timeline/types.ts';
import { button, clear, el, setText, svg, toggleClass } from '../dom.ts';
import type { View } from '../view.ts';
import { createMotionStrip } from './motion-strip.ts';

const MIN_PX_PER_SEC = 8;
const MAX_PX_PER_SEC = 600;

/** Height of a layer's level lane, matching --tl-auto in the stylesheet. */
const AUTO_HEIGHT = 46;
/** Loudest a drawn level goes, matching the level control on a sound. */
const MAX_LEVEL = 1.5;
/** How near the pointer has to be to grab a point rather than add one. */
const GRAB_RADIUS = 7;

export interface TimelineView extends View {
  /** Move the playhead. Called many times a second, so it avoids the store. */
  setTime(time: number): void;
  flashCue(id: string): void;
  /** Re-measure after the panel has been resized. */
  relayout(): void;
}

/**
 * The cue list drawn against video time.
 *
 * Time runs left to right in seconds, not in bars, because that is what the
 * video is measured in. Each cue is drawn from the moment it starts sounding
 * to the moment it stops, so a riser anchored to its end visibly reaches back
 * from the hit it leads into.
 */
export function createTimeline(session: SoundDesignSession): TimelineView {
  let pxPerSec = 60;
  let painted: Project | null = null;
  let paintedZoom = -1;

  /**
   * The parts of a drawn sound are kept alongside it.
   *
   * Looking them up again on every redraw meant two DOM queries per sound,
   * which is thousands of them on a busy timeline every time the zoom moves.
   */
  interface DrawnCue {
    node: HTMLElement;
    head: HTMLElement;
    label: HTMLElement;
    cue: Cue;
  }

  const cueNodes = new Map<string, DrawnCue>();
  /**
   * Which layers have their level open.
   *
   * Kept here rather than in the project. Whether you are looking at a level
   * is about what you are doing at this moment, not about the piece, and a
   * session that reopened with four lanes expanded because of what someone
   * was doing a fortnight ago would be a nuisance rather than a convenience.
   */
  const automating = new Set<string>();
  /** The drawn level for each open layer, so it can be redrawn on its own. */
  const autoLanes = new Map<string, SVGSVGElement>();
  /** Which sounds currently carry the chosen mark. */
  let marked: readonly string[] = [];
  const laneNodes = new Map<string, HTMLElement>();
  const strip = createMotionStrip(session);

  const ruler = el('div', { class: 'tl__ruler' });
  const lanes = el('div', { class: 'tl__lanes' });
  // Marks where the video stops, so the empty space beyond it reads as empty.
  const beyond = el('div', { class: 'tl__beyond' });
  const playhead = el('div', { class: 'tl__playhead' });
  /** The rectangle dragged across the lanes to choose several sounds. */
  const band = el('div', { class: 'tl__band' });
  band.style.display = 'none';
  const gutterRows = el('div', { class: 'tl__gutter-rows' });
  const gutter = el('div', { class: 'tl__gutter' });

  const content = el('div', { class: 'tl__content' }, [ruler, strip.el, lanes, beyond, band, playhead]);
  const viewport = el('div', {
    class: 'tl__viewport',
    on: {
      // The ruler stays put by being sticky; the layer names are a separate
      // column, so they are moved by hand to match.
      scroll: () => {
        gutterRows.style.transform = `translateY(${-viewport.scrollTop}px)`;
      },
    },
  }, [content]);

  // ---------- finding hits ----------
  const findButton = button(
    {
      class: 'chip chip--sm',
      title: 'Read the video and suggest where sounds belong',
      on: { click: () => void session.findHits() },
    },
    ['Find hits'],
  );

  const sensitivity = el('input', {
    class: 'range strip__sensitivity',
    type: 'range',
    title: 'How much has to change before a moment counts',
    attrs: { min: '0', max: '1', step: '0.01', value: '0.5' },
    on: {
      input: (event) => session.setSensitivity(Number((event.currentTarget as HTMLInputElement).value)),
    },
  }) as HTMLInputElement;

  const placeAll = button(
    {
      class: 'chip chip--sm',
      title: 'Place the chosen sound on every suggestion',
      on: { click: () => session.placeAllHits() },
    },
    ['Place all'],
  );

  const clearHits = button(
    { class: 'chip chip--sm', title: 'Forget the suggestions', on: { click: () => session.clearHits() } },
    ['Clear'],
  );

  const found = el('div', { class: 'hint', style: { whiteSpace: 'nowrap' } });
  const detectGroup = el('div', { class: 'tl__detect' }, [findButton, sensitivity, found, placeAll, clearHits]);

  const undo = button(
    { class: 'chip chip--sm', title: 'Undo (Ctrl or Cmd and Z)', on: { click: () => session.undo() } },
    ['↶'],
  );
  const redo = button(
    { class: 'chip chip--sm', title: 'Redo (Ctrl or Cmd, shift and Z)', on: { click: () => session.redo() } },
    ['↷'],
  );

  const zoomOut = button({ class: 'chip chip--sm', title: 'Zoom out', on: { click: () => setZoom(pxPerSec / 1.6) } }, ['−']);
  const zoomIn = button({ class: 'chip chip--sm', title: 'Zoom in', on: { click: () => setZoom(pxPerSec * 1.6) } }, ['+']);
  const zoomFit = button({ class: 'chip chip--sm', title: 'Fit the whole video', on: { click: fit } }, ['Fit']);

  const root = el('section', { class: 'tl' }, [
    el('div', { class: 'tl__bar' }, [
      el('div', { class: 'micro-label', text: 'Timeline' }),
      undo,
      redo,
      detectGroup,
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
    strip.draw(session.store.state, pxPerSec);
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

  /** Where a pointer is, in the timeline's own coordinates. */
  function pointIn(event: PointerEvent): { x: number; y: number } {
    const rect = content.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /**
   * A press on empty space, which is either placing a sound or choosing
   * several.
   *
   * Which one it turns out to be is not known until the pointer either moves
   * or comes up, so nothing happens on the way down. Clicking still places,
   * as it always did, and dragging draws a rectangle over the sounds to
   * choose instead.
   */
  function beginPress(event: PointerEvent, lane: HTMLElement, layerId: string): void {
    const from = pointIn(event);
    const startX = event.clientX;
    const startY = event.clientY;
    const adding = event.shiftKey || event.metaKey || event.ctrlKey;
    const held = adding ? session.store.state.selection : [];
    let dragging = false;

    lane.setPointerCapture(event.pointerId);

    const move = (e: PointerEvent): void => {
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
      dragging = true;

      const to = pointIn(e);
      const left = Math.min(from.x, to.x);
      const top = Math.min(from.y, to.y);
      band.style.display = '';
      band.style.left = `${left}px`;
      band.style.top = `${top}px`;
      band.style.width = `${Math.abs(to.x - from.x)}px`;
      band.style.height = `${Math.abs(to.y - from.y)}px`;

      const inside = cuesWithin(left, top, left + Math.abs(to.x - from.x), top + Math.abs(to.y - from.y));
      session.select([...new Set([...held, ...inside])]);
    };

    const end = (e: PointerEvent): void => {
      lane.removeEventListener('pointermove', move);
      lane.removeEventListener('pointerup', end);
      lane.removeEventListener('pointercancel', end);
      band.style.display = 'none';

      if (dragging) return;
      // A press that went nowhere. Placing on a layer makes it the one new
      // sounds go on, which is what someone reaching for it meant.
      session.setActiveLayer(layerId);
      session.addCue(timeAt(e, lane), undefined, layerId);
    };

    lane.addEventListener('pointermove', move);
    lane.addEventListener('pointerup', end);
    lane.addEventListener('pointercancel', end);
  }

  /** Which sounds a rectangle covers, in the timeline's own coordinates. */
  function cuesWithin(x1: number, y1: number, x2: number, y2: number): string[] {
    const top = lanes.offsetTop;
    const found: string[] = [];

    for (const [id, drawn] of cueNodes) {
      const lane = laneNodes.get(drawn.cue.layerId);
      if (!lane) continue;

      const laneTop = top + lane.offsetTop;
      const laneBottom = laneTop + lane.offsetHeight;
      if (laneBottom < y1 || laneTop > y2) continue;

      const left = cueStart(drawn.cue) * pxPerSec;
      const right = left + Math.max(10, cueLength(drawn.cue) * pxPerSec);
      if (right < x1 || left > x2) continue;

      found.push(id);
    }
    return found;
  }

  /** Draw every open level lane against the current zoom. */
  function paintAuto(project: Project): void {
    // The laid out width rather than the width the clip works out to. A
    // timeline shorter than the window is stretched to fill it, and sounds
    // can be placed anywhere in that space, so the level has to reach there
    // too or it would run out partway across a lane you can still click on.
    const width = Math.max(
      content.clientWidth,
      Math.round(Math.max(project.duration, 1) * pxPerSec + 24),
    );
    for (const layer of project.layers) {
      const lane = autoLanes.get(layer.id);
      if (lane) drawAuto(lane, layer.auto, width);
    }
  }

  /**
   * Whether the layers themselves changed, as opposed to what is drawn on
   * them.
   *
   * Drawing a level makes a new layer list on every movement of the pointer.
   * Treating that as the layers having changed would rebuild every lane and
   * every sound on them, sixty times a second, while someone drags a point.
   */
  function sameLayers(before: readonly Layer[], after: readonly Layer[]): boolean {
    if (before.length !== after.length) return false;
    return before.every((layer, i) => {
      const now = after[i];
      return (
        layer.id === now.id &&
        layer.name === now.name &&
        layer.muted === now.muted &&
        layer.solo === now.solo
      );
    });
  }

  function paint(project: Project, force = false): void {
    const first = painted === null;
    const zoomed = paintedZoom !== pxPerSec;
    const layersChanged =
      force || first || (painted!.layers !== project.layers && !sameLayers(painted!.layers, project.layers));
    const levelsChanged = !layersChanged && !first && painted!.layers !== project.layers;
    const scaleChanged =
      force || first || zoomed || painted!.duration !== project.duration || painted!.fps !== project.fps;
    const cuesChanged = force || first || painted!.cues !== project.cues;

    if (!layersChanged && !scaleChanged && !cuesChanged && !levelsChanged) return;

    painted = project;
    paintedZoom = pxPerSec;

    const duration = Math.max(project.duration, 1);
    content.style.width = `${duration * pxPerSec + 24}px`;
    beyond.style.left = `${project.duration * pxPerSec}px`;
    beyond.style.display = project.duration > 0 ? '' : 'none';

    if (scaleChanged) paintRuler(project, duration);

    // Rebuilding the lanes throws away every sound with them, so it also
    // redraws them. Otherwise only what moved is touched.
    if (layersChanged) paintLanes(project);
    else if (cuesChanged || zoomed) syncCues(project, zoomed);

    if (layersChanged || levelsChanged || scaleChanged) paintAuto(project);
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

  /**
   * Rebuild the lanes and the layer names.
   *
   * Only the layers, not the sounds on them. Rebuilding a thousand sounds
   * every time one of them moves is what made editing slow, so the two are
   * kept apart and the sounds are brought up to date separately.
   */
  function paintLanes(project: Project): void {
    clear(lanes);
    clear(gutter);
    clear(gutterRows);
    cueNodes.clear();
    laneNodes.clear();
    autoLanes.clear();

    // Keeps the name column lined up with what sits above the lanes.
    gutter.appendChild(el('div', { class: 'tl__gutter-spacer' }));
    gutter.appendChild(strip.label);
    gutter.appendChild(gutterRows);

    for (const layer of project.layers) {
      // Double click to rename, which is where people already try first.
      const name = el('div', {
        class: 'tl__layer-name',
        title: `${layer.name} — double click to rename`,
        text: layer.name,
        on: {
          dblclick: () => startRename(name, layer.id, layer.name),
        },
      });
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

      const level = button(
        {
          class: 'tl__layer-btn',
          title:
            `Draw ${layer.name}'s level over time. Click to add a point, drag ` +
            'to move it, click it twice to take it away.',
          on: {
            click: () => {
              if (automating.has(layer.id)) automating.delete(layer.id);
              else automating.add(layer.id);
              paint(session.project, true);
            },
          },
        },
        ['A'],
      );
      toggleClass(level, 'is-on', automating.has(layer.id));

      const remove = button(
        {
          class: 'tl__layer-btn tl__layer-btn--remove',
          title: `Remove ${layer.name}`,
          on: {
            click: () => {
              const count = session.countOnLayer(layer.id);
              // Only interrupt when something would actually be lost.
              if (count > 0) {
                const word = count === 1 ? 'sound' : 'sounds';
                if (!window.confirm(`Remove ${layer.name} and its ${count} ${word}?`)) return;
              }
              session.removeLayer(layer.id);
            },
          },
        },
        ['×'],
      );

      const row = el('div', { class: 'tl__gutter-row' }, [name, mute, solo, level, remove]);
      toggleClass(row, 'is-automating', automating.has(layer.id));
      gutterRows.appendChild(row);

      const lane = el('div', {
        class: 'tl__lane',
        dataset: { layer: layer.id },
        on: {
          pointerdown: (event) => {
            // Only empty space. A sound handles its own presses.
            if (event.target !== lane) return;
            event.preventDefault();
            beginPress(event, lane, layer.id);
          },
        },
      });
      toggleClass(lane, 'is-muted', layer.muted);
      toggleClass(lane, 'is-automating', automating.has(layer.id));

      if (automating.has(layer.id)) {
        const auto = buildAutoLane(layer);
        autoLanes.set(layer.id, auto);
        lane.appendChild(auto);
      }

      laneNodes.set(layer.id, lane);
      lanes.appendChild(lane);
    }

    syncCues(project, true);

    gutterRows.appendChild(
      el('div', { class: 'tl__gutter-add' }, [
        button(
          {
            class: 'chip chip--sm',
            title: 'Add another layer',
            on: { click: () => session.addLayer() },
          },
          ['+ Layer'],
        ),
      ]),
    );
  }

  /**
   * Draw a layer's level over time.
   *
   * The shape is the whole point, so it is drawn as an area under a line
   * rather than as a line alone: at a glance you want to see where the layer
   * is loud, not trace a path. Points are drawn on top and can be taken hold
   * of. Everything is worked out from the same pixels per second the sounds
   * use, so the level always lines up with what it is controlling.
   */
  function drawAuto(lane: SVGSVGElement, points: readonly AutoPoint[], width: number): void {
    clear(lane);
    lane.setAttribute('width', String(width));
    lane.setAttribute('height', String(AUTO_HEIGHT));

    const y = (value: number): number =>
      AUTO_HEIGHT - (Math.max(0, Math.min(MAX_LEVEL, value)) / MAX_LEVEL) * AUTO_HEIGHT;
    const unity = y(1);

    lane.appendChild(
      svg('line', { class: 'tl__auto-unity', x1: 0, x2: width, y1: unity, y2: unity }),
    );

    if (!points.length) {
      lane.appendChild(
        svg('text', { class: 'tl__auto-hint', x: 8, y: AUTO_HEIGHT / 2 + 3 }, [])
      ).textContent = 'click to start drawing the level';
      return;
    }

    // Held flat before the first point and after the last, which is what the
    // level itself does, so the drawing cannot say something the sound does
    // not do.
    const steps = points.map((point) => `${point.t * pxPerSec},${y(point.value)}`);
    const first = `0,${y(points[0].value)}`;
    const last = `${width},${y(points[points.length - 1].value)}`;
    const line = [first, ...steps, last].join(' ');

    lane.appendChild(
      svg('polygon', {
        class: 'tl__auto-fill',
        points: `0,${AUTO_HEIGHT} ${line} ${width},${AUTO_HEIGHT}`,
      }),
    );
    lane.appendChild(svg('polyline', { class: 'tl__auto-line', points: line }));

    points.forEach((point, index) => {
      const dot = svg('circle', {
        class: 'tl__auto-point',
        cx: point.t * pxPerSec,
        cy: y(point.value),
        r: 4,
      });
      dot.dataset.index = String(index);
      lane.appendChild(dot);
    });
  }

  /** Where a pointer is on a level lane, in seconds and level. */
  function readAuto(event: PointerEvent, lane: SVGSVGElement): AutoPoint {
    const rect = lane.getBoundingClientRect();
    const t = Math.max(0, (event.clientX - rect.left) / pxPerSec);
    const level = ((rect.bottom - event.clientY) / AUTO_HEIGHT) * MAX_LEVEL;
    return { t, value: Math.max(0, Math.min(MAX_LEVEL, level)) };
  }

  /**
   * Build the lane for one layer and give it its behaviour.
   *
   * Dragging changes a copy and only writes the result back on release. The
   * alternative, writing on every movement, means a new project sixty times a
   * second, and the point being dragged is replaced underneath the pointer
   * each time.
   */
  function buildAutoLane(layer: Layer): SVGSVGElement {
    const lane = svg('svg', { class: 'tl__auto' });

    /*
     * Two presses in quick succession are worked out here rather than left to
     * the browser. Starting a drag has to stop the pointer selecting text as
     * it moves, and doing that also stops the browser reporting a double
     * click at all, so the second press is recognised by how soon it came.
     */
    let lastPress = { index: -1, at: 0 };

    lane.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const target = event.target as SVGElement;
      const existing = target.dataset?.index;

      // Working copy, so nothing is committed until the pointer is released.
      let points: AutoPoint[] = [...(session.project.layers.find((l) => l.id === layer.id)?.auto ?? [])];
      const near = existing !== undefined ? Number(existing) : nearestPoint(points, readAuto(event, lane));
      let index: number;

      if (near >= 0) {
        // A second press on the same point, soon after the first, takes it
        // away. Anywhere else is a new point.
        if (lastPress.index === near && event.timeStamp - lastPress.at < 400) {
          lastPress = { index: -1, at: 0 };
          session.removeAutoPoint(layer.id, near);
          return;
        }
        lastPress = { index: near, at: event.timeStamp };
        index = near;
      } else {
        lastPress = { index: -1, at: 0 };
        // Added and then found again by identity, since where it lands in
        // the list depends on its time rather than on when it was made.
        const added = readAuto(event, lane);
        points = [...points, added].sort((a, b) => a.t - b.t);
        index = points.indexOf(added);
      }

      const width = Number(lane.getAttribute('width')) || 1;
      drawAuto(lane, points, width);
      const dot = lane.querySelector(`[data-index="${index}"]`);
      dot?.classList.add('is-dragging');
      lane.setPointerCapture(event.pointerId);

      const move = (e: PointerEvent): void => {
        points[index] = readAuto(e, lane);
        drawAuto(lane, points, width);
        lane.querySelector(`[data-index="${index}"]`)?.classList.add('is-dragging');
      };
      const end = (): void => {
        lane.removeEventListener('pointermove', move);
        lane.removeEventListener('pointerup', end);
        lane.removeEventListener('pointercancel', end);
        session.setAuto(layer.id, [...points].sort((a, b) => a.t - b.t));
      };

      lane.addEventListener('pointermove', move);
      lane.addEventListener('pointerup', end);
      lane.addEventListener('pointercancel', end);
    });

    return lane;
  }

  /** Which point the pointer is on top of, or -1 for none. */
  function nearestPoint(points: readonly AutoPoint[], at: AutoPoint): number {
    for (let i = 0; i < points.length; i++) {
      const dx = (points[i].t - at.t) * pxPerSec;
      const dy = ((points[i].value - at.value) / MAX_LEVEL) * AUTO_HEIGHT;
      if (Math.hypot(dx, dy) <= GRAB_RADIUS) return i;
    }
    return -1;
  }

  /** Turn a layer name into a field, and put it back when it is done. */
  function startRename(node: HTMLElement, id: string, current: string): void {
    const input = el('input', {
      class: 'tl__layer-input',
      type: 'text',
      attrs: { value: current, maxlength: '40' },
    }) as HTMLInputElement;

    // Putting the label back removes focus from the field, which fires blur
    // while this is still running. A flag set before any of the work is the
    // only guard that holds, because the field is still connected at that
    // instant.
    let done = false;
    const finish = (save: boolean): void => {
      if (done) return;
      done = true;
      const value = input.value;
      if (input.isConnected) input.replaceWith(node);
      if (save) session.renameLayer(id, value);
    };

    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') finish(false);
      // The timeline shortcuts must not fire while a name is being typed.
      event.stopPropagation();
    });

    node.replaceWith(input);
    input.focus();
    input.select();
  }

  /**
   * Bring the drawn sounds in line with the project.
   *
   * Only what changed is touched. A new sound adds one element, a moved one
   * has two styles rewritten, and a deleted one is removed. Everything else
   * is left alone, which is what keeps editing quick when there are hundreds
   * of them. Pass `positions` when the zoom changed, since then every one of
   * them has moved even though none of them were edited.
   */
  function syncCues(project: Project, positions = false): void {
    const present = new Set<string>();

    for (const cue of project.cues) {
      present.add(cue.id);
      const existing = cueNodes.get(cue.id);

      if (!existing) {
        const drawn = buildCue(cue);
        cueNodes.set(cue.id, drawn);
        laneNodes.get(cue.layerId)?.appendChild(drawn.node);
        continue;
      }

      const edited = existing.cue !== cue;
      if (!edited && !positions) continue;

      // The zoom moves everything without changing anything, so that case
      // only writes the two styles that depend on it.
      placeCue(existing.node, cue);
      if (!edited) continue;

      if (existing.cue.layerId !== cue.layerId) {
        laneNodes.get(cue.layerId)?.appendChild(existing.node);
      }
      restyleCue(existing, cue);
      existing.cue = cue;
    }

    for (const [id, entry] of cueNodes) {
      if (present.has(id)) continue;
      entry.node.remove();
      cueNodes.delete(id);
    }

    for (const id of marked) cueNodes.get(id)?.node.classList.add('is-selected');
  }

  /** The two styles that depend on the zoom. */
  function placeCue(node: HTMLElement, cue: Cue): void {
    node.style.left = `${cueStart(cue) * pxPerSec}px`;
    node.style.width = `${Math.max(10, cueLength(cue) * pxPerSec)}px`;
  }

  /** Everything else, only needed when the sound itself changed. */
  function restyleCue(drawn: DrawnCue, cue: Cue): void {
    toggleClass(drawn.node, 'is-muted', cue.muted);
    toggleClass(drawn.node, 'is-tail', cue.anchor === 'end');
    drawn.head.title = `${cue.source.name} at ${timecode(cue.time, session.project.fps)}`;
    const name = String(cue.source.name);
    if (drawn.label.textContent !== name) drawn.label.textContent = name;
  }

  /**
   * A cue is drawn as a solid head at the moment it is pinned to, with a
   * translucent tail showing how long it sounds for.
   *
   * Only the head takes pointer events. The tail is see-through in both
   * senses, so a long sound never stops you placing another one underneath
   * it, which is exactly what you do when a whoosh runs beneath an impact.
   */
  function buildCue(cue: Cue): DrawnCue {
    const start = cueStart(cue);
    const width = Math.max(10, cueLength(cue) * pxPerSec);
    const endAnchored = cue.anchor === 'end';
    const label = el('span', { class: 'cue__label', text: String(cue.source.name) });

    const head = el('div', {
      class: 'cue__head',
      title: `${cue.source.name} at ${timecode(cue.time, session.project.fps)}`,
      on: {
        pointerdown: (event) => {
          event.preventDefault();
          event.stopPropagation();

          const chosen = session.store.state.selection;
          if (event.shiftKey || event.metaKey || event.ctrlKey) {
            session.toggleSelected(cue.id);
            return;
          }

          // Taking hold of one that is already part of a group keeps the
          // group and moves all of it. Taking hold of anything else starts
          // again with that one.
          if (!chosen.includes(cue.id)) {
            session.select([cue.id]);
            session.audition(cue);
          }
          beginDrag(event, head);
        },
      },
    }, [label]);

    const node = el('div', {
      class: 'cue',
      dataset: { cue: cue.id },
      style: { left: `${start * pxPerSec}px`, width: `${width}px` },
    }, [el('i', { class: 'cue__tail' }), head]);

    toggleClass(node, 'is-muted', cue.muted);
    toggleClass(node, 'is-tail', endAnchored);
    return { node, head, label, cue };
  }

  /**
   * Drag along the lane to retime, taking everything chosen along.
   *
   * Moved by how far the pointer has come since the last movement rather than
   * since the start, because what is being moved is a group whose shape has
   * to survive being pushed against either end of the piece.
   */
  function beginDrag(event: PointerEvent, node: HTMLElement): void {
    const startX = event.clientX;
    let applied = 0;
    node.setPointerCapture(event.pointerId);

    const move = (e: PointerEvent): void => {
      if (Math.abs(e.clientX - startX) < 3) return;
      const wanted = (e.clientX - startX) / pxPerSec;
      session.moveSelection(wanted - applied);
      applied = wanted;
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
      undo.disabled = !session.canUndo;
      redo.disabled = !session.canRedo;
      // Only the ones losing the mark and the ones gaining it, rather than
      // every sound on the timeline on every change.
      if (state.selection !== marked) {
        const now = new Set(state.selection);
        for (const id of marked) {
          if (!now.has(id)) cueNodes.get(id)?.node.classList.remove('is-selected');
        }
        for (const id of state.selection) cueNodes.get(id)?.node.classList.add('is-selected');
        marked = state.selection;
      }

      const { detect } = state;
      const working = detect.status === 'scanning' || detect.status === 'pinning';
      findButton.disabled = working || !state.videoReady;
      setText(
        findButton,
        working
          ? `${detect.status === 'scanning' ? 'Reading' : 'Pinning'} ${Math.round(detect.progress * 100)}%`
          : 'Find hits',
      );

      const ready = detect.status === 'ready';
      detectGroup.classList.toggle('is-ready', ready);
      sensitivity.value = String(detect.sensitivity);
      setText(found, ready ? `${detect.peaks.length} hits` : '');

      strip.draw(state, pxPerSec);
    },

    relayout() {
      // A shorter panel may have scrolled the lanes out of reach.
      viewport.scrollTop = Math.min(viewport.scrollTop, viewport.scrollHeight);
      gutterRows.style.transform = `translateY(${-viewport.scrollTop}px)`;
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
      const entry = cueNodes.get(id);
      if (!entry) return;
      entry.node.classList.add('is-firing');
      window.setTimeout(() => entry.node.classList.remove('is-firing'), 140);
    },
  };
}
