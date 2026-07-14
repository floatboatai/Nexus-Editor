import { defineConfig } from "vitest/config";

// Separate from the root vitest.config.ts (jsdom, fast, no external process)
// on purpose: these tests spawn a real packaged Electron app via
// playwright-core and are correspondingly slow and environment-sensitive.
// Keeping them out of the default `pnpm test` run means the fast unit suite
// stays fast and hermetic; `pnpm --filter @floatboat/nexus-electron-demo
// test:e2e` (after a `build`) opts into this one explicitly.
export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Electron launches are heavy; running many in parallel on constrained
    // CI runners is a common source of launch-timeout flakiness.
    fileParallelism: false,
  },
});
