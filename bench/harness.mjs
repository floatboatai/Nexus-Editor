/**
 * Minimal zero-dependency benchmark harness for Nexus-Editor.
 *
 * Runs against the built packages (`pnpm build` first), drives a real editor
 * in jsdom, and reports median / p95 over a fixed sample count so numbers are
 * comparable between runs on the same machine.
 *
 * @typedef {Object} Sample
 * @property {number} median
 * @property {number} p95
 * @property {number} min
 * @property {number} max
 * @property {number} samples
 *
 * @typedef {Object} Row
 * @property {string} scenario
 * @property {string} subject
 * @property {string} metric
 * @property {number} value
 * @property {string} unit
 */

import { JSDOM } from "jsdom";

/**
 * Install the DOM globals CodeMirror needs, once per process. The globals
 * live for the whole run because the editor holds them.
 */
export function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  globalThis.Range = dom.window.Range;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.Element = dom.window.Element;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.SVGElement = dom.window.SVGElement;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/**
 * Run `fn` `warmup` times untouched, then `samples` timed runs. Returns
 * median / p95 / min / max in milliseconds.
 *
 * @param {() => void} fn
 * @param {{ warmup?: number, samples?: number }} [options]
 * @returns {Sample}
 */
export function measure(fn, options) {
  const warmup = options?.warmup ?? 5;
  const samples = options?.samples ?? 30;
  for (let i = 0; i < warmup; i++) fn();
  const times = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    median: percentile(times, 0.5),
    p95: percentile(times, 0.95),
    min: times[0],
    max: times[times.length - 1],
    samples,
  };
}

/**
 * @param {Row[]} rows
 */
export function printTable(rows) {
  const header = ["scenario", "subject", "metric", "median", "unit"];
  const body = rows.map((row) => [
    row.scenario,
    row.subject,
    row.metric,
    row.value.toFixed(2),
    row.unit,
  ]);
  const widths = header.map((column, i) =>
    Math.max(column.length, ...body.map((cells) => cells[i].length))
  );
  const line = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ");
  console.log(line(header));
  console.log(widths.map((width) => "-".repeat(width)).join("-|-"));
  for (const cells of body) console.log(line(cells));
}
