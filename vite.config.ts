import { defineConfig, type Plugin } from 'vite';
import { askFrom, serveFreesound } from './src/audio/freesound-proxy.ts';
import {
  askFrom as askNarrateFrom,
  serveNarrate,
} from './src/audio/narrate-proxy.ts';

/**
 * The Freesound proxy, while developing.
 *
 * In production this is a serverless function under `api/`, which the dev
 * server knows nothing about — so without this, the one path that cannot be
 * exercised locally would be the one carrying the key. Same handler, same
 * environment variable, so what is tested here is what ships.
 */
function freesoundProxy(): Plugin {
  return {
    name: 'freesound-proxy',
    configureServer(server) {
      server.middlewares.use('/api/freesound', (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        void serveFreesound(askFrom(url), process.env.FREESOUND_KEY).then((reply) => {
          response.statusCode = reply.status;
          response.setHeader('content-type', reply.type);
          response.end(
            typeof reply.body === 'string' ? reply.body : Buffer.from(reply.body),
          );
        });
      });
    },
  };
}

/**
 * The voiceover proxy, while developing.
 *
 * The same arrangement as above and for the same reason. It reads a posted body
 * rather than a query string, because a script is longer than a URL should be.
 */
function narrateProxy(): Plugin {
  return {
    name: 'narrate-proxy',
    configureServer(server) {
      server.middlewares.use('/api/narrate', (request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          let sent: unknown = null;
          try {
            sent = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            // An unreadable body is an empty ask, answered with a sentence.
          }
          void serveNarrate(askNarrateFrom(sent), process.env.GRADIUM_KEY).then((reply) => {
            response.statusCode = reply.status;
            response.setHeader('content-type', reply.type);
            response.setHeader('cache-control', 'no-store');
            response.end(
              typeof reply.body === 'string' ? reply.body : Buffer.from(reply.body),
            );
          });
        });
      });
    },
  };
}

export default defineConfig({
  // Relative base so a build can be opened from disk or served from any
  // sub-path (GitHub Pages project sites included).
  base: './',
  plugins: [freesoundProxy(), narrateProxy()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: false,
  },
});
