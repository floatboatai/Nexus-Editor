import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.dirname(scriptsDir);
const repoDir = path.resolve(appDir, "../..");
const outputDir = path.join(appDir, ".electron-collab-smoke");
const rendererEntry = path.join(scriptsDir, "electron-collab-smoke-renderer.ts");
const mainSource = path.join(scriptsDir, "electron-collab-smoke-main.cjs");
const mainOutput = path.join(outputDir, "electron-collab-smoke-main.cjs");
const htmlOutput = path.join(outputDir, "electron-collab-smoke.html");
const timeoutMs = Number.parseInt(process.env.NEXUS_ELECTRON_SMOKE_TIMEOUT_MS ?? "25000", 10);
const require = createRequire(import.meta.url);

function fail(message, details = {}) {
  process.stdout.write(`${JSON.stringify({ ok: false, smoke: "electron-yjs-collaboration", error: { message }, ...details })}\n`);
  process.exitCode = 1;
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
const build = spawnSync(
  "corepack",
  [
    "pnpm", "--filter", "@floatboat/nexus-electron-demo", "exec", "tsup",
    rendererEntry,
    "--format", "iife",
    "--global-name", "NexusElectronCollabSmokeBundle",
    "--platform", "browser",
    "--target", "chrome134",
    "--out-dir", outputDir,
    "--clean",
    "--no-splitting",
  ],
  { cwd: repoDir, encoding: "utf8", env: process.env },
);
if (build.status !== 0) {
  fail("Failed to bundle Electron collaboration renderer", {
    build: { status: build.status, stdout: build.stdout, stderr: build.stderr },
  });
  process.exit();
}
fs.copyFileSync(mainSource, mainOutput);
fs.writeFileSync(
  htmlOutput,
  "<!doctype html><html><head><meta charset=\"utf-8\"><title>Nexus collaboration smoke</title></head><body><script src=\"./electron-collab-smoke-renderer.global.js\"></script></body></html>\n",
  "utf8",
);

let electronPath;
try {
  electronPath = require("electron").trim();
} catch (error) {
  const packageDir = path.dirname(require.resolve("electron/package.json"));
  const executable = process.platform === "darwin"
    ? "Electron.app/Contents/MacOS/Electron"
    : process.platform === "win32" ? "electron.exe" : "electron";
  const fallback = path.join(packageDir, "dist", executable);
  if (!fs.existsSync(fallback)) {
    fail("Electron dependency is not installed", { cause: error instanceof Error ? error.message : String(error) });
    process.exit();
  }
  electronPath = fallback;
}
const args = [mainOutput];
if (process.platform === "linux") args.unshift("--no-sandbox");
let executable = electronPath;
let executableArgs = args;
if (process.platform === "linux" && !process.env.DISPLAY) {
  const xvfb = spawnSync("which", ["xvfb-run"], { encoding: "utf8" });
  if (xvfb.status !== 0 || !xvfb.stdout.trim()) {
    fail("Linux Electron collaboration smoke needs DISPLAY or xvfb-run");
    process.exit();
  }
  executable = xvfb.stdout.trim();
  executableArgs = ["-a", electronPath, ...args];
}

const child = spawn(executable, executableArgs, {
  cwd: appDir,
  detached: process.platform !== "win32",
  env: { ...process.env, NEXUS_ELECTRON_SMOKE_TIMEOUT_MS: String(Math.max(1000, timeoutMs - 2000)) },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
const hardTimeout = setTimeout(() => {
  if (process.platform === "win32" || child.pid === undefined) child.kill("SIGKILL");
  else {
    try { process.kill(-child.pid, "SIGKILL"); }
    catch { child.kill("SIGKILL"); }
  }
}, timeoutMs);
const exit = await new Promise((resolve) => {
  child.once("error", (error) => resolve({ code: null, signal: null, error }));
  child.once("exit", (code, signal) => resolve({ code, signal, error: null }));
});
clearTimeout(hardTimeout);
const resultLine = stdout.trim().split(/\r?\n/u).reverse().find((line) => {
  try { return JSON.parse(line).smoke === "electron-yjs-collaboration"; }
  catch { return false; }
});
if (!resultLine) fail("Electron collaboration smoke did not emit a result", { process: exit, stdout, stderr });
else {
  process.stdout.write(`${resultLine}\n`);
  if (exit.code !== 0 || JSON.parse(resultLine).ok !== true) process.exitCode = 1;
}
fs.rmSync(outputDir, { recursive: true, force: true });
