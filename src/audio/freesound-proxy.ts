/**
 * The part of the Freesound client that runs on a server.
 *
 * The key does not belong in the browser. Compiled into the bundle it is
 * still in the browser — Vite inlines it into the JavaScript that ships, and
 * anyone can read it there — and it would be *one* key rather than each
 * person's own, so a rate limit hit by a stranger would be a rate limit hit
 * by everybody. Typed into a field by each user it is not in the code, but it
 * is a field somebody has to find, and it puts a credential in front of
 * someone who came here to place a door slam.
 *
 * So it lives in the deployment's environment and never leaves it. The
 * browser asks this, this asks Freesound.
 *
 * That also removes the one thing about the client that could not be tested:
 * a page calling its own origin has no cross-origin question to answer, for
 * the search or for the audio.
 *
 * ---
 *
 * Written as a plain function of its inputs rather than against a particular
 * host's request object, so the Vercel function, the dev server and the tests
 * all drive the same code. Nothing here touches the platform.
 */

/** What the browser asked for. */
export interface ProxyAsk {
  /** `search` or `sound`. */
  what: string | null;
  /** For a search: the words. */
  query: string | null;
  /** For a search: a licence filter, or nothing for all of them. */
  licence: string | null;
  /** For a sound: which one, as the URL the search gave out. */
  from: string | null;
}

export interface ProxyReply {
  status: number;
  /** `application/json` or whatever the audio came back as. */
  type: string;
  body: string | ArrayBuffer;
}

const API = 'https://freesound.org/apiv2';
const FIELDS = 'id,name,username,license,duration,previews,url,tags';

/**
 * Hosts this will fetch from.
 *
 * Without this the endpoint is an open proxy: anyone could hand it any URL
 * and have the deployment fetch it for them, which is somebody else's
 * bandwidth bill and somebody else's abuse report. Freesound serves previews
 * off a CDN on its own domain, so an exact-suffix match on the registered
 * domain covers both and nothing else.
 */
function allowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return url.hostname === 'freesound.org' || url.hostname.endsWith('.freesound.org');
}

const json = (status: number, value: unknown): ProxyReply => ({
  status,
  type: 'application/json',
  body: JSON.stringify(value),
});

/**
 * Answer one request from the browser.
 *
 * `key` is the deployment's Freesound key, and a deployment without one is a
 * normal state rather than a fault: the app still does everything else, so
 * this says so plainly and the palette leaves the Freesound group out.
 */
export async function serveFreesound(
  ask: ProxyAsk,
  key: string | undefined,
  fetching: typeof fetch = fetch,
): Promise<ProxyReply> {
  if (!key) {
    return json(503, {
      error: 'not-configured',
      message: 'This deployment has no Freesound key set, so searching the web is off.',
    });
  }

  if (ask.what === 'sound') {
    if (!ask.from || !allowed(ask.from)) {
      return json(400, { error: 'bad-sound', message: 'That is not a Freesound address.' });
    }
    const reply = await fetching(ask.from);
    if (!reply.ok) {
      return json(reply.status, { error: 'upstream', message: `Freesound answered ${reply.status}` });
    }
    return {
      status: 200,
      type: reply.headers.get('content-type') ?? 'audio/mpeg',
      body: await reply.arrayBuffer(),
    };
  }

  if (ask.what !== 'search') {
    return json(400, { error: 'bad-request', message: 'Ask for a search or a sound.' });
  }
  if (!ask.query || !ask.query.trim()) return json(200, { count: 0, results: [] });

  const filters: string[] = [];
  if (ask.licence) filters.push(`license:"${ask.licence.replace(/"/g, '')}"`);
  // A sound design palette wants things that fit against a picture, and the
  // twenty minute field recordings are a different job.
  filters.push('duration:[0 TO 30]');

  const params = new URLSearchParams({
    query: ask.query.trim().slice(0, 120),
    fields: FIELDS,
    page_size: '24',
    token: key,
    filter: filters.join(' '),
  });

  const reply = await fetching(`${API}/search/text/?${params.toString()}`);
  if (!reply.ok) {
    /*
     * The upstream status is passed on, but never the body: an error from
     * Freesound can quote the request back, and the request has the key in
     * it. Everything this endpoint exists for would be undone by echoing it.
     */
    return json(reply.status, {
      error: 'upstream',
      message:
        reply.status === 401 || reply.status === 403
          ? "This deployment's Freesound key was refused."
          : reply.status === 429
            ? 'Freesound is rate limiting this deployment. Try again in a minute.'
            : `Freesound answered ${reply.status}`,
    });
  }

  return { status: 200, type: 'application/json', body: await reply.text() };
}

/** Read an ask off a URL, wherever the URL came from. */
export function askFrom(url: URL): ProxyAsk {
  return {
    what: url.searchParams.get('what'),
    query: url.searchParams.get('q'),
    licence: url.searchParams.get('licence'),
    from: url.searchParams.get('from'),
  };
}
