import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Reports packaged-app sizes and optionally gates on them. Sizes come from
// the unpacked output directory (electron-builder --dir), so no platform
// toolchain is needed — the same command works on a developer machine and in
// CI.
//
// Usage:
//   node scripts/report-package-size.mjs [--release-dir <dir>] [--json]
//     [--out <file>] [--max-app-mb <n>] [--max-asar-mb <n>]

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.dirname(scriptsDir);

function parseArgs(argv) {
  const options = {
    releaseDir: path.join(appDir, "release"),
    json: false,
    out: null,
    maxAppMb: null,
    maxAsarMb: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--release-dir") options.releaseDir = path.resolve(argv[++i] ?? "");
    else if (arg === "--json") options.json = true;
    else if (arg === "--out") options.out = path.resolve(argv[++i] ?? "");
    else if (arg === "--max-app-mb") options.maxAppMb = Number.parseFloat(argv[++i] ?? "");
    else if (arg === "--max-asar-mb") options.maxAsarMb = Number.parseFloat(argv[++i] ?? "");
    else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      process.exit(2);
    }
  }
  return options;
}

function dirSizeBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

function packagedAppName() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
    if (typeof manifest.productName === "string" && manifest.productName) return manifest.productName;
  } catch {
    // Fall through to the default name.
  }
  return "Nexus Editor";
}

function findPackagedApps(releaseDir) {
  const results = [];
  if (!fs.existsSync(releaseDir)) return results;
  for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(releaseDir, entry.name);
    const macBundle = path.join(dir, `${packagedAppName()}.app`);
    if (fs.existsSync(macBundle)) {
      results.push({ platform: "mac", dir: macBundle });
    } else if (/^linux-.*-unpacked$/u.test(entry.name)) {
      results.push({ platform: "linux", dir });
    } else if (/^win-.*-unpacked$/u.test(entry.name)) {
      results.push({ platform: "win", dir });
    }
  }
  return results;
}

function findAsar(appDirPath) {
  const isMacBundle = appDirPath.endsWith(".app");
  const resourcesDir = isMacBundle
    ? path.join(appDirPath, "Contents", "Resources")
    : path.join(appDirPath, "resources");
  const candidate = path.join(resourcesDir, "app.asar");
  return fs.existsSync(candidate) ? candidate : null;
}

const options = parseArgs(process.argv.slice(2));
const apps = findPackagedApps(options.releaseDir);
if (apps.length === 0) {
  process.stderr.write(`No packaged apps under ${options.releaseDir} — run pnpm dist:dir first.\n`);
  process.exit(1);
}

const report = apps.map(({ platform, dir }) => {
  const asarPath = findAsar(dir);
  return {
    platform,
    dir,
    appMb: Math.round((dirSizeBytes(dir) / 1024 / 1024) * 10) / 10,
    asarMb: asarPath ? Math.round((fs.statSync(asarPath).size / 1024 / 1024) * 10) / 10 : null,
  };
});

let failed = false;
for (const item of report) {
  const lines = [`${item.platform}: app ${item.appMb} MB`];
  if (item.asarMb !== null) lines.push(`app.asar ${item.asarMb} MB`);
  if (options.maxAppMb !== null && item.appMb > options.maxAppMb) {
    lines.push(`(exceeds --max-app-mb ${options.maxAppMb})`);
    failed = true;
  }
  if (options.maxAsarMb !== null && item.asarMb !== null && item.asarMb > options.maxAsarMb) {
    lines.push(`(exceeds --max-asar-mb ${options.maxAsarMb})`);
    failed = true;
  }
  process.stdout.write(`${lines.join(", ")}\n`);
}

if (options.json || options.out) {
  const json = `${JSON.stringify({ ok: !failed, apps: report })}\n`;
  if (options.out) fs.writeFileSync(options.out, json, "utf8");
  if (options.json) process.stdout.write(json);
}
process.exitCode = failed ? 1 : 0;
