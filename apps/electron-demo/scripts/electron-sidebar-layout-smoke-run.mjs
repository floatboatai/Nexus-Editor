import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.dirname(scriptsDir);
const userData = path.join(appDir, ".electron-sidebar-smoke");
const require = createRequire(import.meta.url);

function fail(message, details = {}) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    smoke: "electron-sidebar-layout",
    error: { message },
    ...details,
  })}\n`);
  process.exitCode = 1;
}

let electronPath;
try {
  electronPath = require("electron");
} catch (error) {
  fail("Electron dependency is not installed", {
    cause: error instanceof Error ? error.message : String(error),
  });
  process.exit();
}
if (typeof electronPath !== "string" || !fs.existsSync(electronPath)) {
  fail("Electron dependency did not resolve to an executable", { electronPath });
  process.exit();
}

fs.rmSync(userData, { recursive: true, force: true });
const main = path.join(scriptsDir, "electron-sidebar-layout-smoke-main.cjs");
const args = [main];
if (process.platform === "linux") args.unshift("--no-sandbox");

let executable = electronPath;
let executableArgs = args;
if (process.platform === "linux" && !process.env.DISPLAY) {
  const xvfb = spawnSync("which", ["xvfb-run"], { encoding: "utf8" });
  if (xvfb.status !== 0 || !xvfb.stdout.trim()) {
    fail("Linux Electron smoke needs DISPLAY or xvfb-run");
    process.exit();
  }
  executable = xvfb.stdout.trim();
  executableArgs = ["-a", electronPath, ...args];
}

const result = spawnSync(executable, executableArgs, {
  cwd: appDir,
  encoding: "utf8",
  timeout: 40_000,
  env: {
    ...process.env,
    NEXUS_ELECTRON_SIDEBAR_SMOKE_USER_DATA: userData,
    NEXUS_PLUGIN_PLATFORM: "0",
    VITE_NEXUS_PLUGIN_PLATFORM: "0",
  },
});
const resultLine = result.stdout.trim().split(/\r?\n/u).reverse().find((line) => {
  try { return JSON.parse(line).smoke === "electron-sidebar-layout"; }
  catch { return false; }
});
if (!resultLine) {
  fail("Electron smoke did not emit a machine-readable result", {
    process: { status: result.status, signal: result.signal, error: result.error?.message },
    stdout: result.stdout,
    stderr: result.stderr,
  });
} else {
  process.stdout.write(`${resultLine}\n`);
  const parsed = JSON.parse(resultLine);
  if (result.status !== 0 || parsed.ok !== true) process.exitCode = 1;
}
fs.rmSync(userData, { recursive: true, force: true });
