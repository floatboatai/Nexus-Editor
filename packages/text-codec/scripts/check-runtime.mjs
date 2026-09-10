import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { decodeDocumentBytes, encodeDocumentText } from "@floatboat/nexus-text-codec";
import { legacyTextCodec } from "@floatboat/nexus-text-codec/legacy";

assert.equal(decodeDocumentBytes(encodeDocumentText("Node 中文")).status, "decoded");
assert.equal(decodeDocumentBytes(encodeDocumentText("中文", { encoding: "gbk", legacyCodec: legacyTextCodec }), {
  encoding: "gbk", legacyCodec: legacyTextCodec,
}).text, "中文");

// Execute the real browser bundles without Node globals or import resolution.
const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView });
async function loadBundle(name) {
  const source = await readFile(new URL(`../dist/${name}.js`, import.meta.url), "utf8");
  const module = new vm.SourceTextModule(source, { context });
  await module.link((specifier) => { throw new Error(`Browser bundle left an external import: ${specifier}`); });
  await module.evaluate();
  return module.namespace;
}
const unicode = await loadBundle("index");
const legacy = await loadBundle("legacy");
assert.equal(vm.runInContext("typeof Buffer", context), "undefined");
assert.equal(vm.runInContext("typeof process", context), "undefined");
for (const [encoding, text] of [["gbk", "中文"], ["gb18030", "中文🙂"], ["big5", "繁體中文"], ["shift_jis", "日本語"]]) {
  const options = { encoding, legacyCodec: legacy.legacyTextCodec };
  assert.equal(unicode.decodeDocumentBytes(unicode.encodeDocumentText(text, options), options).text, text);
}
assert.equal(vm.runInContext("typeof Buffer", context), "undefined");
console.log("text-codec public Node and isolated browser bundles passed");
