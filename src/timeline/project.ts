import { packSpec } from '../audio/pack.ts';
import { PAD_MIDI } from '../constants.ts';
import type { PadName } from '../types.ts';
import type { AutoPoint } from './types.ts';
import {
  DEFAULT_CHARACTER,
  DESIGN_CHARACTER,
  DESIGN_DEFAULT_ANCHOR,
  DESIGN_DEFAULT_LENGTH,
  DESIGN_NAMES,
  LANES,
  type Cue,
  type CueSource,
  type DesignName,
  type LaneName,
  type Lanes,
  type Layer,
  type Project,
  type SnapMode,
} from './types.ts';

/** A layer with nothing drawn on it. Fresh arrays, since layers are edited. */
export function emptyLanes(): Lanes {
  return { level: [], pan: [], space: [] };
}

/** Layers a new project starts with, in the order they are drawn. */
const STARTER_LAYERS: readonly { id: string; name: string }[] = [
  { id: 'impacts', name: 'Impacts' },
  { id: 'movement', name: 'Movement' },
  { id: 'detail', name: 'Detail' },
  { id: 'tone', name: 'Tone' },
];

export const DEFAULT_FPS = 30;

/** Frame rates worth offering. Anything else can be typed in. */
export const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60] as const;

export function emptyProject(): Project {
  return {
    fps: DEFAULT_FPS,
    duration: 0,
    videoName: null,
    layers: STARTER_LAYERS.map((l) => ({ ...l, muted: false, solo: false, gain: 1, auto: emptyLanes() })),
    cues: [],
    bpm: 120,
    snap: 'frame',
  };
}

let counter = 0;
/** Every id handed out or read from a file, so none of them is used twice. */
const usedIds = new Set<string>();

/** Ids only need to be unique within a session. */
export function newId(prefix: string): string {
  let id: string;
  do {
    counter += 1;
    id = `${prefix}${counter.toString(36)}`;
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

/**
 * Remember ids that came out of a session file.
 *
 * A file brings its own ids with it, and the counter behind {@link newId}
 * knows nothing about them. Without this, the next sound placed after opening
 * a session could be handed an id the file had already used, and the two
 * would be treated as one.
 */
function reserveIds(ids: Iterable<string>): void {
  for (const id of ids) usedIds.add(id);
}

export function makeCue(time: number, layerId: string, source: CueSource): Cue {
  const design = source.kind === 'design' ? (source.name as DesignName) : null;
  // A pack sound was written at a length of its own, so that is what it
  // starts at rather than a number this app picked.
  const packed = source.kind === 'pack' && source.pack ? packSpec(source.pack, source.name) : null;
  return {
    id: newId('c'),
    time: Math.max(0, time),
    layerId,
    source,
    gain: 1,
    tune: 0,
    length: design ? DESIGN_DEFAULT_LENGTH[design] : (packed?.duration ?? 0.4),
    anchor: design ? DESIGN_DEFAULT_ANCHOR[design] : 'start',
    ...(design ? DESIGN_CHARACTER[design] : DEFAULT_CHARACTER[source.kind]),
    muted: false,
  };
}

/** Seconds per frame at the project's rate. */
export function frameDuration(project: Project): number {
  return 1 / (project.fps || DEFAULT_FPS);
}

/** Round a time to whatever the project is snapping to. */
export function snapTime(project: Project, time: number): number {
  const t = Math.max(0, time);
  return applySnap(t, project.snap, project);
}

function applySnap(time: number, snap: SnapMode, project: Project): number {
  if (snap === 'off') return time;
  if (snap === 'beat') {
    const beat = 60 / (project.bpm || 120);
    return Math.round(time / beat) * beat;
  }
  const frame = frameDuration(project);
  return Math.round(time / frame) * frame;
}

/** Format a time as minutes, seconds and frames, e.g. "0:04:11". */
export function timecode(time: number, fps: number): string {
  const safe = Math.max(0, time);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const frames = Math.floor((safe % 1) * (fps || DEFAULT_FPS));
  return `${minutes}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

/** Cues that should be heard, taking mute and solo into account. */
export function audibleCues(project: Project): Cue[] {
  const soloed = project.layers.filter((l) => l.solo).map((l) => l.id);
  const allowed = new Set(
    soloed.length
      ? soloed
      : project.layers.filter((l) => !l.muted).map((l) => l.id),
  );
  return project.cues.filter((c) => !c.muted && allowed.has(c.layerId));
}

/**
 * Level for a cue once its layer's level is applied.
 *
 * A layer with a level drawn over time is not accounted for here, because
 * that level belongs to a moment rather than to a sound: it is applied to
 * everything on the layer at once, further down. See {@link laneValueAt}.
 */
export function cueGain(project: Project, cue: Cue): number {
  const layer = project.layers.find((l) => l.id === cue.layerId);
  if (!layer) return cue.gain;
  return cue.gain * (layer.auto.level.length ? 1 : layer.gain);
}

/**
 * What a drawn curve is worth at a moment, reading between its points.
 *
 * Held flat before the first point and after the last, which is what the
 * drawing shows, so the two cannot disagree. An empty lane is worth whatever
 * that lane means when nobody has drawn on it.
 */
export function laneValueAt(points: readonly AutoPoint[], t: number, fallback: number): number {
  if (!points.length) return fallback;
  if (t <= points[0].t) return points[0].value;

  const last = points[points.length - 1];
  if (t >= last.t) return last.value;

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    if (t > to.t) continue;
    const span = to.t - from.t;
    return span <= 0 ? to.value : from.value + ((t - from.t) / span) * (to.value - from.value);
  }
  return last.value;
}

/** A layer's level at a moment, drawn or fixed. */
export function layerLevelAt(layer: Layer, t: number): number {
  return laneValueAt(layer.auto.level, t, layer.gain);
}

/**
 * Write a drawn curve onto a parameter, over a stretch of the video.
 *
 * Used twice over. The file is written in one pass, from nothing to the end.
 * Playing writes only the fraction of a second ahead of where the video is,
 * again on every tick, so that what was drawn stays with the picture rather
 * than drifting away from it over a long piece.
 */
export function scheduleLane(
  param: AudioParam,
  points: readonly AutoPoint[],
  fallback: number,
  origin: number,
  from: number,
  to: number,
): void {
  if (to <= from) return;
  param.cancelScheduledValues(origin + from);
  param.setValueAtTime(laneValueAt(points, from, fallback), origin + from);
  for (const point of points) {
    if (point.t <= from || point.t > to) continue;
    param.linearRampToValueAtTime(point.value, origin + point.t);
  }
  param.linearRampToValueAtTime(laneValueAt(points, to, fallback), origin + to);
}

/** Take one point off one of a layer's curves. */
export function removeAutoPoint(
  project: Project,
  id: string,
  lane: LaneName,
  index: number,
): Project {
  const layer = project.layers.find((l) => l.id === id);
  if (!layer) return project;
  return updateLayer(project, id, {
    auto: { ...layer.auto, [lane]: layer.auto[lane].filter((_, i) => i !== index) },
  });
}

/**
 * How long a cue actually sounds for.
 *
 * A sound pinned by its end has to fit between the start of the video and its
 * marker. A two second riser placed one second in has only one second to run,
 * so it is shortened. Without this it would keep its full length, start at
 * zero and finish after the moment it was meant to lead into, which is the
 * one thing an end anchor exists to prevent.
 */
export function cueLength(cue: Cue): number {
  if (cue.anchor === 'end') return Math.min(cue.length, Math.max(0.02, cue.time));
  return cue.length;
}

/**
 * The moment a cue starts sounding.
 *
 * A cue anchored to its end finishes on its marker, so it begins one length
 * earlier, using the length it actually has room for.
 */
export function cueStart(cue: Cue): number {
  if (cue.anchor === 'end') return Math.max(0, cue.time - cueLength(cue));
  return cue.time;
}

export function sortCues(cues: readonly Cue[]): Cue[] {
  return [...cues].sort((a, b) => cueStart(a) - cueStart(b));
}

export function updateCue(project: Project, id: string, patch: Partial<Cue>): Project {
  return {
    ...project,
    cues: project.cues.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  };
}

export function removeCue(project: Project, id: string): Project {
  return { ...project, cues: project.cues.filter((c) => c.id !== id) };
}

/** Add a layer at the bottom of the list. */
export function addLayer(project: Project, name?: string): Project {
  const layer: Layer = {
    id: newId('l'),
    name: name?.trim() || `Layer ${project.layers.length + 1}`,
    muted: false,
    solo: false,
    gain: 1,
    auto: emptyLanes(),
  };
  return { ...project, layers: [...project.layers, layer] };
}

/**
 * Remove a layer and everything on it.
 *
 * The last layer is kept, because a project with nowhere to put a sound is
 * not a state worth being able to reach.
 */
export function removeLayer(project: Project, id: string): Project {
  if (project.layers.length <= 1) return project;
  return {
    ...project,
    layers: project.layers.filter((l) => l.id !== id),
    cues: project.cues.filter((c) => c.layerId !== id),
  };
}

/** How many sounds are on a layer, for warning before it is removed. */
export function cuesOnLayer(project: Project, id: string): number {
  return project.cues.filter((c) => c.layerId === id).length;
}

export function updateLayer(project: Project, id: string, patch: Partial<Layer>): Project {
  return {
    ...project,
    layers: project.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  };
}

/** A session file. The video is not included, only its name. */
export interface SessionFile {
  format: 'beat-studio-session';
  version: 1;
  project: Project;
  /**
   * The sound packs the project uses, as the files they came from.
   *
   * Carried along so the session is complete. Without them it would open
   * somewhere else with sounds on the timeline that nothing could play.
   */
  packs?: readonly unknown[];
  /** Sounds saved from the timeline that the project uses. */
  mine?: readonly unknown[];
}

export function toSession(
  project: Project,
  packs: readonly unknown[] = [],
  mine: readonly unknown[] = [],
): SessionFile {
  return {
    format: 'beat-studio-session',
    version: 1,
    project,
    ...(packs.length ? { packs } : {}),
    ...(mine.length ? { mine } : {}),
  };
}

/**
 * The widest values the controls offer.
 *
 * A file is held to these, so a number nothing in the app could have set
 * cannot reach the audio graph or ask the renderer for an hour of silence.
 */
const MAX_GAIN = 1.5;
const MAX_TUNE = 24;
/** Shortest and longest a sound can be told to run for. */
export const MIN_LENGTH = 0.02;
export const MAX_LENGTH = 4;

/** A number out of a file, with a default and the range it has to sit in. */
function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

/**
 * Read the layers out of a session file.
 *
 * Every field is checked and filled in, because the file came off disk and
 * may have been written by an older version or edited by hand. Two layers
 * sharing an id would both answer to the same sounds, so the second is
 * dropped. A file with nothing usable in it falls back to the starter layers,
 * since a project with nowhere to put a sound is not a state worth reaching.
 */
function readLayers(raw: unknown, fallback: readonly Layer[]): Layer[] {
  if (!Array.isArray(raw)) return [...fallback];

  const layers: Layer[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const layer = item as Partial<Layer>;
    if (typeof layer.id !== 'string' || !layer.id || seen.has(layer.id)) continue;
    seen.add(layer.id);

    const name = typeof layer.name === 'string' ? layer.name.trim().slice(0, 40) : '';
    layers.push({
      id: layer.id,
      name: name || `Layer ${layers.length + 1}`,
      muted: layer.muted === true,
      solo: layer.solo === true,
      gain: readNumber(layer.gain, 1, 0, MAX_GAIN),
      auto: readLanes(layer.auto),
    });
  }

  return layers.length ? layers : [...fallback];
}

/**
 * Read a layer's curves.
 *
 * Sessions written before there was anything but a level hold a bare list of
 * points here, and those are still someone's work, so a list is read as the
 * level lane rather than thrown away.
 */
function readLanes(raw: unknown): Lanes {
  const lanes = emptyLanes();
  if (Array.isArray(raw)) {
    lanes.level = readAuto(raw, LANES[0]);
    return lanes;
  }
  if (!raw || typeof raw !== 'object') return lanes;

  const held = raw as Record<string, unknown>;
  for (const lane of LANES) lanes[lane.name] = readAuto(held[lane.name], lane);
  return lanes;
}

/** Read one curve, dropping anything that is not a point on it. */
function readAuto(raw: unknown, lane: { min: number; max: number; neutral: number }): AutoPoint[] {
  if (!Array.isArray(raw)) return [];
  const points: AutoPoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const point = item as Partial<AutoPoint>;
    if (typeof point.t !== 'number' || !Number.isFinite(point.t)) continue;
    points.push({
      t: Math.max(0, point.t),
      value: readNumber(point.value, lane.neutral, lane.min, lane.max),
    });
  }
  return points.sort((a, b) => a.t - b.t);
}

/**
 * Read what a sound points at.
 *
 * A name no voice answers to is not worth keeping: it would draw a sound on
 * the timeline that plays nothing at all.
 */
function readSource(raw: unknown): CueSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Partial<CueSource>;
  if (typeof source.name !== 'string') return null;

  if (source.kind === 'design') {
    return DESIGN_NAMES.includes(source.name as DesignName)
      ? { kind: 'design', name: source.name as DesignName }
      : null;
  }
  if (source.kind === 'kit') {
    return source.name in PAD_MIDI ? { kind: 'kit', name: source.name as PadName } : null;
  }
  if (source.kind === 'pack') {
    // The pack itself may not be loaded yet, so only the shape is checked
    // here. A sound whose pack is missing is drawn and simply does not play.
    return typeof source.pack === 'string' && source.pack
      ? { kind: 'pack', name: source.name, pack: source.pack }
      : null;
  }
  if (source.kind === 'pitched' && (source.name === 'piano' || source.name === 'guitar')) {
    return {
      kind: 'pitched',
      name: source.name,
      midi: Math.round(readNumber(source.midi, 60, 0, 127)),
    };
  }
  return null;
}

/**
 * Read the sounds out of a session file.
 *
 * A sound on a layer the file does not contain is dropped, because there
 * would be nowhere to draw it and nothing to play it. Everything else is
 * filled in from the defaults for that voice, since a length or a level that
 * is not a number would reach the audio graph and stop the project sounding
 * at all.
 */
function readCues(raw: unknown, known: ReadonlySet<string>): Cue[] {
  if (!Array.isArray(raw)) return [];

  const cues: Cue[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const cue = item as Partial<Cue>;
    if (typeof cue.time !== 'number' || !Number.isFinite(cue.time)) continue;
    if (typeof cue.layerId !== 'string' || !known.has(cue.layerId)) continue;

    const source = readSource(cue.source);
    if (!source) continue;

    const design = source.kind === 'design' ? (source.name as DesignName) : null;
    // A file that repeats an id, or shares one with a session opened earlier,
    // is given a fresh one rather than two sounds that move together.
    const id =
      typeof cue.id === 'string' && cue.id && !usedIds.has(cue.id) ? cue.id : newId('c');
    usedIds.add(id);

    cues.push({
      id,
      time: Math.max(0, cue.time),
      layerId: cue.layerId,
      source,
      gain: readNumber(cue.gain, 1, 0, MAX_GAIN),
      tune: Math.round(readNumber(cue.tune, 0, -MAX_TUNE, MAX_TUNE)),
      length: readNumber(
        cue.length,
        design ? DESIGN_DEFAULT_LENGTH[design] : 0.4,
        MIN_LENGTH,
        MAX_LENGTH,
      ),
      anchor:
        cue.anchor === 'end' || cue.anchor === 'start'
          ? cue.anchor
          : design
            ? DESIGN_DEFAULT_ANCHOR[design]
            : 'start',
      // Nothing rather than the voice's usual amount, because a session
      // written before these existed should open sounding as it did. A sound
      // placed from now on starts with its voice's own character.
      space: readNumber(cue.space, 0, 0, 1),
      drive: readNumber(cue.drive, 0, 0, 1),
      muted: cue.muted === true,
    });
  }

  return cues;
}

/**
 * Read a session file. Everything is checked, because the file came off disk
 * and may be from an older version. Returns null if it is not usable.
 */
export function fromSession(
  raw: unknown,
): { project: Project; packs: unknown[]; mine: unknown[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const file = raw as Partial<SessionFile>;
  if (file.format !== 'beat-studio-session' || !file.project) return null;

  const base = emptyProject();
  const p = file.project as Partial<Project>;

  // Layers first: a sound can only be kept if the layer it names survived.
  const layers = readLayers(p.layers, base.layers);
  reserveIds(layers.map((l) => l.id));
  const cues = readCues(p.cues, new Set(layers.map((l) => l.id)));

  const project = {
    ...base,
    fps: typeof p.fps === 'number' && p.fps > 0 ? p.fps : base.fps,
    duration: typeof p.duration === 'number' && p.duration >= 0 ? p.duration : 0,
    videoName: typeof p.videoName === 'string' ? p.videoName : null,
    bpm: typeof p.bpm === 'number' && p.bpm > 0 ? p.bpm : base.bpm,
    snap: p.snap === 'off' || p.snap === 'beat' || p.snap === 'frame' ? p.snap : base.snap,
    layers,
    cues,
  };

  return {
    project,
    packs: Array.isArray(file.packs) ? file.packs : [],
    mine: Array.isArray(file.mine) ? file.mine : [],
  };
}
