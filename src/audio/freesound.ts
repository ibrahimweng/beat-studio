/**
 * Fetching recordings from Freesound.
 *
 * The app can already take an archive: drop in a zip or a folder and it is
 * read, filed and credited. This is the same thing without the round trip
 * through a downloads folder — search from inside the app, hear it, keep it.
 *
 * ---
 *
 * **What is verified here and what is not.** Everything below that shapes a
 * request or reads a response is tested against recorded and synthetic
 * replies in `tools/freesound-check.html`: the URL that gets built, the
 * parsing, the credit that comes out, what happens on a bad key, on a quota,
 * on an empty result, on a malformed body. The one thing that could not be
 * tested is the network call itself, because freesound.org is not reachable
 * from where this was written. So the request shape is written from the
 * published API and may be wrong in some detail, and the failure path is
 * built to say which of those two it is rather than to fail quietly.
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
const API = 'https://freesound.org/apiv2';

/**
 * The fields asked for.
 *
 * Named explicitly because the default response carries a great deal nobody
 * here needs — analysis vectors, spectral images, similar-sound links — and a
 * page of those is a slow request for no reason.
 */
const FIELDS = 'id,name,username,license,duration,previews,url,filesize,tags';

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
  | { kind: 'no-key'; message: string }
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

export interface SearchOptions {
  /** Only this licence. Left out, everything comes back. */
  licence?: LicenceName;
  /** Seconds. A sound design palette wants short things. */
  maxSeconds?: number;
  /** Which page, from 1. */
  page?: number;
  /** How many per page. */
  perPage?: number;
}

/**
 * The URL for a search.
 *
 * Exported so it can be tested without a network, which is most of what can
 * be tested about a client for an API that cannot be reached from here.
 *
 * The key goes in the query string rather than an `Authorization` header on
 * purpose. A custom header makes the request non-simple, so the browser sends
 * a preflight `OPTIONS` first, and a preflight is one more thing that has to
 * be allowed on the far end. The published API accepts the key either way, so
 * this takes the way with fewer moving parts.
 */
export function searchUrl(key: string, query: string, options: SearchOptions = {}): string {
  const filters: string[] = [];
  if (options.licence) filters.push(`license:"${options.licence}"`);
  if (options.maxSeconds) filters.push(`duration:[0 TO ${options.maxSeconds}]`);

  const params = new URLSearchParams({
    query,
    fields: FIELDS,
    page_size: String(Math.min(150, Math.max(1, options.perPage ?? 30))),
    page: String(Math.max(1, options.page ?? 1)),
    token: key,
  });
  if (filters.length) params.set('filter', filters.join(' '));

  return `${API}/search/text/?${params.toString()}`;
}

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
      message: 'Freesound would not accept that API key. Check it at freesound.org/apiv2/apply/',
    };
  }
  if (status === 429) {
    return {
      kind: 'quota',
      message: 'Freesound is rate limiting this key. Wait a minute and try again.',
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
  key: string,
  query: string,
  options: SearchOptions = {},
  fetching: typeof fetch = fetch,
): Promise<Page> {
  if (!key.trim()) {
    throw new FreesoundError({
      kind: 'no-key',
      message: 'A Freesound API key is needed. Get one free at freesound.org/apiv2/apply/',
    });
  }
  if (!query.trim()) return { sounds: [], total: 0, more: false };

  let reply: Response;
  try {
    reply = await fetching(searchUrl(key, query.trim(), options));
  } catch {
    /*
     * A fetch that throws rather than answering is not the same as a refusal,
     * and the browser will not say which it was: a blocked cross-origin
     * request and an unplugged network both arrive here as a bare TypeError.
     * Saying both, rather than guessing one, is the difference between
     * somebody checking the right thing and rewriting their key twice.
     */
    throw new FreesoundError({
      kind: 'unreachable',
      message:
        'Could not reach Freesound. Either this browser is offline, or the ' +
        'request was blocked before it left — a cross-origin block looks the ' +
        'same from here. Anything downloaded by hand can still be dropped in.',
    });
  }

  if (!reply.ok) throw new FreesoundError(faultFor(reply.status));

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
    reply = await fetching(sound.preview);
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
