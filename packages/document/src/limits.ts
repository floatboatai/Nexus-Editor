import type { DocumentLimits } from "./types";

export class DocumentLimitError extends Error {
  readonly code = "limit-exceeded";
  constructor(message: string) { super(message); this.name = "DocumentLimitError"; }
}

export function limits(options: DocumentLimits = {}): Required<DocumentLimits> {
  const result = {
    maxInputBytes: 16 * 1024 * 1024,
    maxOutputBytes: 32 * 1024 * 1024,
    maxAssetBytes: 10 * 1024 * 1024,
    maxTotalAssetBytes: 24 * 1024 * 1024,
    maxArchiveBytes: 64 * 1024 * 1024,
    maxArchiveEntries: 1000,
    maxCompressionRatio: 200,
    maxPages: 200,
    maxNodes: 200_000,
    timeoutMs: 30_000,
    ...options,
  };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  }
  return result;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Document operation canceled", "AbortError");
}

export function checkBytes(value: string | Uint8Array, maximum: number, name: string): void {
  const size = typeof value === "string" ? new TextEncoder().encode(value).byteLength : value.byteLength;
  if (size > maximum) throw new DocumentLimitError(`${name} exceeds ${maximum} bytes`);
}

export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => { cleanup(); reject(new DOMException("Document operation canceled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    work.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
  });
}

export function operationSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    abort,
    dispose() { clearTimeout(timer); signal?.removeEventListener("abort", abort); },
  };
}
