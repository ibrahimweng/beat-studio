import type { SoundDesignSession } from '../../sound-design-session.ts';
import type { AppState } from '../../store.ts';
import { bendFor, cueLength, cueStart, shape, timecode } from '../../timeline/project.ts';
import {
  LANES,
  type AutoPoint,
  type Cue,
  type LaneName,
  type LaneSpec,
  type Layer,
  type Project,
} from '../../timeline/types.ts';
import { button, clear, el, setText, svg, toggleClass } from '../dom.ts';
import type { View } from '../view.ts';
import { helpButton } from '../help.ts';
import { createMotionStrip } from './motion-strip.ts';

const MIN_PX_PER_SEC = 8;
const MAX_PX_PER_SEC = 600;

/** Height of an open lane, matching --tl-auto in the stylesheet. */
const AUTO_HEIGHT = 46;
/**
 * Height of one that is closed, matching --tl-auto-shut.
 *
 * Closed rather than hidden. A lane you cannot see is a lane you forget you
 * drew, so a closed one still shows its shape, small, and opens when clicked.
 */
const SHUT_HEIGHT = 16;
/** How near the pointer has to be to grab a point rather than add one. */
const GRAB_RADIUS = 7;
/** How near, in pixels, a value has to land to be taken as exactly that. */
const SNAP_PX = 3;
/** How small a bend counts as no bend at all. */
const STRAIGHT = 0.06;
/**
 * How wide a drawn sound has to be before it offers an edge to drag.
 *
 * Narrower than this and the handle would cover the whole of it, so taking
 * hold to move it would be a game of chance. Zooming in brings the handle
 * back.
 */
const GRIP_MIN_PX = 18;

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
   * Which layers are showing their curves, and which lanes are open on them.
   *
   * Kept here rather than in the project. What you are looking at is about
   * what you are doing at this moment, not about the piece, and a session
   * that reopened with twelve lanes expanded because of what someone was
   * doing a fortnight ago would be a nuisance rather than a convenience.
   */
  const opened = new Map<string, Set<LaneName>>();
  /** Each drawn lane, so it can be redrawn on its own. */
  const autoLanes = new Map<string, SVGSVGElement>();
  /** Which sounds currently carry the chosen mark. */
  let marked: readonly string[] = [];
  const laneNodes = new Map<string, HTMLElement>();
  const strip = createMotionStrip(session);

  const ruler = el('div', { class: 'tl__ruler' });
  const lanes = el('div', { class: 'tl__lanes' });
  // Marks where the video stops, so the empty space beyond it reads as empty.
  const beyond = el('div', { class: 'tl__beyond' });
  const playhead = el('div', { class: 'tl__playhead' }, [
    // A handle wide enough to catch, since a line one pixel across is not
    // something anybody can reliably put a pointer on.
    el('div', { class: 'tl__playhead-grip', on: { pointerdown: scrubFrom } }),
  ]);
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

  const status = el('div', { class: 'tl__status' });

  const zoomOut = button({ class: 'chip chip--sm', title: 'Zoom out', on: { click: () => setZoom(pxPerSec / 1.6) } }, ['−']);
  const zoomIn = button({ class: 'chip chip--sm', title: 'Zoom in', on: { click: () => setZoom(pxPerSec * 1.6) } }, ['+']);
  const zoomFit = button({ class: 'chip chip--sm', title: 'Fit the whole video', on: { click: fit } }, ['Fit']);

  const root = el('section', { class: 'tl' }, [
    el('div', { class: 'tl__bar' }, [
      el('div', { class: 'micro-label section-title--asks' }, [
        el('span', { text: 'Timeline' }),
        helpButton('timeline', 'the timeline'),
      ]),
      undo,
      redo,
      helpButton('edit', 'editing on the timeline'),
      detectGroup,
      el('div', { class: 'dock__spacer' }),
      /*
       * What the app has to say, on the screen it is being said about.
       *
       * The session writes a status line for everything it does — a file
       * exported, a session opened, a clip that could not be kept — and until
       * now the only place it was drawn was the dock at the bottom of the
       * instrument screens. So the messages about the timeline were the ones
       * you could not see.
       */
      status,
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

  /**
   * Drag the ruler to move the playhead.
   *
   * On the ruler and on the playhead's own grip rather than anywhere on the
   * lanes, because the lanes already mean something: a press there places a
   * sound or draws a selection, and a timeline where clicking the work area
   * also jumps the playhead is one where every misclick loses your place.
   *
   * The move and up are listened for on the window rather than on what was
   * pressed, so a drag that wanders off the ruler — up into the bar, or down
   * over the lanes — keeps scrubbing until it is let go.
   */
  function scrubFrom(event: PointerEvent): void {
    event.preventDefault();
    const wasPlaying = session.playing;
    if (wasPlaying) session.pause();

    const to = (at: PointerEvent): void => {
      const rect = content.getBoundingClientRect();
      session.seek(Math.max(0, (at.clientX - rect.left) / pxPerSec));
    };

    const move = (at: PointerEvent): void => to(at);
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      // Picked up where it was put down, so scrubbing during playback is a
      // way of moving about rather than a way of stopping.
      if (wasPlaying) session.togglePlay();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    to(event);
  }

  ruler.addEventListener('pointerdown', scrubFrom);

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

  /** Where one layer's lane lives, since a layer has more than one. */
  function laneKey(layerId: string, lane: LaneName): string {
    return `${layerId}:${lane}`;
  }

  /**
   * Show or hide a layer's curves.
   *
   * Opening shows whatever is already drawn on it, and the level when nothing
   * is, since that is what someone reaching for this wants first almost every
   * time. The other lanes are still there underneath, closed.
   */
  function toggleLayer(layer: Layer): void {
    if (opened.has(layer.id)) {
      opened.delete(layer.id);
      return;
    }
    const drawn = LANES.filter((lane) => layer.auto[lane.name].length).map((lane) => lane.name);
    opened.set(layer.id, new Set(drawn.length ? drawn : ['level']));
  }

  /** Open or close one lane on a layer that is already showing its curves. */
  function toggleLane(layerId: string, name: LaneName): void {
    const showing = opened.get(layerId);
    if (!showing) return;
    if (showing.has(name)) showing.delete(name);
    else showing.add(name);
  }

  /** Draw every lane on show against the current zoom. */
  function paintAuto(project: Project): void {
    // The laid out width rather than the width the clip works out to. A
    // timeline shorter than the window is stretched to fill it, and sounds
    // can be placed anywhere in that space, so a curve has to reach there
    // too or it would run out partway across a lane you can still click on.
    const width = Math.max(
      content.clientWidth,
      Math.round(Math.max(project.duration, 1) * pxPerSec + 24),
    );
    for (const layer of project.layers) {
      const showing = opened.get(layer.id);
      if (!showing) continue;
      for (const spec of LANES) {
        const node = autoLanes.get(laneKey(layer.id, spec.name));
        if (!node) continue;
        const open = showing.has(spec.name);
        drawAuto(node, spec, layer.auto[spec.name], width, open ? AUTO_HEIGHT : SHUT_HEIGHT, open);
      }
    }
  }

  /**
   * Whether the layers themselves changed, as opposed to what is drawn on
   * them.
   *
   * Drawing a curve makes a new layer list on every movement of the pointer.
   * Treating that as the layers having changed would rebuild every lane and
   * every sound on them, sixty times a second, while someone drags a point.
   *
   * Whether a lane is empty does count, because the row beside it says so: a
   * lane with something on it offers a way to clear it and an empty one has
   * nothing to clear. That happens once, on the first point and on the last.
   */
  function sameLayers(before: readonly Layer[], after: readonly Layer[]): boolean {
    if (before.length !== after.length) return false;
    return before.every((layer, i) => {
      const now = after[i];
      return (
        layer.id === now.id &&
        layer.name === now.name &&
        layer.muted === now.muted &&
        layer.solo === now.solo &&
        LANES.every((lane) => !layer.auto[lane.name].length === !now.auto[lane.name].length)
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

      const curves = button(
        {
          class: 'tl__layer-btn',
          title:
            `Draw ${layer.name}'s level, position and room over time. Click a ` +
            'lane to add a point, drag to move it, click it twice to take it away.',
          on: {
            click: () => {
              toggleLayer(layer);
              paint(session.project, true);
            },
          },
        },
        ['A'],
      );
      toggleClass(curves, 'is-on', opened.has(layer.id));

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

      const row = el('div', { class: 'tl__gutter-row' }, [name, mute, solo, curves, remove]);
      toggleClass(row, 'is-automating', opened.has(layer.id));
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
      toggleClass(lane, 'is-automating', opened.has(layer.id));

      laneNodes.set(layer.id, lane);
      lanes.appendChild(lane);

      // The curves sit under the layer rather than inside it, in both columns
      // at once, so the names on the left cannot slide out of line with the
      // shapes on the right however many lanes are open.
      const showing = opened.get(layer.id);
      if (!showing) continue;

      for (const spec of LANES) {
        const open = showing.has(spec.name);
        const height = open ? AUTO_HEIGHT : SHUT_HEIGHT;
        // The last one closes the layer off, so the next layer down does not
        // read as another lane of this one.
        const last = spec === LANES[LANES.length - 1];

        const named = buildLaneName(layer, spec, open, height);
        toggleClass(named, 'is-last', last);
        gutterRows.appendChild(named);

        const strip = buildAutoLane(layer, spec, open, height);
        toggleClass(strip, 'is-last', last);
        autoLanes.set(laneKey(layer.id, spec.name), strip);
        lanes.appendChild(strip);
      }
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
   * The name beside a lane, which is also how it is opened and closed.
   *
   * One row per lane whether it is open or not, at the same height as the
   * lane itself, because these two columns are read across.
   */
  function buildLaneName(layer: Layer, spec: LaneSpec, open: boolean, height: number): HTMLElement {
    const name = button(
      {
        class: 'tl__lane-name',
        title: spec.about,
        on: {
          click: () => {
            toggleLane(layer.id, spec.name);
            paint(session.project, true);
          },
        },
      },
      [spec.label],
    );

    const parts: HTMLElement[] = [name];
    // Only where there is something to clear, and only on an open lane, so a
    // row of closed ones stays quiet.
    if (open && layer.auto[spec.name].length) {
      parts.push(
        button(
          {
            class: 'tl__layer-btn tl__layer-btn--remove',
            title: `Take away everything drawn on ${layer.name}'s ${spec.label.toLowerCase()}`,
            on: { click: () => session.setAuto(layer.id, spec.name, []) },
          },
          ['×'],
        ),
      );
    }

    const row = el('div', { class: 'tl__gutter-lane', style: { height: `${height}px` } }, parts);
    toggleClass(row, 'is-shut', !open);
    return row;
  }

  /**
   * Draw one of a layer's curves over time.
   *
   * The shape is the whole point, so it is drawn as an area under a line
   * rather than as a line alone: at a glance you want to see where the layer
   * is loud, not trace a path. Points are drawn on top and can be taken hold
   * of. Everything is worked out from the same pixels per second the sounds
   * use, so a curve always lines up with what it is controlling.
   *
   * A closed lane is the same drawing at a sixth of the height, without the
   * guide line or the points: enough to see that something is there and
   * roughly what shape it is, and not enough to be edited by accident.
   */
  function drawAuto(
    node: SVGSVGElement,
    spec: LaneSpec,
    points: readonly AutoPoint[],
    width: number,
    height: number,
    open: boolean,
  ): void {
    clear(node);
    node.setAttribute('width', String(width));
    node.setAttribute('height', String(height));

    const span = spec.max - spec.min;
    const y = (value: number): number =>
      height - ((Math.max(spec.min, Math.min(spec.max, value)) - spec.min) / span) * height;
    const rest = y(spec.neutral);

    // Where the lane does nothing, so a shape can be read against something.
    if (open) {
      node.appendChild(svg('line', { class: 'tl__auto-unity', x1: 0, x2: width, y1: rest, y2: rest }));
    }

    if (!points.length) {
      if (open) {
        node.appendChild(
          svg('text', { class: 'tl__auto-hint', x: 8, y: height / 2 + 3 }, []),
        ).textContent = `click to start drawing ${spec.label.toLowerCase()}`;
      }
      return;
    }

    // Held flat before the first point and after the last, which is what the
    // lane itself does, so the drawing cannot say something the sound does
    // not do. Between them it follows whatever shape each segment was given,
    // read from the same place the sound reads it.
    const steps = outline(points, y);
    const first = `0,${y(points[0].value)}`;
    const last = `${width},${y(points[points.length - 1].value)}`;
    const line = [first, ...steps, last].join(' ');
    const base = spec.base === 'neutral' ? rest : height;

    node.appendChild(
      svg('polygon', { class: 'tl__auto-fill', points: `0,${base} ${line} ${width},${base}` }),
    );
    node.appendChild(svg('polyline', { class: 'tl__auto-line', points: line }));

    if (!open) return;

    // The handle for each segment's shape, on the line at its middle, so it
    // is where the shape is rather than off to one side of it. Only where the
    // two ends differ: a segment that starts and finishes at the same value
    // is a flat line whatever shape it is given.
    points.forEach((point, index) => {
      const previous = points[index - 1];
      if (!previous || previous.value === point.value) return;

      const middle = (previous.t + point.t) / 2;
      const along = shape(0.5, point.curve);
      const held = point.curve === 'hold';
      const handle = held
        ? svg('rect', {
            class: 'tl__auto-bend is-held',
            x: middle * pxPerSec - 3.5,
            y: y(previous.value + along * (point.value - previous.value)) - 3.5,
            width: 7,
            height: 7,
          })
        : svg('circle', {
            class: 'tl__auto-bend',
            cx: middle * pxPerSec,
            cy: y(previous.value + along * (point.value - previous.value)),
            r: 4,
          });
      toggleClass(handle, 'is-bent', typeof point.curve === 'number' && point.curve !== 0);
      handle.dataset.bend = String(index);
      node.appendChild(handle);
    });

    points.forEach((point, index) => {
      const dot = svg('circle', {
        class: 'tl__auto-point',
        cx: point.t * pxPerSec,
        cy: y(point.value),
        r: 4,
      });
      dot.dataset.index = String(index);
      node.appendChild(dot);
    });
  }

  /**
   * The drawn shape of a lane between its points, in the lane's own pixels.
   *
   * A straight segment is two ends and nothing in between. A held one is a
   * flat run and then a vertical step. A bent one is sampled every few pixels,
   * so it is as smooth as the zoom it is drawn at and no smoother.
   */
  function outline(points: readonly AutoPoint[], y: (value: number) => number): string[] {
    const drawn: string[] = [];

    points.forEach((point, index) => {
      const previous = points[index - 1];
      const x = point.t * pxPerSec;

      if (!previous) {
        drawn.push(`${x},${y(point.value)}`);
        return;
      }
      if (point.curve === 'hold') {
        drawn.push(`${x},${y(previous.value)}`);
        drawn.push(`${x},${y(point.value)}`);
        return;
      }
      if (typeof point.curve === 'number' && point.curve !== 0) {
        const span = point.t - previous.t;
        const steps = Math.max(2, Math.min(160, Math.round((span * pxPerSec) / 3)));
        for (let step = 1; step < steps; step++) {
          const u = step / steps;
          const along = shape(u, point.curve);
          drawn.push(
            `${(previous.t + u * span) * pxPerSec},` +
              `${y(previous.value + along * (point.value - previous.value))}`,
          );
        }
      }
      drawn.push(`${x},${y(point.value)}`);
    });

    return drawn;
  }

  /**
   * Where a pointer is on a lane, in seconds and in what the lane controls.
   *
   * The two ends and the resting value are landed on exactly when the pointer
   * comes near them. Off is off, hard over is hard over, and back in the
   * middle is back in the middle, and none of the three is reachable by hand
   * otherwise: the whole of a lane is forty six pixels, so the bottom of it
   * is the one row of them the pointer cannot be inside.
   */
  function readAuto(
    event: PointerEvent,
    node: SVGSVGElement,
    spec: LaneSpec,
    height: number,
  ): AutoPoint {
    const rect = node.getBoundingClientRect();
    const t = Math.max(0, (event.clientX - rect.left) / pxPerSec);
    const span = spec.max - spec.min;
    const raw = spec.min + ((rect.bottom - event.clientY) / height) * span;
    const value = Math.max(spec.min, Math.min(spec.max, raw));

    for (const mark of [spec.min, spec.max, spec.neutral]) {
      if (Math.abs(value - mark) * (height / span) <= SNAP_PX) return { t, value: mark };
    }
    return { t, value };
  }

  /**
   * Build one lane and give it its behaviour.
   *
   * Dragging changes a copy and only writes the result back on release. The
   * alternative, writing on every movement, means a new project sixty times a
   * second, and the point being dragged is replaced underneath the pointer
   * each time.
   */
  function buildAutoLane(
    layer: Layer,
    spec: LaneSpec,
    open: boolean,
    height: number,
  ): SVGSVGElement {
    const node = svg('svg', { class: 'tl__auto' });
    toggleClass(node, 'is-shut', !open);

    // A closed lane is there to be read, not drawn on, so a press opens it.
    if (!open) {
      node.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleLane(layer.id, spec.name);
        paint(session.project, true);
      });
      return node;
    }

    /*
     * Two presses in quick succession are worked out here rather than left to
     * the browser. Starting a drag has to stop the pointer selecting text as
     * it moves, and doing that also stops the browser reporting a double
     * click at all, so the second press is recognised by how soon it came.
     */
    let lastPress = { index: -1, at: 0 };

    node.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const target = event.target as SVGElement;
      const existing = target.dataset?.index;
      const bending = target.dataset?.bend;

      // Working copy, so nothing is committed until the pointer is released.
      const drawn = session.project.layers.find((l) => l.id === layer.id)?.auto[spec.name] ?? [];
      let points: AutoPoint[] = [...drawn];

      if (bending !== undefined) {
        beginBend(node, layer, spec, height, points, Number(bending), event);
        return;
      }
      const near =
        existing !== undefined
          ? Number(existing)
          : nearestPoint(points, readAuto(event, node, spec, height), spec, height);
      let index: number;

      if (near >= 0) {
        // A second press on the same point, soon after the first, takes it
        // away. Anywhere else is a new point.
        if (lastPress.index === near && event.timeStamp - lastPress.at < 400) {
          lastPress = { index: -1, at: 0 };
          session.removeAutoPoint(layer.id, spec.name, near);
          return;
        }
        lastPress = { index: near, at: event.timeStamp };
        index = near;
      } else {
        lastPress = { index: -1, at: 0 };
        // Added and then found again by identity, since where it lands in
        // the list depends on its time rather than on when it was made.
        const added: AutoPoint = readAuto(event, node, spec, height);
        points = [...points, added].sort((a, b) => a.t - b.t);
        index = points.indexOf(added);
        // A point dropped into a segment splits it in two, and both halves
        // keep the shape the whole had. Otherwise adding a point to a curve
        // would straighten out the half behind it.
        const split = points[index + 1];
        if (index > 0 && split?.curve !== undefined) added.curve = split.curve;
      }

      const width = Number(node.getAttribute('width')) || 1;
      drawAuto(node, spec, points, width, height, true);
      node.querySelector(`[data-index="${index}"]`)?.classList.add('is-dragging');
      node.setPointerCapture(event.pointerId);

      const move = (e: PointerEvent): void => {
        // Spread over the point it replaces, so moving one does not straighten
        // out the shape it was arrived at by.
        points[index] = { ...points[index], ...readAuto(e, node, spec, height) };
        drawAuto(node, spec, points, width, height, true);
        node.querySelector(`[data-index="${index}"]`)?.classList.add('is-dragging');
      };
      const end = (): void => {
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', end);
        node.removeEventListener('pointercancel', end);
        session.setAuto(layer.id, spec.name, [...points].sort((a, b) => a.t - b.t));
      };

      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', end);
      node.addEventListener('pointercancel', end);
    });

    return node;
  }

  /**
   * Drag a segment's handle to bend it, or press it and let go to hold it.
   *
   * Two things on one handle because they are two answers to the same
   * question: what happens between these two points. A drag says how it gets
   * there, and a press says that it does not, keeping the earlier value and
   * stepping across on arrival, which is what a cut wants and what no amount
   * of bending can do.
   */
  function beginBend(
    node: SVGSVGElement,
    layer: Layer,
    spec: LaneSpec,
    height: number,
    points: AutoPoint[],
    index: number,
    event: PointerEvent,
  ): void {
    const previous = points[index - 1];
    const point = points[index];
    if (!previous || !point || previous.value === point.value) return;

    const width = Number(node.getAttribute('width')) || 1;
    const startY = event.clientY;
    let moved = false;
    node.setPointerCapture(event.pointerId);

    const move = (e: PointerEvent): void => {
      if (!moved && Math.abs(e.clientY - startY) < 3) return;
      moved = true;

      // How far up the segment the pointer is asking the middle to sit, as a
      // fraction of the way from one end to the other. The bend that puts it
      // there is worked out from that, so the handle stays under the hand.
      const at = readAuto(e, node, spec, height).value;
      const bend = bendFor((at - previous.value) / (point.value - previous.value));
      points[index] = {
        ...point,
        curve: Math.abs(bend) < STRAIGHT ? undefined : bend,
      };
      drawAuto(node, spec, points, width, height, true);
    };

    const end = (): void => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);

      if (!moved) {
        // A press that went nowhere turns the hold on, or off again.
        points[index] = { ...point, curve: point.curve === 'hold' ? undefined : 'hold' };
      }
      session.setAuto(layer.id, spec.name, points, 'shape');
    };

    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
  }

  /** Which point the pointer is on top of, or -1 for none. */
  function nearestPoint(
    points: readonly AutoPoint[],
    at: AutoPoint,
    spec: LaneSpec,
    height: number,
  ): number {
    for (let i = 0; i < points.length; i++) {
      const dx = (points[i].t - at.t) * pxPerSec;
      const dy = ((points[i].value - at.value) / (spec.max - spec.min)) * height;
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

  /** The two styles that depend on the zoom, and whether there is room to grab. */
  function placeCue(node: HTMLElement, cue: Cue): void {
    const width = Math.max(10, cueLength(cue) * pxPerSec);
    node.style.left = `${cueStart(cue) * pxPerSec}px`;
    node.style.width = `${width}px`;
    toggleClass(node, 'is-wide', width >= GRIP_MIN_PX);
  }

  /**
   * What a cue is called on the timeline.
   *
   * A stacked sound says so, because a lane full of things that all read
   * "impact" when one of them is an impact with a metallic ring over it is a
   * lane you have to click through to understand.
   */
  function cueName(cue: Cue): string {
    const on = cue.source.with?.length ?? 0;
    return on ? `${cue.source.name} +${on}` : String(cue.source.name);
  }

  /** The whole of it, for a tooltip, where there is room to say it. */
  function cueTitle(cue: Cue): string {
    const on = cue.source.with ?? [];
    const made = on.length ? `${cue.source.name} with ${on.map((p) => p.name).join(' and ')}` : cue.source.name;
    return `${made} at ${timecode(cue.time, session.project.fps)}`;
  }

  /** Everything else, only needed when the sound itself changed. */
  function restyleCue(drawn: DrawnCue, cue: Cue): void {
    toggleClass(drawn.node, 'is-muted', cue.muted);
    toggleClass(drawn.node, 'is-tail', cue.anchor === 'end');
    drawn.head.title = cueTitle(cue);
    const name = cueName(cue);
    if (drawn.label.textContent !== name) drawn.label.textContent = name;
  }

  /**
   * A cue is drawn as a solid head at the moment it is pinned to, with a
   * translucent tail showing how long it sounds for.
   *
   * Only the head and the handle on its free edge take pointer events. The
   * tail between them is see-through in both senses, so a long sound never
   * stops you placing another one underneath it, which is exactly what you do
   * when a whoosh runs beneath an impact.
   */
  function buildCue(cue: Cue): DrawnCue {
    const start = cueStart(cue);
    const width = Math.max(10, cueLength(cue) * pxPerSec);
    const endAnchored = cue.anchor === 'end';
    const label = el('span', { class: 'cue__label', text: cueName(cue) });

    const head = el('div', {
      class: 'cue__head',
      title: cueTitle(cue),
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

    // The far end from the head, which is the end that is free to move: a
    // sound that starts on a moment grows to the right, and one that ends on
    // a moment reaches back to the left.
    const grip = el('i', {
      class: 'cue__grip',
      title: 'Drag to change how long it sounds for',
      on: {
        pointerdown: (event) => {
          event.preventDefault();
          event.stopPropagation();

          // The stored sound rather than the one this was built from, since
          // which edge is free depends on the anchor and that can be changed
          // from the panel without the drawing being rebuilt.
          const now = cueNodes.get(cue.id)?.cue;
          if (!now) return;

          if (!session.store.state.selection.includes(cue.id)) session.select([cue.id]);
          beginResize(event, grip, now);
        },
      },
    });

    const node = el('div', {
      class: 'cue',
      dataset: { cue: cue.id },
      style: { left: `${start * pxPerSec}px`, width: `${width}px` },
    }, [el('i', { class: 'cue__tail' }), head, grip]);

    toggleClass(node, 'is-muted', cue.muted);
    toggleClass(node, 'is-tail', endAnchored);
    toggleClass(node, 'is-wide', width >= GRIP_MIN_PX);
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

  /**
   * Drag the free edge of a sound to change how long it sounds for.
   *
   * The same shape as retiming: how far the pointer has come since the last
   * movement, handed to the session, which holds the whole group at both ends
   * before any of it changes. Everything chosen is resized together, so
   * trimming six footsteps at once is one gesture and one thing to undo.
   */
  function beginResize(event: PointerEvent, node: HTMLElement, cue: Cue): void {
    const startX = event.clientX;
    // A sound pinned to its end reaches back from the moment, so its free
    // edge is on the left and dragging left is what makes it longer.
    const direction = cue.anchor === 'end' ? -1 : 1;
    /*
     * Where the stored length differs from the drawn one, the drawing wins.
     * A sound that ends on a moment near the start of the video is drawn
     * shorter than it is, because it cannot begin before the video does, and
     * the edge under the pointer is the drawn one. Counting that difference
     * as already applied brings the stored length up to meet the pointer on
     * the first movement, so the edge follows the hand from the outset
     * instead of sitting still until the two agree.
     */
    let applied = cue.length - cueLength(cue);
    const before = cue.length;

    node.setPointerCapture(event.pointerId);
    root.classList.add('is-resizing');

    const move = (e: PointerEvent): void => {
      if (Math.abs(e.clientX - startX) < 3) return;
      const wanted = ((e.clientX - startX) / pxPerSec) * direction;
      session.resizeSelection(wanted - applied);
      applied = wanted;
    };

    const end = (): void => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
      root.classList.remove('is-resizing');

      // Hear what it turned into. Playing it while the edge was still moving
      // would be a stutter of half-finished lengths; once is useful.
      const after = cueNodes.get(cue.id)?.cue;
      if (after && after.length !== before) session.audition(after);
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
      // What was said last, or what there is, which is worth knowing anyway.
      const count = state.project.cues.length;
      setText(status, state.status ?? `${count} sound${count === 1 ? '' : 's'}`);
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
