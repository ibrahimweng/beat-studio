/**
 * A library that is already there.
 *
 * Everything else about recordings assumes somebody went and got some: drop a
 * folder in, or search and click. Both work and both are a job to do before
 * any work starts, and an app whose palette is empty until you go shopping is
 * an app you put off opening.
 *
 * So on a first visit it fills itself in, quietly, behind whatever you are
 * doing. Sixty recordings across the categories this kind of work actually
 * reaches for, so there is a real palette next to the synthesised one before
 * anybody has searched for anything.
 *
 * ---
 *
 * **CC0 only.** Everything here asks nothing of anybody: no credit owed, no
 * commercial restriction, nothing to honour later. A starter set that quietly
 * put an attribution obligation on every new project would be a trap, and the
 * one thing worse than an empty palette is a full one you cannot ship.
 *
 * **A search per category, not per sound.** Twelve requests that return five
 * apiece rather than sixty that return one, because the quota this spends
 * belongs to the deployment and is shared by everybody using it.
 *
 * **Once.** Recorded when it has been done, and skipped entirely for anybody
 * who already has recordings of their own — arriving to find sixty strangers
 * mixed into your own library is not a good first impression.
 */

/** One category, and what to ask Freesound for. */
export interface Shelf {
  /** What this is, which becomes a tag. */
  of: string;
  /** The words to search. */
  find: string;
  /** How many to take. */
  take: number;
}

/**
 * What a motion graphics palette is short of.
 *
 * Chosen against what the synthesised voices cannot do rather than to cover
 * everything: this app already makes impacts, risers and clicks convincingly,
 * and it makes a poor door, a poor footstep and a poor page turn, because
 * nobody synthesises those. The overlap is deliberate at the top of the list —
 * a real impact next to a made one is a useful choice to have — and the rest
 * is the things there is no other way to get.
 */
export const SHELVES: readonly Shelf[] = [
  { of: 'doors', find: 'door close wood', take: 5 },
  { of: 'switches', find: 'switch click mechanical', take: 5 },
  { of: 'glass', find: 'glass clink', take: 5 },
  { of: 'metal', find: 'metal hit resonant', take: 5 },
  { of: 'footsteps', find: 'footstep single', take: 5 },
  { of: 'paper', find: 'paper page turn', take: 5 },
  { of: 'cloth', find: 'cloth fabric movement', take: 4 },
  { of: 'water', find: 'water drop splash', take: 5 },
  { of: 'wind', find: 'wind ambience', take: 4 },
  { of: 'impacts', find: 'impact thud heavy', take: 5 },
  { of: 'whoosh', find: 'whoosh swish', take: 6 },
  { of: 'room tone', find: 'room tone quiet', take: 4 },
];

/** How many this will fetch, for saying so before it starts. */
export const STOCK_TOTAL = SHELVES.reduce((sum, shelf) => sum + shelf.take, 0);

/** Where the fact that it has been done is written. */
export const STOCKED_KEY = 'toolcraft.st88.stocked';

/** Whether the shelves have already been filled, or refused. */
export function alreadyStocked(): boolean {
  try {
    return localStorage.getItem(STOCKED_KEY) !== null;
  } catch {
    // Site data blocked. Better to not stock than to stock on every visit.
    return true;
  }
}

/** Remember that it happened, so it happens once. */
export function markStocked(how: 'done' | 'off' | 'failed'): void {
  try {
    localStorage.setItem(STOCKED_KEY, how);
  } catch {
    // Nothing to do, and nothing worth interrupting anyone over.
  }
}
