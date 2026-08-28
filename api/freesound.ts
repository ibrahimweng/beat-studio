/**
 * The Freesound proxy, as Vercel runs it.
 *
 * Everything of substance is in `serveFreesound`, which knows nothing about
 * any host: this file is only the adapter, so the same code answers in
 * production, in `vite dev` and in the tests.
 *
 * Set `FREESOUND_KEY` in the project's environment variables. Without one the
 * app runs exactly as before and leaves the Freesound results out.
 */
import { askFrom, serveFreesound } from '../src/audio/freesound-proxy.ts';

export const config = { runtime: 'edge' };

export default async function handler(request: Request): Promise<Response> {
  const reply = await serveFreesound(
    askFrom(new URL(request.url)),
    process.env.FREESOUND_KEY,
  );
  return new Response(reply.body, {
    status: reply.status,
    headers: {
      'content-type': reply.type,
      // A preview does not change, so let the browser and the edge keep it.
      'cache-control': reply.status === 200 ? 'public, max-age=3600' : 'no-store',
    },
  });
}
