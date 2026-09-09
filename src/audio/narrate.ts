/**
 * Making a voiceover, from the browser's side.
 *
 * Every call goes to this app's own `/api/narrate`, never to Gradium. What is
 * beyond that endpoint is the proxy's business — see `narrate-proxy.ts` for why
 * the key cannot be here.
 *
 * The shape of the work is set by the API and is worth stating once. A narrator
 * from the catalogue can be used immediately. A narrator you describe arrives as
 * candidates instead: drafts that take a few seconds to be made, can only read a
 * hundred characters, and disappear after thirty days unless kept. Keeping one
 * turns it into a narrator like any other. So designing is four steps where
 * choosing is none, and the screen has to show that rather than hide it.
 *
 * Nothing here touches the page.
 */

/** The app's own endpoint. */
const API = '/api/narrate';

/** How long to keep asking whether a candidate is ready, and how often. */
const EVERY_MS = 2000;
const GIVE_UP_MS = 120_000;

/** A voice that can read a script: from the catalogue, or one somebody kept. */
export interface Narrator {
  id: string;
  name: string;
  /** What it sounds like, when the catalogue says. */
  about: string;
  /** The language it was made for, or null when it does not say. */
  language: string | null;
  /** Whether it came with the catalogue rather than being designed here. */
  stock: boolean;
}

/** A narrator being made: a draft, until it is kept. */
export interface Candidate {
  id: string;
  ready: boolean;
}

/** What went wrong, in terms somebody can act on. */
export type NarrateFault =
  | { kind: 'off'; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'quota'; message: string }
  | { kind: 'no-room'; message: string }
  | { kind: 'too-long'; message: string }
  | { kind: 'unreachable'; message: string }
  | { kind: 'unexpected'; message: string };

export class NarrateError extends Error {
  readonly fault: NarrateFault;
  constructor(fault: NarrateFault) {
    super(fault.message);
    this.name = 'NarrateError';
    this.fault = fault;
  }
}

/** Post an ask and get JSON back, or throw something worth showing. */
async function ask(body: Record<string, unknown>): Promise<unknown> {
  const reply = await post(body);
  try {
    return await reply.json();
  } catch {
    throw new NarrateError({
      kind: 'unexpected',
      message: 'The voiceover service answered with something that could not be read.',
    });
  }
}

/** Post an ask and get the raw reply, having turned any refusal into a fault. */
async function post(body: Record<string, unknown>): Promise<Response> {
  let reply: Response;
  try {
    reply = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new NarrateError({
      kind: 'unreachable',
      message: 'The voiceover service could not be reached.',
    });
  }
  if (reply.ok) return reply;

  /*
   * A deployment without a key answers 503 `not-configured`, and that is a
   * normal state rather than a fault: the rest of the app is unaffected, so the
   * screen says the voiceover is off rather than showing an error.
   */
  let kind: NarrateFault['kind'] = 'unexpected';
  let said = '';
  try {
    const told = (await reply.json()) as { error?: string; message?: string };
    said = typeof told.message === 'string' ? told.message : '';
    if (told.error === 'not-configured') kind = 'off';
    else if (told.error === 'no-room') kind = 'no-room';
    else if (told.error === 'long-script' || told.error === 'long-audition') kind = 'too-long';
    else if (reply.status === 401 || reply.status === 403) kind = 'refused';
    else if (reply.status === 429) kind = 'quota';
  } catch {
    // Something that did not answer in JSON is answering for something else —
    // a 404 from a deployment with no function at all, most likely.
    if (reply.status === 404) {
      throw new NarrateError({
        kind: 'off',
        message: 'This deployment has no voiceover service, so making one is off.',
      });
    }
  }
  throw new NarrateError({
    kind,
    message: said || `The voiceover service answered ${reply.status}.`,
  });
}

/** Every narrator this deployment can use. */
export async function narrators(): Promise<Narrator[]> {
  const told = await ask({ what: 'narrators' });
  if (!Array.isArray(told)) return [];
  const out: Narrator[] = [];
  for (const one of told) {
    if (!one || typeof one !== 'object') continue;
    const voice = one as Record<string, unknown>;
    if (typeof voice.uid !== 'string' || typeof voice.name !== 'string') continue;
    out.push({
      id: voice.uid,
      name: voice.name,
      about: typeof voice.description === 'string' ? voice.description : '',
      language: typeof voice.language === 'string' ? voice.language : null,
      stock: voice.is_catalog === true,
    });
  }
  return out;
}

/** Sample some candidates from a description of a narrator. */
export async function design(
  prompt: string,
  language: string,
  howMany: number,
): Promise<Candidate[]> {
  const told = await ask({ what: 'design', prompt, language, howMany });
  const found = (told as { embeddings?: unknown })?.embeddings;
  if (!Array.isArray(found)) return [];
  const out: Candidate[] = [];
  for (const one of found) {
    const made = one as Record<string, unknown>;
    if (typeof made?.embedding_id === 'string') {
      out.push({ id: made.embedding_id, ready: made.ready === true });
    }
  }
  return out;
}

/** Whether one candidate has finished being made. */
export async function isReady(candidate: string): Promise<boolean> {
  const told = await ask({ what: 'ready', candidate });
  const found = (told as { embeddings?: unknown })?.embeddings;
  if (!Array.isArray(found) || !found.length) return false;
  return (found[0] as Record<string, unknown>)?.ready === true;
}

/**
 * Wait until every candidate is ready, saying how it is going.
 *
 * Bounded, because the one failure this API has is silent: an argument it does
 * not recognise comes back as a success whose candidates never become ready. So
 * a timeout here is reported as a fault rather than waited on forever.
 */
export async function waitUntilReady(
  candidates: readonly Candidate[],
  onStep?: (done: number, of: number) => void,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((wake) => setTimeout(wake, ms)),
  now: () => number = () => Date.now(),
): Promise<void> {
  const pending = new Set(candidates.map((one) => one.id));
  const until = now() + GIVE_UP_MS;
  onStep?.(candidates.length - pending.size, candidates.length);

  while (pending.size) {
    for (const id of [...pending]) {
      if (await isReady(id)) {
        pending.delete(id);
        onStep?.(candidates.length - pending.size, candidates.length);
      }
    }
    if (!pending.size) return;
    if (now() > until) {
      throw new NarrateError({
        kind: 'unexpected',
        message: 'The narrators are taking longer than they should. Try describing them again.',
      });
    }
    await wait(EVERY_MS);
  }
}

/** Read a line, and hand back the sound of it. */
export async function say(text: string, narrator: string): Promise<Blob> {
  const reply = await post({ what: 'say', text, narrator });
  const sound = await reply.blob();
  if (!sound.size) {
    throw new NarrateError({ kind: 'unexpected', message: 'The voiceover came back empty.' });
  }
  return sound;
}

/** Keep a candidate, which turns it into a narrator that can read a whole script. */
export async function keep(candidate: string, name: string): Promise<Narrator> {
  const told = (await ask({ what: 'keep', candidate, name })) as Record<string, unknown>;
  if (typeof told?.uid !== 'string') {
    throw new NarrateError({
      kind: 'unexpected',
      message: 'That narrator was not kept, and the service did not say why.',
    });
  }
  return {
    id: told.uid,
    name: typeof told.name === 'string' ? told.name : name,
    about: typeof told.description === 'string' ? told.description : '',
    language: typeof told.language === 'string' ? told.language : null,
    stock: false,
  };
}

/** Throw away a candidate nobody kept. */
export async function drop(candidate: string): Promise<void> {
  await ask({ what: 'drop', candidate });
}
