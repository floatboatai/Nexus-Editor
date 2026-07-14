import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
// `electron`'s package export IS the absolute path to its executable when
// required from a plain Node process (the same resolution electron-mocha /
// spectron-style test runners rely on) — its .d.ts types the *runtime* API
// surface instead (BrowserWindow, app, ...), since that's what the import
// resolves to from *inside* an Electron process. Hence the cast.
import electronModule from "electron";
const electronBinaryPath = electronModule as unknown as string;

const APP_DIR = path.resolve(fileURLToPath(import.meta.url), "../..");

export interface AppHandle {
  app: ElectronApplication;
  page: Page;
}

/**
 * Launches the production build of the Electron demo (`dist-electron/` +
 * `dist/`, built via `pnpm build`) and returns the app + its main window.
 *
 * Requires a prior `pnpm --filter @floatboat/nexus-electron-demo build` —
 * e2e tests exercise the packaged app, not the dev server, so behavior
 * matches what a real user launches.
 */
export async function launchApp(): Promise<AppHandle> {
  const mainEntry = path.join(APP_DIR, "dist-electron/main.js");
  const rendererEntry = path.join(APP_DIR, "dist/index.html");
  if (!existsSync(mainEntry) || !existsSync(rendererEntry)) {
    throw new Error(
      `electron-demo build output not found (looked for ${mainEntry} and ${rendererEntry}). ` +
      "Run `pnpm --filter @floatboat/nexus-electron-demo build` before the e2e suite."
    );
  }

  // Some sandboxed/CI shells export ELECTRON_RUN_AS_NODE=1 (to stop a stray
  // `electron` invocation from ever opening a real GUI window). Inheriting
  // that here would make Playwright's `_electron.launch` spawn a plain Node
  // process instead of the Electron runtime, and the launch handshake would
  // simply time out. Strip it so the app always launches for real.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") env[key] = value;
  }

  const app = await electron.launch({
    executablePath: electronBinaryPath,
    args: [APP_DIR],
    env,
    timeout: 30_000,
  });

  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector(".cm-content", { timeout: 15_000 });
  return { app, page };
}

export async function closeApp(handle: AppHandle): Promise<void> {
  await handle.app.close().catch(() => {});
}

/** Types into the CM6 content area, replacing any existing text first. */
export async function setEditorText(page: Page, text: string): Promise<void> {
  const content = await page.waitForSelector(".cm-content");
  await content.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text, { delay: 10 });
}

export async function getEditorText(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector(".cm-content")?.textContent ?? "");
}
