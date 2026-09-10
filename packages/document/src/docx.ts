import type { BinaryConversionOptions, ConversionResult } from "./types";
import { checkBytes, limits, throwIfAborted } from "./limits";

export async function convertDocx(bytes: Uint8Array, options: BinaryConversionOptions): Promise<ConversionResult> {
  throwIfAborted(options.signal);
  checkBytes(bytes, limits(options.limits).maxInputBytes, "DOCX input");
  return options.executor.run({ format: "docx", bytes, limits: options.limits }, { signal: options.signal });
}
