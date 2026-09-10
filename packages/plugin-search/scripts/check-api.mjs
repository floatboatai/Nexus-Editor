import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SearchController } from "@floatboat/nexus-plugin-search/workspace";
import { rankNavigationItems } from "@floatboat/nexus-plugin-search/fuzzy";
import { createNodeSearchExecutor } from "@floatboat/nexus-plugin-search/node-worker";
import { createBrowserSearchExecutor } from "@floatboat/nexus-plugin-search/browser-worker";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";
import { createDocumentSearchController } from "@floatboat/nexus-plugin-search/headless";

const visited = new Set();
async function checkBrowserGraph(name) {
  if (visited.has(name)) return;
  visited.add(name);
  const text = await readFile(new URL(`../dist/${name}`, import.meta.url), "utf8");
  assert.doesNotMatch(text, /(?:from\s*|import\s*\()\s*["']node:|\bprocess\s*\.|\bBuffer\b/);
  for (const match of text.matchAll(/(?:from\s*|import\s*)["']\.\/([^"']+)["']/g)) {
    await checkBrowserGraph(match[1]);
  }
}
for (const name of ["index.js", "fuzzy.js", "workspace.js", "headless.js", "browser-worker.js", "search-worker.js"]) {
  await checkBrowserGraph(name);
}
assert.equal(typeof globalThis.document, "undefined");
assert.equal(typeof createBrowserSearchExecutor, "function");
assert.equal(typeof createSearchPlugin, "function");
assert.equal(typeof createDocumentSearchController, "function");
assert.deepEqual(rankNavigationItems([{ title: "Two" }, { title: "One" }], "on"), [{ title: "One" }]);

let content = "😀 needle\nneedle";
let version = "1";
const controller = new SearchController({
  executor: createNodeSearchExecutor(),
  source: {
    list: async () => [{ id: "note", path: "Note.md", version }],
    read: async () => ({ content, version }),
  },
});
try {
  await controller.search({ text: "needle" });
  assert.equal(controller.getState().hits.length, 2);
  assert.equal(controller.getState().hits[0].from, 3);
  await controller.search({ text: "[", regex: true });
  assert.equal(controller.getState().error?.code, "invalid-query");
  content = `${"a".repeat(48)}!`;
  version = "2";
  const started = performance.now();
  await controller.search({ text: "^(a+)+$", regex: true });
  assert.equal(controller.getState().error?.code, "timeout");
  assert.ok(performance.now() - started < 5000, "Worker watchdog did not settle promptly");
  await controller.search({ text: "!" });
  assert.equal(controller.getState().hits.length, 1);
  const pending = controller.search({ text: "^(a+)+$", regex: true });
  setTimeout(() => controller.cancel(), 30);
  await pending;
  assert.equal(controller.getState().status, "idle");
  assert.equal(controller.getState().hits.length, 0);
  await controller.search({ text: "!" });
  assert.equal(controller.getState().hits.length, 1);
} finally {
  await controller.destroy();
}
console.log("Search public entry graph and real Node worker checks passed");
