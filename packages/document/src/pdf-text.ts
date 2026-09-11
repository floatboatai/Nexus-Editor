import type { BinaryConversionOptions, ConversionResult } from "./types";
import { checkBytes, limits, throwIfAborted } from "./limits";

export async function extractPdfText(bytes: Uint8Array, options: BinaryConversionOptions): Promise<ConversionResult> {
  throwIfAborted(options.signal);
  checkBytes(bytes, limits(options.limits).maxInputBytes, "PDF input");
  return options.executor.run({ format: "pdf-text", bytes, limits: options.limits, password: options.password }, { signal: options.signal });
}
