/**
 * The part of the voiceover client that runs on a server.
 *
 * The same arrangement as `freesound-proxy.ts`, for the same reason and in the
 * same shape. A key compiled into the bundle is a key in the browser — Vite
 * inlines it into the JavaScript that ships — and it would be one key rather
 * than each person's own, so anybody could read it and spend it. So it lives in
 * the deployment's environment and never leaves it. The browser asks this, this
 * asks Gradium.
 *
 * It also removes the question this could not otherwise answer. Gradium's API
 * needs an `x-api-key` header, which is not a simple header, so every call from
 * a browser would need a cross-origin preflight to pass first. A page calling
 * its own origin has no cross-origin question to answer at all.
 *
 * Written as a plain function of its inputs rather than against a particular
 * host's request object, so the Vercel function, the dev server and the tests
 * all drive the same code. Nothing here touches the platform.
 *
 * ---
 *
 * What this deliberately does not do is speak for a candidate voice longer than
 * a hundred characters, or hand out the deployment's key in any form. What it
 * cannot do anything about is that its credits are the deployment's: anybody who
 * finds this endpoint can spend them, exactly as with the Freesound one. The
 * caps below are what keeps a single request small; a spending limit on the
 * account is what keeps a thousand of them affordable.
 */

/** What the browser asked for. */
export interface NarrateAsk {
  /** `narrators`, `design`, `ready`, `say`, `keep` or `drop`. */
  what: string | null;
  /** For `say`: the words, and who says them. */
  text?: string;
  narrator?: string;
  /** For `design`: the description, the language, and how many to sample. */
  prompt?: string;
  language?: string;
  howMany?: number;
  /** For `ready`, `keep` and `drop`: which candidate. */
  candidate?: string;
  /** For `keep`: what to call the narrator it becomes. */
  name?: string;
}

export interface NarrateReply {
  status: number;
  /** `application/json` or whatever the audio came back as. */
  type: string;
  body: string | ArrayBuffer;
}

const API = 'https://api.gradium.ai/api';

/**
 * The languages the model speaks.
 *
 * Checked here rather than passed through, because an unknown language is a
 * `422` from Gradium and a clear sentence from this.
 */
const LANGUAGES = ['en', 'fr', 'es', 'pt', 'de'];

/**
 * How much can be asked for in one go.
 *
 * `SCRIPT` is this app's own limit rather than Gradium's, which has none for a
 * kept narrator. A voiceover for a clip is a paragraph; two thousand characters
 * is about two minutes of speech, and anything longer is a different job that
 * should be asked for in pieces. `AUDITION` is Gradium's: a candidate refuses
 * anything over a hundred characters.
 */
const SCRIPT = 2000;
const AUDITION = 100;
const PROMPT = 500;

/** A candidate voice is not a kept one, and the prefix is how the API says so. */
const CANDIDATE = 'vox_emb_';

const json = (status: number, value: unknown): NarrateReply => ({
  status,
  type: 'application/json',
  body: JSON.stringify(value),
});

const said = (status: number, error: string, message: string): NarrateReply =>
  json(status, { error, message });

/**
 * Answer one request from the browser.
 *
 * `key` is the deployment's Gradium key, and a deployment without one is a
 * normal state rather than a fault: the app still does everything else, so this
 * says so plainly and the screen says the voiceover is off.
 */
export async function serveNarrate(
  ask: NarrateAsk,
  key: string | undefined,
  fetching: typeof fetch = fetch,
): Promise<NarrateReply> {
  if (!key) {
    return said(
      503,
      'not-configured',
      'This deployment has no Gradium key set, so making a voiceover is off.',
    );
  }

  const headers = { 'x-api-key': key, 'content-type': 'application/json' };

  switch (ask.what) {
    case 'narrators':
      return await listNarrators(headers, fetching);
    case 'design':
      return await design(ask, headers, fetching);
    case 'ready':
      return await ready(ask, headers, fetching);
    case 'say':
      return await say(ask, headers, fetching);
    case 'keep':
      return await keep(ask, headers, fetching);
    case 'drop':
      return await drop(ask, headers, fetching);
    default:
      return said(400, 'bad-request', 'Ask for narrators, design, ready, say, keep or drop.');
  }
}

/** Every narrator this key can use: the catalogue, and anything kept. */
async function listNarrators(headers: HeadersInit, fetching: typeof fetch): Promise<NarrateReply> {
  const reply = await fetching(`${API}/voices/?include_catalog=true&limit=1000`, { headers });
  if (!reply.ok) return upstream(reply.status);
  return { status: 200, type: 'application/json', body: await reply.text() };
}

/** Sample some candidate narrators from a description. */
async function design(
  ask: NarrateAsk,
  headers: HeadersInit,
  fetching: typeof fetch,
): Promise<NarrateReply> {
  const prompt = (ask.prompt ?? '').trim();
  if (!prompt) return said(400, 'no-prompt', 'Describe the narrator you want.');
  if (prompt.length > PROMPT) {
    return said(400, 'long-prompt', `A description is at most ${PROMPT} characters.`);
  }
  const language = ask.language ?? 'en';
  if (!LANGUAGES.includes(language)) {
    return said(400, 'bad-language', `The languages are ${LANGUAGES.join(', ')}.`);
  }
  const howMany = Math.max(1, Math.min(5, Math.round(ask.howMany ?? 3)));

  /*
   * No `json_config`, on purpose.
   *
   * Gradium accepts only four keys there, and — this is the part worth knowing —
   * an unknown key or an out-of-range value is not refused. The request comes
   * back `201` and the candidates simply never become ready. Sending none of
   * them cannot fail that way, and the defaults are the ones their own guide
   * recommends for sampling three at once.
   */
  const reply = await fetching(`${API}/voice-generator/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt, language, n_samples: howMany }),
  });
  if (!reply.ok) return upstream(reply.status);
  return { status: 200, type: 'application/json', body: await reply.text() };
}

/** Whether a candidate has finished being made. */
async function ready(
  ask: NarrateAsk,
  headers: HeadersInit,
  fetching: typeof fetch,
): Promise<NarrateReply> {
  const candidate = (ask.candidate ?? '').trim();
  if (!candidate) return said(400, 'no-candidate', 'Say which candidate.');
  const where = `${API}/voice-generator/embeddings?embedding_id=${encodeURIComponent(candidate)}`;
  const reply = await fetching(where, { headers });
  if (!reply.ok) return upstream(reply.status);
  return { status: 200, type: 'application/json', body: await reply.text() };
}

/**
 * Read a line, and hand back the audio.
 *
 * The one call that returns sound rather than a description of sound. It is also
 * where a candidate and a kept narrator differ: a candidate is a draft, so
 * Gradium refuses more than a hundred characters for it and refuses it entirely
 * on the streaming endpoints. Saying so here is a sentence; letting it through
 * is a `400` from somebody else's API with somebody else's wording.
 */
async function say(
  ask: NarrateAsk,
  headers: HeadersInit,
  fetching: typeof fetch,
): Promise<NarrateReply> {
  const text = (ask.text ?? '').trim();
  const narrator = (ask.narrator ?? '').trim();
  if (!text) return said(400, 'no-text', 'Write something for the narrator to say.');
  if (!narrator) return said(400, 'no-narrator', 'Choose a narrator first.');

  const draft = narrator.startsWith(CANDIDATE);
  const most = draft ? AUDITION : SCRIPT;
  if (text.length > most) {
    return said(
      400,
      draft ? 'long-audition' : 'long-script',
      draft
        ? `A candidate can only read ${AUDITION} characters. Keep it first to read more.`
        : `A script is at most ${SCRIPT} characters here — about two minutes.`,
    );
  }

  const reply = await fetching(`${API}/post/speech/tts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      text,
      voice_id: narrator,
      model_name: 'default',
      output_format: 'wav',
      only_audio: true,
    }),
  });
  if (!reply.ok) return upstream(reply.status);

  return {
    status: 200,
    type: reply.headers.get('content-type') ?? 'audio/wav',
    body: mendWav(await reply.arrayBuffer()),
  };
}

/** Keep a candidate, which turns it into a narrator that can read a whole script. */
async function keep(
  ask: NarrateAsk,
  headers: HeadersInit,
  fetching: typeof fetch,
): Promise<NarrateReply> {
  const candidate = (ask.candidate ?? '').trim();
  if (!candidate) return said(400, 'no-candidate', 'Say which candidate to keep.');
  const name = (ask.name ?? '').trim().slice(0, 60) || 'Narrator';

  const reply = await fetching(`${API}/voices/from-embedding`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ voxium_embedding_id: candidate, name }),
  });
  if (!reply.ok) {
    /*
     * A refusal here is usually the allowance, and it is worth its own sentence.
     * Kept narrators come out of one pool belonging to the deployment, not to
     * whoever pressed the button, so "keep" can fail for a reason that has
     * nothing to do with the person pressing it.
     */
    if (reply.status === 409) {
      return said(
        409,
        'no-room',
        'This deployment has no room for another kept narrator. Use one that is already here.',
      );
    }
    return upstream(reply.status);
  }
  return { status: 200, type: 'application/json', body: await reply.text() };
}

/** Throw away a candidate nobody kept. Always safe: a kept one holds its own copy. */
async function drop(
  ask: NarrateAsk,
  headers: HeadersInit,
  fetching: typeof fetch,
): Promise<NarrateReply> {
  const candidate = (ask.candidate ?? '').trim();
  if (!candidate) return said(400, 'no-candidate', 'Say which candidate to drop.');
  const where = `${API}/voice-generator/embeddings/${encodeURIComponent(candidate)}`;
  const reply = await fetching(where, { method: 'DELETE', headers });
  // Already gone is the state that was wanted, so it is not a failure.
  if (!reply.ok && reply.status !== 404) return upstream(reply.status);
  return json(200, { dropped: candidate });
}

/**
 * What to say when Gradium refuses.
 *
 * The status is passed on, but never the body. An error from an API can quote
 * the request back, and the request has the key in it — echoing it would undo
 * the whole reason this file exists.
 */
function upstream(status: number): NarrateReply {
  if (status === 401 || status === 403) {
    return said(status, 'refused', "This deployment's Gradium key was refused.");
  }
  if (status === 429) {
    return said(status, 'too-fast', 'Gradium is rate limiting this deployment. Try again in a minute.');
  }
  if (status === 404) {
    return said(status, 'gone', 'That narrator or candidate is not there any more.');
  }
  return said(status, 'upstream', `Gradium answered ${status}`);
}

/**
 * Put the real lengths into a WAV header.
 *
 * Gradium streams the audio, so the header it writes carries placeholder
 * lengths — their own guide says so, and says to rewrite them. It matters here
 * more than it would elsewhere: this app writes a recording's duration down
 * before anything is decoded, because the timeline needs a length to draw a
 * placed sound with, and a length read from a placeholder is wrong.
 *
 * The whole body is already in hand at this point, so the true lengths are known
 * and the fix is two numbers. Done here rather than in the browser because it is
 * the same fix for every caller and there is only one of this.
 *
 * Anything that is not a WAV is handed back untouched.
 */
export function mendWav(body: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(body);
  if (bytes.length < 44) return body;

  const view = new DataView(body);
  const tag = (at: number): string =>
    String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return body;

  /*
   * The data chunk is walked to rather than assumed to be at byte 36. It
   * usually is, but a WAV is a list of chunks and an encoder is free to put a
   * `LIST` or a `fact` in front of the samples.
   */
  let at = 12;
  while (at + 8 <= bytes.length) {
    const name = tag(at);
    const size = view.getUint32(at + 4, true);
    if (name === 'data') {
      const real = bytes.length - (at + 8);
      if (size !== real) view.setUint32(at + 4, real, true);
      view.setUint32(4, bytes.length - 8, true);
      return body;
    }
    // A chunk is padded to an even length, and a zero size would not advance.
    if (size <= 0) break;
    at += 8 + size + (size % 2);
  }
  return body;
}

/** Read an ask off whatever the browser posted. */
export function askFrom(body: unknown): NarrateAsk {
  if (!body || typeof body !== 'object') return { what: null };
  const sent = body as Record<string, unknown>;
  const word = (key: string): string | undefined =>
    typeof sent[key] === 'string' ? (sent[key] as string) : undefined;
  return {
    what: word('what') ?? null,
    text: word('text'),
    narrator: word('narrator'),
    prompt: word('prompt'),
    language: word('language'),
    howMany: typeof sent.howMany === 'number' ? sent.howMany : undefined,
    candidate: word('candidate'),
    name: word('name'),
  };
}
