import { readFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
for (const entry of Object.values(manifest.exports)) {
  await access(new URL(entry.import, root));
  if (entry.types) await access(new URL(entry.types, root));
}
const checked = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "--noEmit", "-p", fileURLToPath(new URL("api/tsconfig.json", root))], { stdio: "inherit" });
if (checked.status !== 0) process.exit(checked.status ?? 1);
assert.equal(typeof globalThis.document, "undefined");
const api = await import("@floatboat/nexus-document");
assert.deepEqual(Object.keys(api).sort(), ["DocumentLimitError", "createConversionAssetProvider"]);
const { convertHtml } = await import("@floatboat/nexus-document/html");
const { exportHtml } = await import("@floatboat/nexus-document/export-html");
const result = await convertHtml("<h1>Public API</h1>");
const output = await exportHtml(result.markdown);
assert.ok(output.html.includes("Public API"));
assert.equal(typeof globalThis.document, "undefined");
process.stdout.write("document public entrypoint, declaration and no-DOM checks passed\n");
