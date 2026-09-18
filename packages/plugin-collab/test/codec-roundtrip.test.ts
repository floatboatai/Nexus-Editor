/**
 * Codec round-trip + version-gating tests.
 *
 * Verifies the "Codec 往返测试：markdown → AST → markdown 在插件介入前后 diff 为零"
 * intent at the structural level (snapshot encode/decode is lossless), and the
 * "未知版本直接拒绝并提示升级" safety rule.
 */
import { test, expect } from "vitest";
import { VersionedMarkdownCodec, CodecError, CODEC_VERSION } from "../src/codec/markdown-codec";
import type { CollabOp } from "../src/provider/tree-crdt";

const codec = new VersionedMarkdownCodec();

const sampleOps: CollabOp[] = [
  { kind: "ins", id: "i:1", after: null, char: "h", site: 0, source: "local", updateOriginId: "i:1" },
  { kind: "ins", id: "i:2", after: "i:1", char: "i", site: 0, source: "local", updateOriginId: "i:2" },
  { kind: "del", id: "d:1", target: "i:1", source: "local", updateOriginId: "d:1" },
];

test("encode -> decode is structurally lossless", () => {
  const snapshot = { docId: "doc-1", ops: sampleOps, awareness: [] };
  const bytes = codec.encodeSnapshot(snapshot);
  const decoded = codec.decodeSnapshot(bytes);
  expect(decoded.format).toBe(CODEC_VERSION.format);
  expect(decoded.v).toBe(CODEC_VERSION.v);
  expect(decoded.docId).toBe("doc-1");
  expect(decoded.ops).toEqual(sampleOps);
});

test("unknown format is rejected (never silently corrupted)", () => {
  const payload = JSON.stringify({ format: "evil-format", v: 1, docId: "x", ops: [] });
  const bytes = new TextEncoder().encode(payload);
  expect(() => codec.decodeSnapshot(bytes)).toThrow(CodecError);
});

test("future version is rejected and prompts upgrade", () => {
  const payload = JSON.stringify({ format: CODEC_VERSION.format, v: CODEC_VERSION.v + 1, docId: "x", ops: [] });
  const bytes = new TextEncoder().encode(payload);
  expect(() => codec.decodeSnapshot(bytes)).toThrow(/version/);
});

test("local edit diff produces a local-origin op", () => {
  const op = codec.diffLocalEdit("hello", "hello world", { source: "local", updateOriginId: "u1", site: 0 });
  expect(op.source).toBe("local");
  expect(op.updateOriginId).toBe("u1");
  expect(op.kind).toBe("ins");
});
