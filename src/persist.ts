import { MINE_KEY, PACKS_KEY } from './constants.ts';

/**
 * The sound packs that were loaded, as the files they came from.
 *
 * Stored as the original files rather than as anything this app derived from
 * them, so a pack read back is the pack that was loaded and nothing else.
 * Failures are ignored: a palette that has to be loaded again is a small cost
 * next to interrupting someone over it.
 */
export function savePacks(files: unknown[]): void {
  try {
    localStorage.setItem(PACKS_KEY, JSON.stringify(files));
  } catch {
    // Storage full or unavailable.
  }
}

export function loadPacks(): unknown[] {
  try {
    const raw = localStorage.getItem(PACKS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Sounds saved from the timeline.
 *
 * Written as they are, since they are already plain data. Anything unreadable
 * is dropped by whoever reads it rather than here, so a single bad entry
 * cannot take the rest with it.
 */
export function saveMine(sounds: unknown): void {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(sounds));
  } catch {
    // Storage full or unavailable.
  }
}

export function loadMine(): unknown[] {
  try {
    const raw = localStorage.getItem(MINE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
