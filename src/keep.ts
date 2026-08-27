import { fromSession, toSession } from './timeline/project.ts';
import type { Project } from './timeline/types.ts';

/**
 * Keeping the piece you are working on, so a reload does not lose it.
 *
 * Everything the app made was already kept between sessions — the patterns,
 * the packs, the sounds you saved — except the one thing that takes the
 * longest to make, which was the timeline itself. Refreshing the page threw
 * it away, and a browser refreshes for reasons that have nothing to do with
 * you: a crash, an update, a stray keystroke.
 *
 * Two stores, because the piece and the picture are different sizes.
 *
 * The project is tens of kilobytes and is wanted the instant the app opens,
 * so it goes in localStorage, which can be read without waiting. The video is
 * megabytes, which localStorage cannot hold at all, so it goes in IndexedDB
 * and arrives a moment later. That split is why your work is on screen before
 * the picture is, rather than the page sitting empty until both are ready.
 *
 * Nothing here is uploaded. Both stores are in this browser, on this machine,
 * exactly like the video itself.
 */

/** Where the piece is kept. */
const WORK_KEY = 'toolcraft.st88.work';

/** How long a run of edits settles before it is written. */
const SETTLE_MS = 800;

// ---------- the piece ----------

let pending: ReturnType<typeof setTimeout> | null = null;
let waiting: Project | null = null;

/**
 * Keep the project, once the edits stop coming.
 *
 * Dragging a sound writes a new project on every movement of the pointer, and
 * serialising a few hundred cues each time would be felt. The wait is short
 * enough that anything you would call a pause has already been written.
 */
export function keepProject(project: Project): void {
  waiting = project;
  if (pending !== null) clearTimeout(pending);
  pending = setTimeout(flushProject, SETTLE_MS);
}

/**
 * Write whatever is waiting, now.
 *
 * Called when the page is being hidden or closed, which is exactly the moment
 * the wait above would otherwise lose the last edit — and a reload is the
 * case this whole file exists for.
 */
export function flushProject(): void {
  if (pending !== null) clearTimeout(pending);
  pending = null;
  const project = waiting;
  waiting = null;
  if (!project) return;

  try {
    // An empty timeline against no clip is not a piece, and writing one would
    // leave "New project" undone a moment after it was pressed: it clears the
    // store, and then the empty project it just made gets written back.
    if (!worthKeeping(project)) localStorage.removeItem(WORK_KEY);
    // The same shape a session file uses, so one reader checks both and a
    // kept piece can never be something `openSession` would refuse.
    else localStorage.setItem(WORK_KEY, JSON.stringify(toSession(project)));
  } catch {
    // Storage full or turned off. The session still works; it just will not
    // survive a reload, and saying so at every keystroke would be worse.
  }
}

/**
 * The piece that was being worked on, or null if there is none.
 *
 * Read through the same checks a session file goes through, because what
 * comes back may have been written by an older version of the app.
 */
export function heldProject(): Project | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(WORK_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const read = fromSession(parsed);
  if (!read || !worthKeeping(read.project)) return null;
  return read.project;
}

/**
 * Whether there is a piece here at all.
 *
 * Nothing placed and no clip is a project in name only. The same question
 * decides both what gets written and what gets restored, so the app can never
 * be in the state of holding something it would refuse to open.
 */
function worthKeeping(project: Project): boolean {
  return project.cues.length > 0 || project.videoName !== null;
}

// ---------- the picture ----------

const DB_NAME = 'toolcraft.st88';
const DB_VERSION = 1;
const CLIP_STORE = 'clip';
const CLIP_KEY = 'current';

/** What is kept for a clip: the file itself, and what it was called. */
interface HeldClip {
  blob: Blob;
  name: string;
  type: string;
}

/**
 * Open the store, or give up quietly.
 *
 * IndexedDB is turned off in some private modes and blocked by some
 * settings. None of that is worth an error in front of somebody: without it
 * the app behaves exactly as it did before any of this existed.
 */
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CLIP_STORE)) db.createObjectStore(CLIP_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // A version change held open by another tab would otherwise hang here.
    request.onblocked = () => resolve(null);
  });
}

function inStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        let request: IDBRequest<T>;
        try {
          request = work(db.transaction(CLIP_STORE, mode).objectStore(CLIP_STORE));
        } catch {
          db.close();
          resolve(null);
          return;
        }
        request.onsuccess = () => {
          resolve(request.result);
          db.close();
        };
        request.onerror = () => {
          resolve(null);
          db.close();
        };
      }),
  );
}

/**
 * Keep the clip, so the piece opens with its picture rather than with a
 * timeline against nothing.
 *
 * Returns whether it was kept. A long clip can be larger than the browser
 * will store, and that is worth knowing about rather than discovering on the
 * next reload — the piece is kept either way, and only the picture has to be
 * found again.
 */
export async function keepVideo(file: File): Promise<boolean> {
  const held: HeldClip = { blob: file, name: file.name, type: file.type };
  const done = await inStore('readwrite', (store) => store.put(held, CLIP_KEY));
  return done !== null;
}

/** The clip that was loaded, as the file it arrived as. */
export async function heldVideo(): Promise<File | null> {
  const held = (await inStore<HeldClip>('readonly', (store) => store.get(CLIP_KEY))) as
    | HeldClip
    | null;
  if (!held || !(held.blob instanceof Blob)) return null;
  return new File([held.blob], typeof held.name === 'string' ? held.name : 'clip', {
    type: typeof held.type === 'string' ? held.type : held.blob.type,
  });
}

// ---------- starting again ----------

/**
 * Forget the piece and its clip.
 *
 * Only ever from "New project", which asks first. Everything kept across
 * projects on purpose — the packs, the sounds you saved, the patterns —
 * is left alone: starting a new piece is not the same as forgetting your
 * own sounds.
 */
export async function forgetWork(): Promise<void> {
  if (pending !== null) clearTimeout(pending);
  pending = null;
  waiting = null;
  try {
    localStorage.removeItem(WORK_KEY);
  } catch {
    // Nothing to do about it, and nothing that needs saying.
  }
  await inStore('readwrite', (store) => store.delete(CLIP_KEY));
}
