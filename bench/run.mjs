#!/usr/bin/env node
/**
 * Benchmark entry point. Usage:
 *
 *   pnpm build          # benchmarks run against the built packages
 *   pnpm bench          # runs every scenario, prints a table, writes JSON
 *
 * Results are written to bench/results/latest.json so a run can be diffed
 * against a previous one on the same machine.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { installDom, measure, printTable } from "./harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const coreDist = path.join(here, "..", "packages", "core", "dist", "index.js");

if (!fs.existsSync(coreDist)) {
  console.error("packages/core/dist/index.js not found — run `pnpm build` before `pnpm bench`.");
  process.exit(1);
}

installDom();

const scenarioFiles = ["core-editor.mjs", "public-api.mjs"];
const rows = [];
for (const file of scenarioFiles) {
  const { run } = await import(pathToFileURL(path.join(here, "scenarios", file)).href);
  rows.push(...run(measure));
}

printTable(rows);

const outDir = path.join(here, "results");
fs.mkdirSync(outDir, { recursive: true });
const payload = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  rows,
};
fs.writeFileSync(path.join(outDir, "latest.json"), `${JSON.stringify(payload, null, 2)}\n`);
console.log(`\nwritten to bench/results/latest.json`);
