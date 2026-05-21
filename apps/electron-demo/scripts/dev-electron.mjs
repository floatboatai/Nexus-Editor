import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "tsup";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entry: ["electron/main.ts", "electron/preload.ts"],
  outDir: "dist-electron",
  format: "cjs",
  platform: "node",
  external: ["electron"],
  clean: true,
  silent: true,
});

const devServerUrl = "http://localhost:5173";

async function waitForDevServer(url, timeoutMs = 30000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The Vite server is still booting.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for Vite dev server at ${url}`);
}

await waitForDevServer(devServerUrl);

const electronPath = require("electron");
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
delete childEnv.ELECTRON_NO_ASAR;

const child = spawn(String(electronPath), ["."], {
  cwd: appRoot,
  stdio: "inherit",
  env: {
    ...childEnv,
    VITE_DEV_SERVER_URL: devServerUrl,
  },
});

child.on("error", (error) => {
  console.error("[dev-electron] Failed to start Electron:", error);
  process.exit(1);
});

child.on("close", () => process.exit());
