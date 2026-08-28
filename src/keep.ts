import type { Credit } from './audio/samples.ts';
import { fromSession, toSession } from './timeline/project.ts';
import type { Project } from './timeline/types.ts';
import type { Take } from './types.ts';

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
 * so it goes in localStorage, which can be read without waiting. The video and
 * the takes are megabytes, which localStorage cannot hold at all, so they go
 * in IndexedDB and arrive a moment later. That split is why your work is on
 * screen before the picture is, rather than the page sitting empty until both
 * are ready.
 *
 * Nothing here is uploaded. Both stores are in this browser, on this machine,
 * exactly like the video itself.
 */

/** Where the piece is kept. */
const WORK_KEY = 'toolcraft.st88.work';

/** How long a run of edits settles before it is written. */
const SETTLE_MS = 800;

// ---------- which tab is doing the keeping ----------

/**
 * One tab keeps the piece, and the others say so rather than fighting over it.
 *
 * Both tabs writing to one key means the last one to save wins and the other's
 * work disappears without anything on screen changing — measured in a browser,
 * a second tab's sounds vanished from the store while still being drawn in it.
 * That is a worse failure than not keeping at all, because it looks like
 * nothing happened.
 *
 * So a tab claims the keeping, and a tab that cannot claim it works normally
 * but writes nothing and says as much, with a way to take over. There is no
 * compare-and-set in localStorage, so the claim is written and then read back;
 * two tabs starting in the same instant settle it on the next heartbeat.
 */
const KEEPER_KEY = 'toolcraft.st88.keeper';

/** How often the tab holding the claim says it is still here. */
const HEARTBEAT_MS = 4000;

/** How long a claim stands without a heartbeat before another tab takes it. */
const STALE_MS = 12000;

/** This tab, for the length of this page. */
const me = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

interface Claim {
  id: string;
  at: number;
}

let holding = false;
let beat: ReturnType<typeof setInterval> | null = null;
let told: ((keeping: boolean) => void) | null = null;

function readClaim(): Claim | null {
  try {
    const raw = localStorage.getItem(KEEPER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const claim = parsed as Partial<Claim>;
    if (typeof claim.id !== 'string' || typeof claim.at !== 'number') return null;
    return { id: claim.id, at: claim.at };
  } catch {
    return null;
  }
}

function writeClaim(): void {
  try {
    localStorage.setItem(KEEPER_KEY, JSON.stringify({ id: me, at: Date.now() }));
  } catch {
    // Storage turned off. Nothing is kept anyway, so nothing is at risk.
  }
}

/** Whether a claim is somebody else's and recent enough to respect. */
function heldByAnother(claim: Claim | null): boolean {
  return claim !== null && claim.id !== me && Date.now() - claim.at < STALE_MS;
}

function setHolding(next: boolean): void {
  if (holding === next) return;
  holding = next;
  told?.(next);
}

/**
 * Try to become the tab that keeps the piece.
 *
 * Claims when nothing holds it, or when whatever held it has stopped saying it
 * is there — a tab that crashed or was closed without a chance to let go.
 */
function tryClaim(): void {
  if (heldByAnother(readClaim())) {
    setHolding(false);
    return;
  }
  writeClaim();
  // Written and read back, because two tabs can write in the same instant and
  // localStorage has no way to say "only if nobody else did".
  const now = readClaim();
  setHolding(now?.id === me);
}

/**
 * Start taking part in the claim, and say whether this tab has it.
 *
 * The listener is told whenever that changes, which is how the line on screen
 * stays true when another tab takes over or goes away.
 */
export function startKeeping(listener: (keeping: boolean) => void): boolean {
  told = listener;
  tryClaim();

  if (beat === null) {
    beat = setInterval(() => {
      if (holding) writeClaim();
      // A tab that is not holding keeps looking, so closing the tab that was
      // holding hands the keeping over without anybody pressing anything.
      else tryClaim();
    }, HEARTBEAT_MS);
  }

  // Fires in the *other* tabs, so taking over somewhere else is noticed here
  // at once rather than at the next heartbeat.
  window.addEventListener('storage', onClaimChanged);
  return holding;
}

function onClaimChanged(event: StorageEvent): void {
  if (event.key !== KEEPER_KEY) return;
  const claim = readClaim();
  if (heldByAnother(claim)) setHolding(false);
  else if (!holding) tryClaim();
}

/**
 * Take the keeping from whichever tab has it.
 *
 * Deliberately a thing somebody presses. Two tabs on one piece is a muddle
 * however it is resolved, and the person is the only one who knows which of
 * them holds the work they care about.
 */
export function takeOverKeeping(project: Project): void {
  writeClaim();
  setHolding(readClaim()?.id === me);
  // Written straight away, and from what this tab actually has rather than
  // from whatever the settling delay was holding: a tab that restored and then
  // edited has a piece worth keeping even if its last write was refused, and a
  // tab that only looked has one identical to the store. Either way the thing
  // on screen is the thing that gets kept, which is the point of pressing it.
  if (holding) {
    waiting = project;
    flushProject();
  }
}

/** Whether this tab is the one writing things down. */
export function isKeeping(): boolean {
  return holding;
}

/**
 * Let go, so the next tab picks it up without waiting out the stale window.
 *
 * Only clears the claim if it is still ours: a tab that was taken over must
 * not wipe the new holder's claim on its way out.
 */
export function stopKeeping(): void {
  window.removeEventListener('storage', onClaimChanged);
  if (beat !== null) clearInterval(beat);
  beat = null;
  if (holding && readClaim()?.id === me) {
    try {
      localStorage.removeItem(KEEPER_KEY);
    } catch {
      // Nothing to do, and nothing that needs saying.
    }
  }
  holding = false;
  told = null;
}

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
  if (!waiting) return;
  /*
   * Another tab is keeping this piece. Writing here would be the clobber this
   * whole claim exists to prevent.
   *
   * Held on to rather than dropped, so that taking over later writes the work
   * done while this tab was not keeping, instead of only whatever happened
   * after the button was pressed.
   */
  if (!holding) return;
  const project = waiting;
  waiting = null;

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

// ---------- the things too big for localStorage ----------

const DB_NAME = 'toolcraft.st88';
const DB_VERSION = 3;
const CLIP_STORE = 'clip';
const TAKE_STORE = 'takes';
const SAMPLE_STORE = 'samples';
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
      // Both are created here rather than one per version, so a browser
      // arriving from either earlier version ends up with the same shape.
      if (!db.objectStoreNames.contains(CLIP_STORE)) db.createObjectStore(CLIP_STORE);
      if (!db.objectStoreNames.contains(TAKE_STORE)) db.createObjectStore(TAKE_STORE);
      if (!db.objectStoreNames.contains(SAMPLE_STORE)) db.createObjectStore(SAMPLE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // A version change held open by another tab would otherwise hang here.
    request.onblocked = () => resolve(null);
  });
}

function inStore<T>(
  store: string,
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
          request = work(db.transaction(store, mode).objectStore(store));
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
  const done = await inStore(CLIP_STORE, 'readwrite', (store) => store.put(held, CLIP_KEY));
  return done !== null;
}

/** The clip that was loaded, as the file it arrived as. */
export async function heldVideo(): Promise<File | null> {
  const held = (await inStore<HeldClip>(CLIP_STORE, 'readonly', (store) =>
    store.get(CLIP_KEY),
  )) as HeldClip | null;
  if (!held || !(held.blob instanceof Blob)) return null;
  return new File([held.blob], typeof held.name === 'string' ? held.name : 'clip', {
    type: typeof held.type === 'string' ? held.type : held.blob.type,
  });
}

// ---------- takes ----------

/**
 * A take, as it is written down.
 *
 * The recording itself and everything worked out from it, minus the decoded
 * audio: that is hundreds of times larger than the compressed recording it
 * came from, and it can be made again from the blob in a moment. It is made
 * again lazily, when the take is first played, because decoding needs an audio
 * context and the browser will not give one until something is clicked.
 */
type HeldTake = Omit<Take, 'buffer'>;

/**
 * Keep the takes, because a reload losing them is now the odd one out.
 *
 * Everything else survives — the piece, the clip, the patterns, the sounds you
 * saved. A take is a performance, which makes it the least reproducible thing
 * in the app and the worst of all of them to drop on a refresh.
 */
export async function keepTakes(takes: readonly Take[]): Promise<void> {
  const held: HeldTake[] = takes.map(({ buffer: _buffer, ...rest }) => rest);
  await inStore(TAKE_STORE, 'readwrite', (store) => store.put(held, CLIP_KEY));
}

/** The takes from last time, without their audio decoded. */
export async function heldTakes(): Promise<Take[]> {
  const held = (await inStore<HeldTake[]>(TAKE_STORE, 'readonly', (store) =>
    store.get(CLIP_KEY),
  )) as HeldTake[] | null;
  if (!Array.isArray(held)) return [];
  return held
    .filter((take) => take && typeof take.id === 'string' && take.blob instanceof Blob)
    .map((take) => ({
      ...take,
      name: typeof take.name === 'string' ? take.name : 'Take',
      dur: typeof take.dur === 'number' && take.dur >= 0 ? take.dur : 0,
      bars: Array.isArray(take.bars) ? take.bars : [],
      events: Array.isArray(take.events) ? take.events : [],
      layered: take.layered === true,
      // Made again the first time it is played. See {@link HeldTake}.
      buffer: null,
    }));
}

// ---------- recordings ----------

/**
 * What is kept for a recording: the file, and what was measured from it.
 *
 * The file rather than the decoded audio, for the same reason a take is kept
 * that way — decoded is hundreds of times larger and can be made again in a
 * moment. The duration is written down because the timeline needs a length to
 * draw a placed sound with, long before anything has been clicked and there is
 * an audio context to decode with.
 */
interface HeldSample {
  id: string;
  name: string;
  duration: number;
  blob: Blob;
  /**
   * Who to credit and under what licence.
   *
   * Kept because it is an obligation rather than a nicety: a CC-BY sound owes
   * its author a credit wherever it ends up, and a library that forgets which
   * of four hundred sounds those are has made the obligation impossible to
   * meet. See `audio/samples.ts`.
   */
  credit?: Credit;
  /** The folders it came out of, which is where an archive files its sounds. */
  tags?: readonly string[];
}

/**
 * Keep the recordings somebody has given the app.
 *
 * Their own store, and not cleared by "New project": a recording is a sound
 * you brought, like a pack or a sound you saved, and starting a new piece is
 * not the same as forgetting it.
 */
export async function keepSamples(list: readonly HeldSample[]): Promise<boolean> {
  const done = await inStore(SAMPLE_STORE, 'readwrite', (store) =>
    store.put(
      list.map(({ id, name, duration, blob, credit, tags }) => ({
        id,
        name,
        duration,
        blob,
        // Written only when there is something to write, so a library of your
        // own recordings does not carry four hundred empty objects.
        ...(credit ? { credit } : {}),
        ...(tags && tags.length ? { tags: [...tags] } : {}),
      })),
      CLIP_KEY,
    ),
  );
  return done !== null;
}

/** The recordings from last time, undecoded. */
export async function heldSamples(): Promise<HeldSample[]> {
  const held = (await inStore<HeldSample[]>(SAMPLE_STORE, 'readonly', (store) =>
    store.get(CLIP_KEY),
  )) as HeldSample[] | null;
  if (!Array.isArray(held)) return [];
  return held
    .filter((s) => s && typeof s.id === 'string' && s.blob instanceof Blob)
    .map((s) => ({
      id: s.id,
      name: typeof s.name === 'string' ? s.name : 'recording',
      duration: typeof s.duration === 'number' && s.duration > 0 ? s.duration : 0,
      blob: s.blob,
      // Absent on anything kept before these existed, which is why both are
      // optional rather than defaulted: a recording with no credit recorded is
      // different from one known to need none.
      ...(s.credit && typeof s.credit === 'object' ? { credit: s.credit } : {}),
      ...(Array.isArray(s.tags) ? { tags: s.tags.filter((t) => typeof t === 'string') } : {}),
    }));
}

// ---------- starting again ----------

/**
 * Forget the piece and its clip.
 *
 * Only ever from "New project", which asks first. Everything kept across
 * projects on purpose — the packs, the sounds you saved, the patterns, the
 * takes — is left alone: starting a new piece is not the same as forgetting
 * your own sounds or the passes you played.
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
  await inStore(CLIP_STORE, 'readwrite', (store) => store.delete(CLIP_KEY));
}
