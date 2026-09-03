import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { build } from "tsup";
import { electronBuildOptions } from "../tsup.config.mjs";
import { waitForRendererDevServer } from "./wait-for-renderer.mjs";

const require = createRequire(import.meta.url);

await build({
  ...electronBuildOptions,
  silent: true,
});

const rendererDevUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
await waitForRendererDevServer(rendererDevUrl);

const electronPath = require("electron");
const child = spawn(String(electronPath), ["dist-electron/main.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: rendererDevUrl,
  },
});

child.on("close", () => process.exit());
