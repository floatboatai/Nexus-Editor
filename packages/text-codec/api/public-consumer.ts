import {
  decodeDocumentBytes,
  encodeDocumentText,
  type DecodedDocument,
  type DecodeDocumentResult,
  type DocumentTextFormat,
} from "../dist/index.js";
import { legacyTextCodec } from "../dist/legacy.js";

const bytes: Uint8Array = encodeDocumentText("中文", { encoding: "gbk", legacyCodec: legacyTextCodec });
const result: DecodeDocumentResult = decodeDocumentBytes(bytes, { encoding: "gbk", legacyCodec: legacyTextCodec });
if (result.status === "decoded") {
  const document: DecodedDocument = result;
  const format: DocumentTextFormat = document.format;
  encodeDocumentText(document.text, { format, legacyCodec: legacyTextCodec });
}
