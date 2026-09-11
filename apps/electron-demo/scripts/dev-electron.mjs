import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { build } from "tsup";
import { prepareConversionWorker } from "./build-conversion-worker.mjs";

const require = createRequire(import.meta.url);

await prepareConversionWorker();

await build({
  config: "tsup.config.ts",
  silent: true,
});

// Wait briefly for Vite dev server (started in parallel by npm-run-all)
await new Promise((resolve) => setTimeout(resolve, 2000));

const electronPath = require("electron");
const child = spawn(String(electronPath), ["dist-electron/main.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: "http://localhost:5173",
  },
});

child.on("close", () => process.exit());
