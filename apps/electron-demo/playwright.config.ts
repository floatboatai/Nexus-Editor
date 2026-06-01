import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for the Nexus Editor renderer E2E harness.
 *
 * Tests run against the Vite renderer server (http://localhost:5173).
 * The Electron main process and preload bridge are NOT involved —
 * window.nexusDemo is replaced by a mock in each test via addInitScript,
 * which lets CI validate the full renderer lifecycle without launching
 * a real Electron process or touching the filesystem.
 *
 * First-time setup (download Chromium once):
 *   npx playwright install --with-deps chromium
 *
 * Run all E2E tests:
 *   pnpm test:e2e
 *
 * Run in headed mode (useful for debugging):
 *   pnpm test:e2e:headed
 */
export default defineConfig({
  testDir: "./e2e",

  // Run tests sequentially to avoid port conflicts when the Vite dev
  // server is shared across the test suite.
  fullyParallel: false,

  // Hard-fail on test.only() leaking into CI.
  forbidOnly: !!process.env.CI,

  // One retry in CI to absorb transient Vite startup jitter.
  retries: process.env.CI ? 1 : 0,

  reporter: "list",

  use: {
    baseURL: "http://localhost:5173",

    // Capture a full trace on the first retry so CI artifacts contain
    // the request log, DOM snapshots, and action timeline.
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // Reuse whatever `pnpm dev:renderer` starts in the electron-demo package.
    command: "pnpm dev:renderer",
    url: "http://localhost:5173",
    // Local dev: reuse a running server to avoid the Vite cold-start delay.
    // CI: always start fresh.
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
