/**
 * The voiceover proxy, as Vercel runs it.
 *
 * Everything of substance is in `serveNarrate`, which knows nothing about any
 * host: this file is only the adapter, so the same code answers in production,
 * in `vite dev` and in the tests.
 *
 * Set `GRADIUM_KEY` in the project's environment variables. Without one the app
 * runs exactly as before and says the voiceover screen is off.
 */
import { askFrom, serveNarrate } from '../src/audio/narrate-proxy.ts';

export const config = { runtime: 'edge' };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'bad-method', message: 'Post an ask.' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    });
  }

  let sent: unknown = null;
  try {
    sent = await request.json();
  } catch {
    // An unreadable body is an empty ask, which `askFrom` turns into a refusal
    // with a sentence rather than a stack trace.
  }

  const reply = await serveNarrate(askFrom(sent), process.env.GRADIUM_KEY);
  return new Response(reply.body, {
    status: reply.status,
    headers: {
      'content-type': reply.type,
      /*
       * Never cached, unlike the Freesound previews next door. Every one of
       * these is either a fresh draw from the model or a line somebody is still
       * editing, so there is nothing here a second request would want again.
       */
      'cache-control': 'no-store',
    },
  });
}
