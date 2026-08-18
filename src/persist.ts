import { BANK_KEYS, BPM_MAX, BPM_MIN, LANES, MAX_STEPS, STORAGE_KEY } from './constants.ts';
import { freshBanks } from './pattern.ts';
import type { BankKey, Banks, SavedState } from './types.ts';

/**
 * Read the saved banks, tempo and selected bank.
 *
 * Everything is validated on the way in: the value comes from localStorage,
 * which any earlier version of the app (or the user) may have written.
 * Returns null when there is nothing usable to restore.
 */
export function loadSaved(): SavedState | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage disabled (private mode, blocked cookies)
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Partial<SavedState>;

  const banks = freshBanks();
  if (obj.banks && typeof obj.banks === 'object') {
    for (const k of BANK_KEYS) {
      const saved = (obj.banks as Banks)[k];
      if (!saved || typeof saved !== 'object') continue;
      for (const lane of LANES) {
        const steps = saved[lane.key];
        if (!Array.isArray(steps)) continue;
        for (let i = 0; i < MAX_STEPS; i++) banks[k][lane.key][i] = steps[i] === true;
      }
    }
  }

  const bpm =
    typeof obj.bpm === 'number' && Number.isFinite(obj.bpm)
      ? Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(obj.bpm)))
      : 92;

  const bank: BankKey = BANK_KEYS.includes(obj.bank as BankKey) ? (obj.bank as BankKey) : 'A';

  return { banks, bpm, bank };
}

/** Write banks, tempo and selected bank. Failures are ignored by design. */
export function saveState(state: SavedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — the session still works, it just will not
    // survive a reload.
  }
}
