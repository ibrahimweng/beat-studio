import { defineConfig } from 'vitest/config';

/**
 * The test runner.
 *
 * Kept apart from `vite.config.ts` because that file exists to add the
 * Freesound proxy to the dev server, and a test run has no dev server for it
 * to attach to.
 *
 * Node rather than a fake browser. Everything worth testing in this codebase
 * is a plain function of its inputs: what kind of moment a curve describes,
 * what sound belongs on it, what a WAV header says, what the proxy answers.
 * The two rules the app is built on, that nothing in `audio/` touches the
 * page and nothing in `ui/` reaches the engine, are what make that true, and
 * a DOM here would only hide the day one of them stops holding.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /*
     * Web Audio's names, put on the global before anything under test runs.
     *
     * Only the render tests need them, and they need them at import time
     * rather than inside a test, so it goes here rather than in the file. See
     * `test/web-audio.ts` for why rendering the graph in Node is a reasonable
     * thing to want.
     */
    setupFiles: ['./test/web-audio.ts'],
    // A test beside the thing it tests, which is how the rest of the tree is
    // arranged: one file per concern, in the folder that concern lives in.
    restoreMocks: true,
  },
});
