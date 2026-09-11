import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Measures packaged-app launch timings by spawning the app binary, reading
// the main-process `[perf]` stdout markers, and killing the process group
// once the window is shown. Cold vs. warm runs stay visible: the first run
// populates the disk/code cache, later runs reuse it.
//
// Usage:
//   node scripts/measure-startup.mjs [--runs 5] [--app <binary-or-bundle>]

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.dirname(scriptsDir);

function parseArgs(argv) {
  const options = { runs: 5, app: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--runs") options.runs = Number.parseInt(argv[++i] ?? "", 10);
    else if (arg === "--app") options.app = argv[++i];
    else if (arg === "--help") {
      process.stdout.write("Usage: node scripts/measure-startup.mjs [--runs 5] [--app <binary-or-bundle>]\n");
      process.exit(0);
    } else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(options.runs) || options.runs < 1) options.runs = 5;
  return options;
}

function defaultAppBinary() {
  if (process.platform === "darwin") {
    return path.join(appDir, "release", "mac-arm64", "Nexus Editor.app", "Contents", "MacOS", "Nexus Editor");
  }
  if (process.platform === "linux") {
    return path.join(appDir, "release", "linux-unpacked", "nexus-editor");
  }
  return path.join(appDir, "release", "win-unpacked", "Nexus Editor.exe");
}

function resolveAppBinary(explicit) {
  const candidate = explicit ?? defaultAppBinary();
  if (candidate.endsWith(".app")) {
    return path.join(candidate, "Contents", "MacOS", path.basename(candidate, ".app"));
  }
  return candidate;
}

function parsePerfMs(text) {
  const match = /^([0-9.]+)(ms|s)$/.exec(text);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return match[2] === "s" ? value * 1000 : value;
}

function parsePerfLines(stdout) {
  const marks = {};
  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.startsWith("[perf] ")) continue;
    const [, label, timeText] = /^\[perf\] (\S+) (\S+)/u.exec(line) ?? [];
    if (!label) continue;
    const ms = parsePerfMs(timeText ?? "");
    if (ms !== null && !(label in marks)) marks[label] = Math.round(ms);
  }
  return marks;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function runOnce(binary, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(binary, [], {
      cwd: appDir,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });

    let settled = false;
    const finish = (marks, timedOut) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      if (process.platform === "win32" || child.pid === undefined) child.kill("SIGKILL");
      else {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch { child.kill("SIGKILL"); }
      }
      resolve({ marks, timedOut });
    };
    const hardTimeout = setTimeout(() => finish(parsePerfLines(stdout), true), timeoutMs);
    const markerPoll = setInterval(() => {
      const marks = parsePerfLines(stdout);
      if (marks["window-ready-to-show"] !== undefined) {
        clearInterval(markerPoll);
        // Grace period so markers that land right after the window shows
        // (e.g. did-finish-load) flush to stdout before the process dies.
        setTimeout(() => finish(parsePerfLines(stdout), false), 150);
      }
    }, 25);
    child.once("exit", () => {
      clearInterval(markerPoll);
      finish(parsePerfLines(stdout), false);
    });
    child.once("error", () => {
      clearInterval(markerPoll);
      finish({}, true);
    });
  });
}

const options = parseArgs(process.argv.slice(2));
const binary = resolveAppBinary(options.app);
if (!fs.existsSync(binary)) {
  process.stderr.write(`App binary not found: ${binary}\nBuild it first (e.g. pnpm dist:dir).\n`);
  process.exit(1);
}

const runs = [];
for (let i = 0; i < options.runs; i += 1) {
  const { marks, timedOut } = await runOnce(binary, 30_000);
  if (timedOut && marks["window-ready-to-show"] === undefined) {
    process.stderr.write(`Run ${i + 1}: timed out waiting for window-ready-to-show\n`);
  }
  runs.push({ run: i + 1, ...marks });
}

const labels = ["app-ready", "did-finish-load", "window-ready-to-show"];
const summary = {};
for (const label of labels) {
  const values = runs.map((r) => r[label]).filter((v) => typeof v === "number");
  summary[label] = { median: median(values), values };
}

for (const run of runs) {
  const cells = labels.map((label) => `${label}=${run[label] ?? "n/a"}ms`);
  process.stdout.write(`run ${run.run}: ${cells.join(" ")}\n`);
}
const summaryCells = labels.map((label) => `${label} median=${summary[label].median ?? "n/a"}ms`);
process.stdout.write(`summary (${options.runs} runs): ${summaryCells.join(" ")}\n`);

const first = runs[0]?.["window-ready-to-show"];
const warmMedian = median(runs.slice(1).map((r) => r["window-ready-to-show"]).filter((v) => typeof v === "number"));
if (typeof first === "number" && warmMedian !== null) {
  process.stdout.write(`cold-start ${first}ms, warm-start median ${warmMedian}ms (delta ${first - warmMedian}ms)\n`);
}
