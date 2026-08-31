/**
 * Fetching recordings from Freesound.
 *
 * The app can already take an archive: drop in a zip or a folder and it is
 * read, filed and credited. This is the same thing without the round trip
 * through a downloads folder — search from inside the app, hear it, keep it.
 *
 * ---
 *
 * **The key is not here.** This talks to the app's own `/api/freesound`,
 * which holds the key in the deployment's environment and asks Freesound on
 * the browser's behalf — see `freesound-proxy.ts`. A key compiled into the
 * bundle would still be in the browser, and one typed into a field is a
 * credential put in front of somebody who came here to place a door slam.
 *
 * It also means every request this makes is same-origin, so there is no
 * cross-origin question to answer for the search or for the audio.
 *
 * **Previews, not originals.** Freesound serves a preview of every sound
 * without authentication; the original file needs an OAuth2 round trip with a
 * redirect back, which a static page cannot do without somewhere to put the
 * secret. A preview is a 128 kbps mp3, which is enough to place against
 * picture and is not enough to master from — so the app says so, and anyone
 * who needs the original can still download it and drop it in, which is what
 * the folder import is for.
 *
 * **The licence travels.** Every sound comes back with its author and its
 * licence, and those are written onto the sample rather than dropped. This is
 * the point: a CC-BY sound owes its author a credit wherever the work ends
 * up, and a search that imports fifty sounds and forgets which of them owe
 * one has made that obligation impossible to keep. See `samples.ts`.
 */

import type { Credit } from './samples.ts';

/** Where the API lives. */
/** The app's own endpoint. What is beyond it is the proxy's business. */
const API = '/api/freesound';

/** One sound as Freesound describes it. */
export interface Found {
  id: number;
  name: string;
  author: string;
  licence: string;
  /** Seconds. */
  duration: number;
  /** Where to hear it without downloading it. */
  preview: string;
  /** The page it lives on. */
  url: string;
  tags: readonly string[];
}

/** What went wrong, in terms someone can act on. */
export type FreesoundFault =
  | { kind: 'off'; message: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'quota'; message: string }
  | { kind: 'unreachable'; message: string }
  | { kind: 'unexpected'; message: string };

export interface Page {
  sounds: Found[];
  /** How many there are in total, which is not how many came back. */
  total: number;
  /** Whether asking for another page would give more. */
  more: boolean;
}

export class FreesoundError extends Error {
  readonly fault: FreesoundFault;
  constructor(fault: FreesoundFault) {
    super(fault.message);
    this.name = 'FreesoundError';
    this.fault = fault;
  }
}

/** How a licence is written in a filter, by what it means to somebody. */
export const LICENCES = {
  /** Asks for nothing. The safe pool for work that ships. */
  'Creative Commons 0': 'cc0',
  /** Free to use anywhere, as long as the author is named. */
  Attribution: 'by',
  /** Named, and not in anything commercial. */
  'Attribution NonCommercial': 'by-nc',
} as const;

export type LicenceName = keyof typeof LICENCES;

/*
 * One option, because one is all that travels.
 *
 * There were four. A length cap, a page number and a page size sat here as
 * well, and none of them reached anything: `searchUrl` never wrote them, the
 * proxy never read them, and nothing ever passed one. How long a sound may be
 * and how many come back are fixed on the server -- `duration:[0 TO 30]` and
 * twenty four -- so a caller asking for fifty per page got twenty four and no
 * way to tell it had been ignored.
 */
export interface SearchOptions {
  /** Only this licence. Left out, everything comes back. */
  licence?: LicenceName;
}

/**
 * The URL for a search, on this app's own origin.
 *
 * Exported so it can be checked without a network.
 */
export function searchUrl(query: string, options: SearchOptions = {}): string {
  const params = new URLSearchParams({ what: 'search', q: query });
  if (options.licence) params.set('licence', options.licence);
  return `${API}?${params.toString()}`;
}

/** The URL for one sound's audio, fetched through the same endpoint. */
export function soundUrl(sound: Found): string {
  return `${API}?${new URLSearchParams({ what: 'sound', from: sound.preview }).toString()}`;
}

/** Whether a value is an object we can read fields off. */
/**
 * A licence, as something readable, whatever form it arrived in.
 *
 * Freesound's search returns the licence as a URL —
 * `http://creativecommons.org/publicdomain/zero/1.0/` — while its search
 * *filter* takes the name. So the same licence has two spellings depending on
 * which direction it is travelling, and storing the URL means showing someone
 * a URL where a licence should be.
 *
 * Worse, it means the check for whether a credit is owed was passing by
 * accident: that URL contains the word "publicdomain", which the check
 * happens to match. A CC-BY URL contains no word that says so, so the very
 * next licence along would have been handled by luck running out. Named here
 * instead, once, from the deed.
 */
export function licenceName(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const text = raw.toLowerCase();
  if (!text.includes('creativecommons.org') && !text.includes('://')) {
    // Already a name rather than a deed. Keep whatever was said.
    return raw.trim();
  }
  if (text.includes('publicdomain') || text.includes('/zero/')) return 'Creative Commons 0';
  if (text.includes('sampling')) return 'Sampling+';
  const nc = text.includes('-nc') || text.includes('nc/');
  const nd = text.includes('-nd') || text.includes('nd/');
  const sa = text.includes('-sa') || text.includes('sa/');
  if (text.includes('/by')) {
    return ['Attribution', nc ? 'NonCommercial' : '', nd ? 'NoDerivatives' : '', sa ? 'ShareAlike' : '']
      .filter(Boolean)
      .join(' ');
  }
  return raw.trim();
}

/** Whether a value is an object we can read fields off. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The best preview a result offers.
 *
 * Freesound returns several. High quality mp3 is wanted, but the names have
 * changed shape before now, so anything that looks like a preview will do
 * rather than failing because one key was not the one expected.
 */
function previewOf(previews: unknown): string | null {
  if (!isRecord(previews)) return null;
  const wanted = ['preview-hq-mp3', 'preview-hq-ogg', 'preview-lq-mp3', 'preview-lq-ogg'];
  for (const key of wanted) {
    const value = previews[key];
    if (typeof value === 'string' && value.startsWith('http')) return value;
  }
  for (const value of Object.values(previews)) {
    if (typeof value === 'string' && value.startsWith('http')) return value;
  }
  return null;
}

/**
 * One result, or null if it is missing anything that matters.
 *
 * Skipping rather than throwing: one odd entry in a page of thirty should
 * cost that entry and not the search.
 */
export function readResult(raw: unknown): Found | null {
  if (!isRecord(raw)) return null;
  const preview = previewOf(raw.previews);
  const id = typeof raw.id === 'number' ? raw.id : Number(raw.id);
  if (!preview || !Number.isFinite(id)) return null;

  return {
    id,
    name: typeof raw.name === 'string' ? raw.name.replace(/\.[^.]+$/, '').slice(0, 60) : `sound ${id}`,
    author: typeof raw.username === 'string' ? raw.username : 'unknown',
    licence: licenceName(raw.license),
    duration: typeof raw.duration === 'number' && raw.duration > 0 ? raw.duration : 0,
    preview,
    url: typeof raw.url === 'string' ? raw.url : `https://freesound.org/s/${id}/`,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
  };
}

/** A whole response body, however much of it is usable. */
export function readPage(body: unknown): Page {
  if (!isRecord(body)) throw new FreesoundError({
    kind: 'unexpected',
    message: 'Freesound sent something that is not a search result',
  });
  const results = Array.isArray(body.results) ? body.results : [];
  const sounds = results.map(readResult).filter((s): s is Found => s !== null);
  return {
    sounds,
    total: typeof body.count === 'number' ? body.count : sounds.length,
    more: typeof body.next === 'string' && body.next.length > 0,
  };
}

/** What a status code means, said in a way somebody can act on. */
export function faultFor(status: number): FreesoundFault {
  if (status === 401 || status === 403) {
    return {
      kind: 'rejected',
      message: "This deployment's Freesound key was refused.",
    };
  }
  if (status === 429) {
    return {
      kind: 'quota',
      message: 'Freesound is rate limiting this deployment. Wait a minute and try again.',
    };
  }
  return { kind: 'unexpected', message: `Freesound answered with ${status}` };
}

/**
 * Search Freesound.
 *
 * `fetching` is the fetch to use, so a test can hand in a recorded reply. It
 * is the only way any of this could be checked from where it was written.
 */
export async function search(
  query: string,
  options: SearchOptions = {},
  fetching: typeof fetch = fetch,
): Promise<Page> {
  if (!query.trim()) return { sounds: [], total: 0, more: false };

  let reply: Response;
  try {
    reply = await fetching(searchUrl(query.trim(), options));
  } catch {
    // Same-origin now, so this is the app's own server being unreachable
    // rather than anything to do with Freesound or with a browser policy.
    throw new FreesoundError({
      kind: 'unreachable',
      message: 'Could not reach the server. Everything already in your library still works.',
    });
  }

  if (!reply.ok) {
    /*
     * The proxy says what went wrong in terms of the deployment, which is
     * where the fault actually lies now: nobody using the app can fix a key
     * they do not have, so the message says whose problem it is.
     */
    let said = '';
    let kind: FreesoundFault['kind'] = 'unexpected';
    try {
      const body = (await reply.json()) as { error?: string; message?: string };
      said = typeof body.message === 'string' ? body.message : '';
      if (body.error === 'not-configured') kind = 'off';
      else if (reply.status === 401 || reply.status === 403) kind = 'rejected';
      else if (reply.status === 429) kind = 'quota';
    } catch {
      // A proxy that did not answer in JSON is answering for something else.
    }
    throw new FreesoundError(said ? { kind, message: said } : faultFor(reply.status));
  }

  try {
    return readPage(await reply.json());
  } catch (error) {
    if (error instanceof FreesoundError) throw error;
    throw new FreesoundError({
      kind: 'unexpected',
      message: 'Freesound answered with something that could not be read',
    });
  }
}

/** What to write down about where a sound came from. */
export function creditFor(sound: Found): Credit {
  return {
    author: sound.author,
    licence: sound.licence,
    url: sound.url,
    from: 'Freesound',
  };
}

/**
 * The audio itself, as a file ready to be taken on.
 *
 * The preview rather than the original, for the reason at the top of this
 * file. The file is named as one; the library also tags it `preview`, which
 * is what actually shows — a name suffix would repeat on every row of a
 * library that may be entirely previews, while a tag shows on hover and can
 * be searched for. Somebody about to master from a 128 kbps mp3 should be
 * able to find that out without listening for it.
 */
export async function fetchSound(
  sound: Found,
  fetching: typeof fetch = fetch,
): Promise<File> {
  let reply: Response;
  try {
    reply = await fetching(soundUrl(sound));
  } catch {
    throw new FreesoundError({
      kind: 'unreachable',
      message: `Could not download “${sound.name}”. The search worked, so this is the audio host rather than the API.`,
    });
  }
  if (!reply.ok) throw new FreesoundError(faultFor(reply.status));

  const blob = await reply.blob();
  const ext = sound.preview.includes('.ogg') ? 'ogg' : 'mp3';
  return new File([blob], `${sound.name} (preview).${ext}`, {
    type: blob.type || (ext === 'ogg' ? 'audio/ogg' : 'audio/mpeg'),
  });
}
