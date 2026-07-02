import { test as base, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Custom Playwright test fixture that launches the Nexus-Editor Electron app.
 *
 * Usage:
 * ```ts
 * import { test, expect } from "./helpers/electron-fixture";
 *
 * test("editor loads", async ({ page }) => {
 *   await expect(page.locator(".cm-editor")).toBeVisible();
 * });
 * ```
 */
export const test = base.extend<{ electronApp: ElectronApplication; page: Page }>({
  electronApp: async ({}, use) => {
    const appPath = path.resolve(__dirname, "../../apps/electron-demo");
    const app = await electron.launch({
      args: [path.join(appPath, "dist-electron/main.js")],
      cwd: appPath,
      env: {
        ...process.env,
        NODE_ENV: "test",
      },
    });
    await use(app);
    await app.close();
  },
  page: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    // Wait for the editor to fully render
    await window.waitForSelector(".cm-editor", { timeout: 10_000 });
    await use(window);
  },
});

export { expect } from "@playwright/test";
