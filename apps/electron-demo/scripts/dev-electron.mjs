import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { build } from "tsup";

const require = createRequire(import.meta.url);
const RENDERER_PORTS = [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180];
const RENDERER_READY_TIMEOUT_MS = 30_000;
const RENDERER_PROBE_INTERVAL_MS = 250;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findRendererUrl() {
  const deadline = Date.now() + RENDERER_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    for (const port of RENDERER_PORTS) {
      const url = `http://localhost:${port}`;
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) continue;

        const html = await response.text();
        if (html.includes("<title>Nexus Editor Demo</title>") && html.includes('<div id="app"></div>')) {
          return url;
        }
      } catch {
        // Keep probing until Vite becomes ready.
      }
    }

    await delay(RENDERER_PROBE_INTERVAL_MS);
  }

  throw new Error("Could not detect Nexus renderer dev server URL within 30s");
}

await build({
  entry: ["electron/main.ts", "electron/preload.ts"],
  outDir: "dist-electron",
  format: "cjs",
  platform: "node",
  external: ["electron"],
  clean: true,
  silent: true,
});

const rendererUrl = await findRendererUrl();

const electronPath = require("electron");
const child = spawn(String(electronPath), ["dist-electron/main.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: rendererUrl,
  },
});

child.on("close", () => process.exit());
