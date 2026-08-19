import {
  DESIGN_DEFAULT_ANCHOR,
  DESIGN_DEFAULT_LENGTH,
  type Cue,
  type CueSource,
  type DesignName,
  type Layer,
  type Project,
  type SnapMode,
} from './types.ts';

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
    layers: STARTER_LAYERS.map((l) => ({ ...l, muted: false, solo: false, gain: 1 })),
    cues: [],
    bpm: 120,
    snap: 'frame',
  };
}

let counter = 0;

/** Ids only need to be unique within a session. */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}${counter.toString(36)}`;
}

export function makeCue(time: number, layerId: string, source: CueSource): Cue {
  const design = source.kind === 'design' ? (source.name as DesignName) : null;
  return {
    id: newId('c'),
    time: Math.max(0, time),
    layerId,
    source,
    gain: 1,
    tune: 0,
    length: design ? DESIGN_DEFAULT_LENGTH[design] : 0.4,
    anchor: design ? DESIGN_DEFAULT_ANCHOR[design] : 'start',
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

/** Level for a cue once its layer's level is applied. */
export function cueGain(project: Project, cue: Cue): number {
  const layer = project.layers.find((l) => l.id === cue.layerId);
  return cue.gain * (layer ? layer.gain : 1);
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
}

export function toSession(project: Project): SessionFile {
  return { format: 'beat-studio-session', version: 1, project };
}

/**
 * Read a session file. Everything is checked, because the file came off disk
 * and may be from an older version. Returns null if it is not usable.
 */
export function fromSession(raw: unknown): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  const file = raw as Partial<SessionFile>;
  if (file.format !== 'beat-studio-session' || !file.project) return null;

  const base = emptyProject();
  const p = file.project as Partial<Project>;

  const layers = Array.isArray(p.layers) && p.layers.length ? p.layers : base.layers;
  const known = new Set(layers.map((l) => l.id));

  const cues = Array.isArray(p.cues)
    ? p.cues.filter(
        (c): c is Cue =>
          !!c &&
          typeof c.time === 'number' &&
          Number.isFinite(c.time) &&
          typeof c.layerId === 'string' &&
          known.has(c.layerId) &&
          !!c.source,
      )
    : [];

  return {
    ...base,
    fps: typeof p.fps === 'number' && p.fps > 0 ? p.fps : base.fps,
    duration: typeof p.duration === 'number' && p.duration >= 0 ? p.duration : 0,
    videoName: typeof p.videoName === 'string' ? p.videoName : null,
    bpm: typeof p.bpm === 'number' && p.bpm > 0 ? p.bpm : base.bpm,
    snap: p.snap === 'off' || p.snap === 'beat' || p.snap === 'frame' ? p.snap : base.snap,
    layers,
    cues,
  };
}
