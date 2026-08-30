import { defineConfig, devices } from '@playwright/test';

/**
 * A Chromium that is already on the machine, when there is one.
 *
 * Playwright pins an exact browser build and fetches it, which is what should
 * happen on CI: the version in the lockfile is the version the tests ran
 * against. Some machines already carry a Chromium of their own and cannot
 * reach the download — a locked-down container, an offline checkout — and
 * there the pin is the only thing standing between them and a suite that
 * could otherwise run fine. So the path can be given, and nothing changes for
 * anybody who does not give it.
 */
const ownChromium = process.env.CHROMIUM_PATH;

/**
 * The browser tests.
 *
 * Everything under `src/**\/*.test.ts` is a pure function measured in Node,
 * which is the right shape for what a curve means or what a WAV header says.
 * It is the wrong shape for the interface, and the interface is where the
 * faults have actually been: a tool cursor that was set on the wrong element
 * and changed nothing, a blade that matched a class name that did not exist,
 * a drop zone that collapsed before the drop was worked out, two panel tabs
 * sitting past the edge of a column with nothing saying so. Every one of
 * those was found by driving a browser by hand and then forgotten, because
 * the script that found it lived in a temporary folder.
 *
 * So these run against the built site rather than the dev server. The dock
 * tab fault was found by comparing the built artifact to the design and would
 * not have shown up any other way; testing what actually ships costs one
 * build and removes a whole class of "worked locally".
 */
export default defineConfig({
  testDir: './test/browser',
  // A fault that only appears sometimes is still a fault, and retrying until
  // it passes is how a flake becomes permanent. Failures are failures.
  retries: 0,
  fullyParallel: true,
  // One at a time on CI, where the runner has two cores and a parallel run
  // measuring layout gets its measurements from a machine under load.
  workers: process.env.CI ? 1 : undefined,
  /*
   * On CI: annotations on the failing lines, a line per test in the log, and
   * an HTML report kept as an artifact -- which is the only way to see what a
   * headless run on somebody else's machine actually did.
   */
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://127.0.0.1:4173',
    // Kept only for the run that failed, which is the only one anybody wants
    // to look at.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        /*
         * A fixed window, because half of what these check is measured in
         * pixels: what is clipped at 1280, whether a tab sits past the edge
         * of a column. A default that varies by machine would make those
         * assertions mean different things in different places.
         */
        viewport: { width: 1440, height: 900 },
        ...(ownChromium ? { launchOptions: { executablePath: ownChromium } } : {}),
      },
    },
  ],

  /*
   * Built once, then served.
   *
   * `vite preview` refuses to start without a build, so the command does
   * both. Reused when it is already up, so running these repeatedly while
   * working on one does not rebuild the site every time.
   *
   * `--host 127.0.0.1` names the interface rather than leaving it to be
   * worked out. Vite asks Node not to reorder what a name resolves to, so
   * `localhost` binds to whichever address the machine's hosts file happens
   * to list first: on a machine that has only `127.0.0.1 localhost` that is
   * IPv4 and everything works, and on one that also has `::1 localhost` --
   * which is the Ubuntu default, and so what CI runs on -- it binds to IPv6
   * alone and nothing ever answers here. That cost a CI run that timed out
   * after two minutes without starting a single test.
   *
   * Its output is passed through for the same reason: when the server does
   * not come up, the timeout says only that it did not, and whatever the
   * build or the server said about why is thrown away.
   */
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
