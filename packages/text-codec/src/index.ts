export const UNICODE_ENCODINGS = ["utf-8", "utf-16le", "utf-16be"] as const;
export const LEGACY_ENCODINGS = ["gbk", "gb18030", "big5", "shift_jis"] as const;
export type UnicodeTextEncoding = typeof UNICODE_ENCODINGS[number];
export type LegacyTextEncoding = typeof LEGACY_ENCODINGS[number];
export type TextEncoding = UnicodeTextEncoding | LegacyTextEncoding;
export type UniformLineEnding = "lf" | "crlf" | "cr";
export type DocumentLineEnding = UniformLineEnding | "mixed" | "none";

export interface DocumentTextFormat {
  readonly encoding: TextEncoding;
  readonly bom: boolean;
  readonly eol: DocumentLineEnding;
}

/** An explicitly supplied codec; the Unicode entry point never loads its tables. */
export interface LegacyTextCodec {
  decode(bytes: Uint8Array, encoding: LegacyTextEncoding): string;
  encode(text: string, encoding: LegacyTextEncoding): Uint8Array;
}

export interface DecodeDocumentOptions {
  readonly encoding?: TextEncoding;
  readonly legacyCodec?: LegacyTextCodec;
  readonly maxBytes?: number;
}

export type DecodedDocument = {
  readonly status: "decoded";
  /** Unicode text with LF line endings. BOM is represented only in format. */
  readonly text: string;
  readonly format: DocumentTextFormat;
};

export type DecodeDocumentResult = DecodedDocument | {
  readonly status: "needs-encoding";
  /** Choices, not detected encodings or a ranked confidence estimate. */
  readonly candidates: readonly TextEncoding[];
  readonly reason: "invalid-utf8" | "ambiguous-unicode";
};

export interface EncodeDocumentOptions {
  readonly format?: DocumentTextFormat;
  readonly encoding?: TextEncoding;
  readonly bom?: boolean;
  /** Required to save a document whose original format has mixed line endings. */
  readonly eol?: UniformLineEnding;
  readonly legacyCodec?: LegacyTextCodec;
  readonly maxBytes?: number;
}

export type TextCodecErrorCode =
  | "limit-exceeded"
  | "unsupported-encoding"
  | "encoding-bom-mismatch"
  | "invalid-text"
  | "invalid-bytes"
  | "non-roundtrippable-input"
  | "unrepresentable-text"
  | "mixed-line-endings";

export class TextCodecError extends Error {
  constructor(readonly code: TextCodecErrorCode, message: string) {
    super(message);
    this.name = "TextCodecError";
  }
}

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const allEncodings: readonly TextEncoding[] = [...UNICODE_ENCODINGS, ...LEGACY_ENCODINGS];

function byteLimit(value = DEFAULT_MAX_BYTES): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("maxBytes must be a non-negative safe integer");
  return value;
}

function requireEncoding(value: string): TextEncoding {
  if (!allEncodings.some((encoding) => encoding === value)) {
    throw new TextCodecError("unsupported-encoding", `Unsupported text encoding '${value}'`);
  }
  return value as TextEncoding;
}

function isUnicode(encoding: TextEncoding): encoding is UnicodeTextEncoding {
  return UNICODE_ENCODINGS.some((value) => value === encoding);
}

function assertWellFormed(text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TextCodecError("invalid-text", "Text contains an unpaired UTF-16 surrogate");
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TextCodecError("invalid-text", "Text contains an unpaired UTF-16 surrogate");
    }
  }
}

function detectBom(bytes: Uint8Array, selected?: TextEncoding): { encoding: UnicodeTextEncoding; size: number } | null {
  // FF FE 00 00 is also UTF-16LE's BOM followed by a content NUL. Only an
  // explicit LE choice can disambiguate it; automatic UTF-32 stays unsupported.
  if ((selected !== "utf-16le" && bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) ||
    (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)) {
    throw new TextCodecError("unsupported-encoding", "UTF-32 documents are not supported");
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: "utf-8", size: 3 };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: "utf-16le", size: 2 };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: "utf-16be", size: 2 };
  return null;
}

function detectLineEnding(text: string): DocumentLineEnding {
  let first: UniformLineEnding | undefined;
  for (const match of text.matchAll(/\r\n|\r|\n/g)) {
    const eol = match[0] === "\r\n" ? "crlf" : match[0] === "\r" ? "cr" : "lf";
    if (first && first !== eol) return "mixed";
    first = eol;
  }
  return first ?? "none";
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requireLegacy(codec: LegacyTextCodec | undefined): LegacyTextCodec {
  if (!codec) throw new TextCodecError("unsupported-encoding", "A legacy codec must be explicitly supplied");
  return codec;
}

function decodeUnicode(bytes: Uint8Array, encoding: UnicodeTextEncoding): string {
  try {
    // BOM was handled above. Preserve a second U+FEFF that belongs to the content.
    return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new TextCodecError("invalid-bytes", `Input is not valid ${encoding} text`);
  }
}

/** Decode only reliable Unicode automatically; legacy choices require a second, explicit call. */
export function decodeDocumentBytes(bytes: Uint8Array, options: DecodeDocumentOptions = {}): DecodeDocumentResult {
  if (bytes.byteLength > byteLimit(options.maxBytes)) throw new TextCodecError("limit-exceeded", "Document exceeds maxBytes");
  const selected = options.encoding === undefined ? undefined : requireEncoding(options.encoding);
  const bom = detectBom(bytes, selected);
  if (bom && selected && bom.encoding !== selected) {
    throw new TextCodecError("encoding-bom-mismatch", "The selected encoding conflicts with the Unicode BOM");
  }
  const encoding = selected ?? bom?.encoding ?? "utf-8";
  if (!selected && !bom && bytes.includes(0)) {
    return Object.freeze({
      status: "needs-encoding",
      reason: "ambiguous-unicode",
      candidates: Object.freeze([...UNICODE_ENCODINGS]),
    });
  }
  const payload = bytes.subarray(bom?.size ?? 0);
  let text: string;
  if (isUnicode(encoding)) {
    try {
      text = decodeUnicode(payload, encoding);
    } catch (error) {
      if (selected || bom) throw error;
      return Object.freeze({
        status: "needs-encoding",
        reason: "invalid-utf8",
        candidates: Object.freeze([...LEGACY_ENCODINGS, "utf-16le", "utf-16be"] as TextEncoding[]),
      });
    }
  } else {
    const codec = requireLegacy(options.legacyCodec);
    text = codec.decode(new Uint8Array(payload), encoding);
    assertWellFormed(text);
    if (!equalBytes(payload, codec.encode(text, encoding))) {
      throw new TextCodecError("non-roundtrippable-input", "The selected encoding cannot round-trip these bytes without changes");
    }
  }
  return Object.freeze({
    status: "decoded",
    text: text.replace(/\r\n|\r/g, "\n"),
    format: Object.freeze({ encoding, bom: bom !== null, eol: detectLineEnding(text) }),
  });
}

function utf8Length(text: string): number {
  let size = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    size += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return size;
}

function encodeUnicode(text: string, encoding: UnicodeTextEncoding, maxBytes: number): Uint8Array {
  const size = encoding === "utf-8" ? utf8Length(text) : text.length * 2;
  if (size > maxBytes) throw new TextCodecError("limit-exceeded", "Encoded document exceeds maxBytes");
  if (encoding === "utf-8") return new TextEncoder().encode(text);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < text.length; index += 1) view.setUint16(index * 2, text.charCodeAt(index), encoding === "utf-16le");
  return bytes;
}

/** Encode safely. This function never writes a file or authorizes an overwrite. */
export function encodeDocumentText(text: string, options: EncodeDocumentOptions = {}): Uint8Array {
  const maxBytes = byteLimit(options.maxBytes);
  if (text.length > maxBytes) throw new TextCodecError("limit-exceeded", "Document exceeds maxBytes");
  assertWellFormed(text);
  const encoding = requireEncoding(options.encoding ?? options.format?.encoding ?? "utf-8");
  const bom = options.bom ?? options.format?.bom ?? false;
  const eol = options.eol ?? options.format?.eol ?? "lf";
  if (eol === "mixed") throw new TextCodecError("mixed-line-endings", "Choose a uniform line ending before saving modified mixed-EOL text");
  if (!["lf", "crlf", "cr", "none"].includes(eol)) throw new RangeError("Invalid line ending");
  if (bom && !isUnicode(encoding)) throw new TextCodecError("encoding-bom-mismatch", "A Unicode BOM cannot be used with a legacy encoding");
  if (!bom && isUnicode(encoding) && text.startsWith("\ufeff")) {
    throw new TextCodecError("encoding-bom-mismatch", "A leading content U+FEFF requires an explicit BOM to distinguish it from the file marker");
  }
  const normalized = text.replace(/\r\n|\r/g, "\n");
  const prepared = normalized.replace(/\n/g, eol === "crlf" ? "\r\n" : eol === "cr" ? "\r" : "\n");
  const prefix = !bom ? [] : encoding === "utf-8" ? [0xef, 0xbb, 0xbf] : encoding === "utf-16le" ? [0xff, 0xfe] : [0xfe, 0xff];
  let encoded: Uint8Array;
  if (isUnicode(encoding)) {
    encoded = encodeUnicode(prepared, encoding, maxBytes - prefix.length);
  } else {
    const codec = requireLegacy(options.legacyCodec);
    encoded = codec.encode(prepared, encoding);
    if (encoded.byteLength > maxBytes) throw new TextCodecError("limit-exceeded", "Encoded document exceeds maxBytes");
    if (codec.decode(new Uint8Array(encoded), encoding) !== prepared) {
      throw new TextCodecError("unrepresentable-text", `Text cannot be represented losslessly in ${encoding}`);
    }
  }
  const result = new Uint8Array(prefix.length + encoded.length);
  result.set(prefix);
  result.set(encoded, prefix.length);
  return result;
}
