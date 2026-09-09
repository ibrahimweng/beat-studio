import { describe, expect, it } from 'vitest';
import { askFrom, mendWav, serveNarrate } from './narrate-proxy.ts';

/**
 * The half of the voiceover that runs on a server.
 *
 * Everything here is driven with a stand-in for `fetch`, so no test needs a key,
 * a network or an account. What is being checked is the part this app is
 * responsible for: what it refuses before spending anything, what it never says
 * out loud, and what it fixes on the way back.
 */

const KEY = 'a-key-that-is-not-real';

/** A stand-in for `fetch` that records what it was asked and answers as told. */
function answering(reply: {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}): { fetching: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetching = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: reply.ok ?? true,
      status: reply.status ?? 200,
      headers: new Headers(reply.headers ?? {}),
      text: async () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)),
      json: async () => reply.body,
      arrayBuffer: async () =>
        reply.body instanceof ArrayBuffer ? reply.body : new ArrayBuffer(0),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetching, calls };
}

/** Whatever a reply said, as an object. */
const read = (body: string | ArrayBuffer): Record<string, unknown> =>
  JSON.parse(typeof body === 'string' ? body : '{}');

describe('answering the browser', () => {
  /*
   * A deployment with no key is a normal state, not a fault.
   *
   * Everything else in this app works without one, so this says so in a sentence
   * the screen can show, and nothing is called.
   */
  it('says the voiceover is off when there is no key', async () => {
    const { fetching, calls } = answering({});
    const reply = await serveNarrate({ what: 'narrators' }, undefined, fetching);
    expect(reply.status).toBe(503);
    expect(read(reply.body).error).toBe('not-configured');
    expect(calls).toHaveLength(0);
  });

  it('refuses an ask it does not know', async () => {
    const { fetching, calls } = answering({});
    const reply = await serveNarrate({ what: 'sing' }, KEY, fetching);
    expect(reply.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('what it refuses before spending anything', () => {
  /*
   * A candidate cannot read more than a hundred characters.
   *
   * Gradium's limit, not this app's, and the reason to enforce it here is that
   * the alternative is a 400 from somebody else's API in somebody else's
   * wording, after a request that was never going to work.
   */
  it('will not send a whole script to a candidate', async () => {
    const { fetching, calls } = answering({});
    const reply = await serveNarrate(
      { what: 'say', text: 'a'.repeat(101), narrator: 'vox_emb_abc' },
      KEY,
      fetching,
    );
    expect(reply.status).toBe(400);
    expect(read(reply.body).error).toBe('long-audition');
    expect(String(read(reply.body).message)).toContain('Keep it first');
    expect(calls, 'nothing should have been spent').toHaveLength(0);
  });

  it('lets a kept narrator read far more than a candidate can', async () => {
    const { fetching, calls } = answering({ body: new ArrayBuffer(8) });
    const reply = await serveNarrate(
      { what: 'say', text: 'a'.repeat(101), narrator: 'b0ntuVzgFdUGoSPc' },
      KEY,
      fetching,
    );
    expect(reply.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it('has a limit of its own for a script, and says what it is', async () => {
    const { fetching, calls } = answering({});
    const reply = await serveNarrate(
      { what: 'say', text: 'a'.repeat(2001), narrator: 'b0ntuVzgFdUGoSPc' },
      KEY,
      fetching,
    );
    expect(reply.status).toBe(400);
    expect(read(reply.body).error).toBe('long-script');
    expect(calls).toHaveLength(0);
  });

  it('asks for a description, a language it speaks, and a sane number', async () => {
    const { fetching } = answering({ body: { embeddings: [] } });
    expect((await serveNarrate({ what: 'design', prompt: '  ' }, KEY, fetching)).status).toBe(400);
    expect(
      (await serveNarrate({ what: 'design', prompt: 'a'.repeat(501) }, KEY, fetching)).status,
    ).toBe(400);
    expect(
      (await serveNarrate({ what: 'design', prompt: 'A calm reader', language: 'jp' }, KEY, fetching))
        .status,
    ).toBe(400);
  });

  it('holds the number of candidates inside what the API allows', async () => {
    const { fetching, calls } = answering({ body: { embeddings: [] } });
    await serveNarrate({ what: 'design', prompt: 'A calm reader', howMany: 99 }, KEY, fetching);
    expect(JSON.parse(String(calls[0].init?.body)).n_samples).toBe(5);
  });

  /*
   * No `json_config` is sent, and that is the whole point of this test.
   *
   * Gradium recognises four keys there and refuses none: an unknown key or an
   * out-of-range value comes back 201, and the candidates then never become
   * ready. Sending none of them is the only way that cannot happen, so if
   * somebody adds one later this test should make them think about it.
   */
  it('sends no generation settings, which is what stops a silent hang', async () => {
    const { fetching, calls } = answering({ body: { embeddings: [] } });
    await serveNarrate({ what: 'design', prompt: 'A calm reader' }, KEY, fetching);
    const sent = JSON.parse(String(calls[0].init?.body));
    expect(sent).toEqual({ prompt: 'A calm reader', language: 'en', n_samples: 3 });
    expect(sent.json_config).toBeUndefined();
  });
});

describe('what it never says out loud', () => {
  /*
   * The upstream status is passed on, and never the body.
   *
   * An error from an API can quote the request back, and the request has the key
   * in it. Echoing it would undo the only thing this file exists for.
   */
  it('passes on a refusal without passing on the key', async () => {
    const { fetching } = answering({
      ok: false,
      status: 401,
      body: { detail: `Invalid credentials for x-api-key ${KEY}` },
    });
    const reply = await serveNarrate({ what: 'narrators' }, KEY, fetching);
    expect(reply.status).toBe(401);
    expect(String(reply.body)).not.toContain(KEY);
    expect(read(reply.body).error).toBe('refused');
  });

  it('says a rate limit is a rate limit', async () => {
    const { fetching } = answering({ ok: false, status: 429, body: { detail: 'slow down' } });
    const reply = await serveNarrate({ what: 'narrators' }, KEY, fetching);
    expect(read(reply.body).error).toBe('too-fast');
  });

  /*
   * Running out of room is its own sentence, because it is somebody else's
   * doing. Kept narrators come out of one pool belonging to the deployment, so
   * this can fail for a person who has kept nothing at all.
   */
  it('says when the deployment has no room for another narrator', async () => {
    const { fetching } = answering({ ok: false, status: 409, body: { detail: 'limit' } });
    const reply = await serveNarrate({ what: 'keep', candidate: 'vox_emb_a' }, KEY, fetching);
    expect(reply.status).toBe(409);
    expect(read(reply.body).error).toBe('no-room');
  });
});

describe('the small mercies', () => {
  it('treats a candidate that is already gone as dropped', async () => {
    const { fetching } = answering({ ok: false, status: 404 });
    const reply = await serveNarrate({ what: 'drop', candidate: 'vox_emb_a' }, KEY, fetching);
    expect(reply.status).toBe(200);
  });

  it('asks the catalogue for the catalogue', async () => {
    const { fetching, calls } = answering({ body: [] });
    await serveNarrate({ what: 'narrators' }, KEY, fetching);
    expect(calls[0].url).toContain('include_catalog=true');
  });

  it('reads an ask off whatever was posted, and nothing off nonsense', async () => {
    expect(askFrom({ what: 'say', text: 'hello', howMany: 2 })).toMatchObject({
      what: 'say',
      text: 'hello',
      howMany: 2,
    });
    expect(askFrom(null).what).toBeNull();
    expect(askFrom('a string').what).toBeNull();
    // A number where a word belongs is dropped rather than passed through.
    expect(askFrom({ what: 7 }).what).toBeNull();
  });
});

/**
 * Putting the real lengths into a WAV header.
 *
 * Gradium streams the audio, so the header carries placeholder lengths. It
 * matters here more than it would elsewhere: this app writes a recording's
 * duration down before anything is decoded, because the timeline needs a length
 * to draw a placed sound with, and a length read from a placeholder is wrong.
 */
describe('mending a streamed WAV', () => {
  /** A WAV of `samples` bytes of audio, with whatever lengths are asked for. */
  function wav(samples: number, riffSays: number, dataSays: number, extra = false): ArrayBuffer {
    const pad = extra ? 12 : 0;
    const bytes = new Uint8Array(44 + pad + samples);
    const view = new DataView(bytes.buffer);
    const text = (at: number, what: string): void => {
      for (let i = 0; i < what.length; i++) view.setUint8(at + i, what.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, riffSays, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    let at = 36;
    if (extra) {
      // A chunk between `fmt ` and `data`, which an encoder is free to write.
      text(at, 'fact');
      view.setUint32(at + 4, 4, true);
      at += 12;
    }
    text(at, 'data');
    view.setUint32(at + 4, dataSays, true);
    return bytes.buffer;
  }

  /*
   * Where the data size sits: four bytes after the `data` tag, which is at 36
   * normally and at 48 when a twelve byte `fact` chunk has been put in front of
   * it. Getting this wrong reads the tag itself, which comes out as 1635017060.
   */
  const sizes = (body: ArrayBuffer, extra = false): { riff: number; data: number } => {
    const view = new DataView(body);
    return { riff: view.getUint32(4, true), data: view.getUint32(extra ? 52 : 40, true) };
  };

  it('writes the real lengths over a placeholder', () => {
    const mended = mendWav(wav(1000, 0, 0));
    expect(sizes(mended)).toEqual({ riff: 44 + 1000 - 8, data: 1000 });
  });

  it('finds the samples past a chunk it was not expecting', () => {
    const mended = mendWav(wav(500, 0, 0, true));
    expect(sizes(mended, true)).toEqual({ riff: 44 + 12 + 500 - 8, data: 500 });
  });

  it('leaves a header that was already right alone', () => {
    const already = wav(64, 44 + 64 - 8, 64);
    expect(sizes(mendWav(already))).toEqual({ riff: 44 + 64 - 8, data: 64 });
  });

  it('hands back anything that is not a WAV untouched', () => {
    const notAWav = new Uint8Array(60).fill(7).buffer;
    expect(new Uint8Array(mendWav(notAWav))).toEqual(new Uint8Array(60).fill(7));
    // And something far too short to have a header at all.
    expect(mendWav(new ArrayBuffer(8)).byteLength).toBe(8);
  });
});
