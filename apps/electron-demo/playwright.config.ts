import { defineConfig } from "@playwright/test";
import path from "node:path";

const outputDir = path.resolve(__dirname, "test-results");
const reportDir = path.resolve(__dirname, "playwright-report");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: reportDir }],
  ],
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
