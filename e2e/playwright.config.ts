import { defineConfig } from "@playwright/test";
import path from "node:path";

/**
 * Playwright E2E test configuration for Nexus-Editor Electron demo.
 *
 * Runs the Electron app in headless mode and exercises core user flows.
 * Prerequisites: `pnpm build` must succeed before running E2E tests.
 */
export default defineConfig({
  testDir: path.resolve(__dirname, "tests"),
  timeout: 30_000,
  retries: 1,
  workers: 1, // Electron tests must be serial (single app instance)
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },
});
