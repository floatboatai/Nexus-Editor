import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "pnpm exec vite --config e2e-vite.config.ts",
    port: 5179,
    reuseExistingServer: true,
  },
  use: {
    baseURL: "http://localhost:5179",
  },
});
