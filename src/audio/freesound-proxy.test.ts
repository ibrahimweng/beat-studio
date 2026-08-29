import { describe, expect, it, vi } from 'vitest';
import { askFrom, serveFreesound } from './freesound-proxy.ts';

const KEY = 'a-real-looking-key-0123456789';

/** A stand-in for the network that records what it was asked for. */
function upstream(reply: Response): { fetching: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetching = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return reply;
  }) as unknown as typeof fetch;
  return { fetching, calls };
}

const ok = (body: string, type = 'application/json'): Response =>
  new Response(body, { status: 200, headers: { 'content-type': type } });

const body = (reply: { body: string | ArrayBuffer }): string =>
  typeof reply.body === 'string' ? reply.body : new TextDecoder().decode(reply.body);

describe('a deployment with no key', () => {
  it('says so plainly instead of failing', () => {
    /*
     * A normal state rather than a fault. The app does everything else, and
     * the palette leaves the Freesound group out.
     */
    return serveFreesound({ what: 'search', query: 'door', licence: null, from: null }, undefined).then(
      (reply) => {
        expect(reply.status).toBe(503);
        expect(JSON.parse(body(reply)).error).toBe('not-configured');
      },
    );
  });

  it('never reaches the network to find out', async () => {
    const { fetching, calls } = upstream(ok('{}'));
    await serveFreesound({ what: 'search', query: 'door', licence: null, from: null }, undefined, fetching);
    expect(calls).toEqual([]);
  });
});

describe('searching', () => {
  it('asks Freesound for the words, carrying the key', async () => {
    const { fetching, calls } = upstream(ok('{"count":2,"results":[]}'));
    const reply = await serveFreesound(
      { what: 'search', query: '  glass smash  ', licence: null, from: null },
      KEY,
      fetching,
    );

    expect(reply.status).toBe(200);
    const asked = new URL(calls[0]);
    expect(asked.origin).toBe('https://freesound.org');
    expect(asked.searchParams.get('query')).toBe('glass smash');
    expect(asked.searchParams.get('token')).toBe(KEY);
  });

  it('leaves out the twenty minute field recordings', async () => {
    const { fetching, calls } = upstream(ok('{}'));
    await serveFreesound({ what: 'search', query: 'rain', licence: null, from: null }, KEY, fetching);
    // A palette wants things that fit against a picture.
    expect(new URL(calls[0]).searchParams.get('filter')).toContain('duration:[0 TO 30]');
  });

  it('passes a licence through, with no way to break out of the quoting', async () => {
    const { fetching, calls } = upstream(ok('{}'));
    await serveFreesound(
      { what: 'search', query: 'rain', licence: 'Creative Commons 0"', from: null },
      KEY,
      fetching,
    );
    const filter = new URL(calls[0]).searchParams.get('filter')!;
    expect(filter).toContain('license:"Creative Commons 0"');
    expect(filter.match(/"/g)).toHaveLength(2);
  });

  it('answers an empty search without asking anybody', async () => {
    const { fetching, calls } = upstream(ok('{}'));
    const reply = await serveFreesound(
      { what: 'search', query: '   ', licence: null, from: null },
      KEY,
      fetching,
    );
    expect(reply.status).toBe(200);
    expect(JSON.parse(body(reply))).toEqual({ count: 0, results: [] });
    expect(calls).toEqual([]);
  });

  it('never repeats what Freesound said back, because the key is in it', async () => {
    /*
     * An error from Freesound can quote the request, and the request carries
     * the key. Everything this endpoint exists for would be undone by echoing
     * it, so the status is passed on and the body never is.
     */
    const leak = new Response(`{"detail":"Invalid token ${KEY} for /search/text/"}`, { status: 401 });
    const { fetching } = upstream(leak);
    const reply = await serveFreesound(
      { what: 'search', query: 'door', licence: null, from: null },
      KEY,
      fetching,
    );

    expect(reply.status).toBe(401);
    expect(body(reply)).not.toContain(KEY);
    expect(JSON.parse(body(reply)).message).toMatch(/refused/i);
  });

  it('says what a rate limit is, since waiting is the answer', async () => {
    const { fetching } = upstream(new Response('slow down', { status: 429 }));
    const reply = await serveFreesound(
      { what: 'search', query: 'door', licence: null, from: null },
      KEY,
      fetching,
    );
    expect(reply.status).toBe(429);
    expect(JSON.parse(body(reply)).message).toMatch(/rate limiting/i);
    expect(body(reply)).not.toContain(KEY);
  });
});

describe('fetching one sound', () => {
  /*
   * Without the host check this endpoint is an open proxy: anyone could hand
   * it any address and have the deployment fetch it for them, which is
   * somebody else's bandwidth bill and somebody else's abuse report.
   */
  const refuses = [
    ['a host of their choosing', 'https://example.com/evil.mp3'],
    ['a lookalike domain', 'https://freesound.org.evil.com/a.mp3'],
    ['a host ending in the name', 'https://notfreesound.org/a.mp3'],
    ['plain http', 'http://freesound.org/a.mp3'],
    ['something that is not an address', 'not a url'],
    ['a local address', 'https://localhost/a.mp3'],
    ['the metadata service', 'http://169.254.169.254/latest/meta-data/'],
  ] as const;

  it.each(refuses)('refuses %s', async (_what, from) => {
    const { fetching, calls } = upstream(ok('x', 'audio/mpeg'));
    const reply = await serveFreesound({ what: 'sound', query: null, licence: null, from }, KEY, fetching);

    expect(reply.status).toBe(400);
    expect(JSON.parse(body(reply)).error).toBe('bad-sound');
    // And it never went and looked.
    expect(calls).toEqual([]);
  });

  const allows = [
    'https://freesound.org/data/previews/1/1_1-hq.mp3',
    'https://cdn.freesound.org/previews/1/1_1-hq.mp3',
  ];

  it.each(allows)('fetches %s', async (from) => {
    const { fetching, calls } = upstream(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
    );
    const reply = await serveFreesound({ what: 'sound', query: null, licence: null, from }, KEY, fetching);

    expect(reply.status).toBe(200);
    expect(reply.type).toBe('audio/mpeg');
    expect(calls).toEqual([from]);
  });

  it('passes on an upstream refusal without its body', async () => {
    const { fetching } = upstream(new Response(`gone, token ${KEY}`, { status: 404 }));
    const reply = await serveFreesound(
      { what: 'sound', query: null, licence: null, from: 'https://freesound.org/a.mp3' },
      KEY,
      fetching,
    );
    expect(reply.status).toBe(404);
    expect(body(reply)).not.toContain(KEY);
  });

  it('asks for an address at all', async () => {
    const { fetching } = upstream(ok('x'));
    const reply = await serveFreesound(
      { what: 'sound', query: null, licence: null, from: null },
      KEY,
      fetching,
    );
    expect(reply.status).toBe(400);
  });
});

describe('anything else', () => {
  it.each([null, 'delete', 'upload'])('is refused: %s', async (what) => {
    const { fetching, calls } = upstream(ok('{}'));
    const reply = await serveFreesound({ what, query: 'x', licence: null, from: null }, KEY, fetching);
    expect(reply.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('reading the ask off a URL', () => {
  it('takes the four things it needs and nothing else', () => {
    const url = new URL('https://example.com/api/freesound?what=search&q=door&licence=cc0&from=https://a');
    expect(askFrom(url)).toEqual({
      what: 'search',
      query: 'door',
      licence: 'cc0',
      from: 'https://a',
    });
  });

  it('reads an empty URL as an empty ask', () => {
    expect(askFrom(new URL('https://example.com/api/freesound'))).toEqual({
      what: null,
      query: null,
      licence: null,
      from: null,
    });
  });
});
