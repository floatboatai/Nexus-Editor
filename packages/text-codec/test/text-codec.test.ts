// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  decodeDocumentBytes,
  encodeDocumentText,
  TextCodecError,
  type TextEncoding,
} from "../src/index";
import { legacyTextCodec } from "../src/legacy";

function errorCode(operation: () => unknown): string {
  try { operation(); } catch (error) {
    expect(error).toBeInstanceOf(TextCodecError);
    return (error as TextCodecError).code;
  }
  throw new Error("Expected a codec error");
}

describe("Unicode document encoding", () => {
  it.each(["utf-8", "utf-16le", "utf-16be"] as const)("round-trips %s, BOM, CRLF and supplementary Unicode", (encoding) => {
    const bytes = encodeDocumentText("# 中文🙂\nTail\n", { encoding, bom: true, eol: "crlf" });
    const decoded = decodeDocumentBytes(bytes);
    expect(decoded).toEqual({ status: "decoded", text: "# 中文🙂\nTail\n", format: { encoding, bom: true, eol: "crlf" } });
    if (decoded.status !== "decoded") throw new Error("Expected decoded text");
    expect(encodeDocumentText(decoded.text, { format: decoded.format })).toEqual(bytes);
  });

  it("defaults new documents to UTF-8 without BOM and retains no trailing newline", () => {
    expect([...encodeDocumentText("one")]).toEqual([111, 110, 101]);
    expect(decodeDocumentBytes(encodeDocumentText("one"))).toEqual({
      status: "decoded", text: "one", format: { encoding: "utf-8", bom: false, eol: "none" },
    });
    expect(decodeDocumentBytes(new Uint8Array())).toMatchObject({ status: "decoded", text: "" });
  });

  it("preserves an additional content U+FEFF and does not normalize combining characters", () => {
    const text = "\ufeffe\u0301";
    expect(decodeDocumentBytes(encodeDocumentText(text, { bom: true }))).toMatchObject({ status: "decoded", text });
    expect(errorCode(() => encodeDocumentText(text))).toBe("encoding-bom-mismatch");
  });

  it("returns choices for invalid UTF-8 rather than silently selecting a legacy codec", () => {
    const bytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
    const before = bytes.slice();
    expect(decodeDocumentBytes(bytes, { legacyCodec: legacyTextCodec })).toEqual({
      status: "needs-encoding", reason: "invalid-utf8", candidates: ["gbk", "gb18030", "big5", "shift_jis", "utf-16le", "utf-16be"],
    });
    expect(bytes).toEqual(before);
    expect(decodeDocumentBytes(bytes, { encoding: "gbk", legacyCodec: legacyTextCodec })).toMatchObject({ status: "decoded", text: "中文" });
  });

  it("requires confirmation for ambiguous BOM-less UTF-16", () => {
    const bytes = new Uint8Array([65, 0, 66, 0]);
    expect(decodeDocumentBytes(bytes)).toMatchObject({ status: "needs-encoding", reason: "ambiguous-unicode" });
    expect(decodeDocumentBytes(bytes, { encoding: "utf-16le" })).toMatchObject({ status: "decoded", text: "AB" });
  });

  it("rejects BOM mismatches and recognizes UTF-32 before the shorter UTF-16 BOM", () => {
    expect(errorCode(() => decodeDocumentBytes(new Uint8Array([0xff, 0xfe, 65, 0]), { encoding: "utf-8" }))).toBe("encoding-bom-mismatch");
    expect(errorCode(() => decodeDocumentBytes(new Uint8Array([0xff, 0xfe, 0, 0, 65, 0, 0, 0])))).toBe("unsupported-encoding");
    expect(errorCode(() => decodeDocumentBytes(new Uint8Array([0, 0, 0xfe, 0xff])))).toBe("unsupported-encoding");
    expect(errorCode(() => decodeDocumentBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0xc3, 0x28])))).toBe("invalid-bytes");
  });

  it.each(["\0", "\0a", "\0\0\n中文"])("explicit UTF-16LE disambiguates a leading content NUL: %j", (text) => {
    const bytes = encodeDocumentText(text, { encoding: "utf-16le", bom: true, eol: "crlf" });
    const decoded = decodeDocumentBytes(bytes, { encoding: "utf-16le" });
    expect(decoded).toMatchObject({ status: "decoded", text, format: { encoding: "utf-16le", bom: true } });
    if (decoded.status !== "decoded") throw new Error("Expected decoded text");
    expect(encodeDocumentText(decoded.text, { format: decoded.format })).toEqual(bytes);
  });

  it.each([
    ["utf-8", [0xc3, 0x28]],
    ["utf-16le", [65]],
    ["utf-16le", [0, 0xd8]],
    ["utf-16be", [0xdc, 0]],
  ] as const)("strictly rejects malformed %s bytes", (encoding, values) => {
    expect(errorCode(() => decodeDocumentBytes(new Uint8Array(values), { encoding }))).toBe("invalid-bytes");
  });

  it.each(["\ud800", "\udc00", "x\ud800y"])("rejects unpaired UTF-16 surrogates", (text) => {
    for (const encoding of ["utf-8", "utf-16be", "gb18030"] as const) {
      expect(errorCode(() => encodeDocumentText(text, { encoding, legacyCodec: legacyTextCodec }))).toBe("invalid-text");
    }
  });

  it("requires an explicit EOL choice for modified mixed-EOL text", () => {
    const decoded = decodeDocumentBytes(new TextEncoder().encode("a\r\nb\nc\r"));
    expect(decoded).toMatchObject({ status: "decoded", text: "a\nb\nc\n", format: { eol: "mixed" } });
    if (decoded.status !== "decoded") throw new Error("Expected decoded text");
    expect(errorCode(() => encodeDocumentText(decoded.text + "new", { format: decoded.format }))).toBe("mixed-line-endings");
    expect(new TextDecoder().decode(encodeDocumentText(decoded.text, { format: decoded.format, eol: "crlf" }))).toBe("a\r\nb\r\nc\r\n");
  });

  it("preserves CR format and a newly added newline in an originally one-line file", () => {
    const decoded = decodeDocumentBytes(new TextEncoder().encode("a\rb"));
    expect(decoded).toMatchObject({ format: { eol: "cr" } });
    if (decoded.status !== "decoded") throw new Error("Expected decoded text");
    expect(new TextDecoder().decode(encodeDocumentText(decoded.text, { format: decoded.format }))).toBe("a\rb");
    expect(new TextDecoder().decode(encodeDocumentText("a\nb", { format: { encoding: "utf-8", bom: false, eol: "none" } }))).toBe("a\nb");
  });

  it("bounds bytes including BOM and multi-byte output before returning data", () => {
    expect(errorCode(() => decodeDocumentBytes(new Uint8Array(3), { maxBytes: 2 }))).toBe("limit-exceeded");
    expect(errorCode(() => encodeDocumentText("中", { maxBytes: 2 }))).toBe("limit-exceeded");
    expect(errorCode(() => encodeDocumentText("", { bom: true, maxBytes: 2 }))).toBe("limit-exceeded");
    expect(errorCode(() => encodeDocumentText("中", { encoding: "gbk", legacyCodec: legacyTextCodec, maxBytes: 1 }))).toBe("limit-exceeded");
    expect(() => encodeDocumentText("", { maxBytes: Infinity })).toThrow(RangeError);
    expect(() => decodeDocumentBytes(new Uint8Array(), { maxBytes: -1 })).toThrow(RangeError);
  });
});

describe("explicit legacy codec", () => {
  it.each([
    ["gbk", "中文"],
    ["gb18030", "中文🙂"],
    ["big5", "繁體中文"],
    ["shift_jis", "日本語"],
  ] as const)("round-trips %s without loading a global Buffer shim", (encoding, text) => {
    const originalBuffer = globalThis.Buffer;
    const bytes = encodeDocumentText(`${text}\n`, { encoding, eol: "crlf", legacyCodec: legacyTextCodec });
    expect(decodeDocumentBytes(bytes, { encoding, legacyCodec: legacyTextCodec })).toEqual({
      status: "decoded", text: `${text}\n`, format: { encoding, bom: false, eol: "crlf" },
    });
    expect(globalThis.Buffer).toBe(originalBuffer);
  });

  it.each(["gbk", "big5", "shift_jis"] as const)("rejects unrepresentable characters in %s", (encoding) => {
    expect(errorCode(() => encodeDocumentText("🙂", { encoding, legacyCodec: legacyTextCodec }))).toBe("unrepresentable-text");
  });

  it("rejects lossy aliases, malformed legacy bytes and implicit legacy loading", () => {
    expect(errorCode(() => encodeDocumentText("¥", { encoding: "shift_jis", legacyCodec: legacyTextCodec }))).toBe("unrepresentable-text");
    expect(errorCode(() => decodeDocumentBytes(new Uint8Array([0x81]), { encoding: "gbk", legacyCodec: legacyTextCodec }))).toBe("non-roundtrippable-input");
    expect(errorCode(() => encodeDocumentText("中文", { encoding: "gbk" }))).toBe("unsupported-encoding");
    expect(errorCode(() => encodeDocumentText("中文", { encoding: "gbk", bom: true, legacyCodec: legacyTextCodec }))).toBe("encoding-bom-mismatch");
    expect(errorCode(() => encodeDocumentText("", { encoding: "utf-7" as TextEncoding }))).toBe("unsupported-encoding");
  });
});
