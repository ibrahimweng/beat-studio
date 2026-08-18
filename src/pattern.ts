import { BANK_KEYS, LANES, MAX_STEPS, SEED } from './constants.ts';
import type { Banks, Pattern } from './types.ts';

/** An empty pattern: every lane allocated to the maximum step count. */
export function blankPattern(): Pattern {
  const p = {} as Pattern;
  for (const lane of LANES) p[lane.key] = new Array<boolean>(MAX_STEPS).fill(false);
  return p;
}

/** Four empty banks. */
export function freshBanks(): Banks {
  const b = {} as Banks;
  for (const k of BANK_KEYS) b[k] = blankPattern();
  return b;
}

/** The starter groove. */
export function seedPattern(): Pattern {
  const p = blankPattern();
  for (const [lane, steps] of Object.entries(SEED)) {
    for (const i of steps ?? []) p[lane as keyof Pattern][i] = true;
  }
  return p;
}

/**
 * Copy a pattern, flipping one step. Patterns are treated as immutable so a
 * render can compare the previous and next bank cheaply.
 */
export function togglePatternStep(pattern: Pattern, lane: keyof Pattern, step: number): Pattern {
  const next: Pattern = { ...pattern };
  const lanes = pattern[lane].slice();
  lanes[step] = !lanes[step];
  next[lane] = lanes;
  return next;
}
