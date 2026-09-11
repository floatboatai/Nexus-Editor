import { Buffer } from "buffer/";
import iconv from "iconv-lite";
import type { LegacyTextCodec } from "./index";

/** Explicit legacy tables with a module-local Buffer implementation; no global polyfill. */
export const legacyTextCodec: LegacyTextCodec = Object.freeze<LegacyTextCodec>({
  decode(bytes, encoding) {
    return iconv.decode(Buffer.from(bytes), encoding, { stripBOM: false });
  },
  encode(text, encoding) {
    return new Uint8Array(iconv.encode(text, encoding, { addBOM: false }));
  },
});
