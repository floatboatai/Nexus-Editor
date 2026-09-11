import assert from "node:assert/strict";
import { MemoryDocumentVersionStore, diffDocumentText } from "@floatboat/nexus-document-history";

assert.equal(typeof globalThis.document, "undefined");
const store = new MemoryDocumentVersionStore();
const record = await store.append("host-owned-key", { markdown: "中文🙂\n" }, { expectedHead: null });
assert.equal(record.status, "appended");
const restored = new MemoryDocumentVersionStore({ snapshot: JSON.parse(JSON.stringify(store.exportSnapshot())) });
assert.deepEqual(restored.exportSnapshot(), store.exportSnapshot());
assert.equal(diffDocumentText("one\n", "one").status, "complete");
console.log("document-history public Node entry passed without DOM");
