import type {
  ConversionExecutor,
  ConversionResult,
  DocumentLimits,
} from "./types";
import { checkBytes, limits, throwIfAborted } from "./limits";

export interface WorkerEndpoint {
  post(message: unknown, transfer: ArrayBuffer[]): void;
  listen(message: (value: unknown) => void, error: (error: Error) => void): () => void;
  terminate(): void | Promise<void>;
}

export function createWorkerExecutor(
  spawn: (budget: Required<DocumentLimits>) => WorkerEndpoint,
  maxConcurrent = 2,
): ConversionExecutor {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new RangeError("Worker concurrency must be a positive safe integer");
  }
  const jobs = new Map<AbortController, Promise<ConversionResult>>();
  let disposed = false;
  let disposal: Promise<void> | null = null;
  return {
    run(request, options = {}) {
      if (disposed) return Promise.reject(new Error("Conversion executor is disposed"));
      if (jobs.size >= maxConcurrent) return Promise.reject(new Error("Conversion executor concurrency limit reached"));
      const budget = limits(request.limits);
      try {
        throwIfAborted(options.signal);
        checkBytes(request.bytes, budget.maxInputBytes, "Conversion input");
      } catch (error) {
        return Promise.reject(error);
      }
      const controller = new AbortController();
      const promise = new Promise<ConversionResult>((resolve, reject) => {
        let worker: WorkerEndpoint;
        try {
          worker = spawn(budget);
        } catch (error) {
          reject(error);
          return;
        }
        let settled = false;
        let remove: () => void = () => {};
        const finish = (error: unknown, result?: ConversionResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          remove();
          options.signal?.removeEventListener("abort", abort);
          controller.signal.removeEventListener("abort", abort);
          Promise.resolve().then(() => worker.terminate()).then(() => {
            if (error) reject(error);
            else if (result) resolve(result);
            else reject(new Error("Worker returned no conversion result"));
          }, reject);
        };
        const abort = () => finish(new DOMException("Document conversion canceled", "AbortError"));
        const timer = setTimeout(() => finish(new Error("Document conversion timed out")), budget.timeoutMs);
        options.signal?.addEventListener("abort", abort, { once: true });
        controller.signal.addEventListener("abort", abort, { once: true });
        remove = worker.listen((value) => {
          if (!value || typeof value !== "object") return finish(new Error("Invalid conversion worker response"));
          // PDF.js can announce its own worker bootstrap on the enclosing port.
          // Only our namespaced replies complete a conversion task.
          if (!("protocol" in value) || value.protocol !== "nexus-document-conversion-v1") return;
          const response = value as { ok?: unknown; result?: ConversionResult; error?: { message?: unknown; name?: unknown; code?: unknown } };
          if (response.ok === true && typeof response.result?.markdown === "string" && Array.isArray(response.result.assetPlan) && Array.isArray(response.result.diagnostics)) {
            try {
              checkBytes(response.result.markdown, budget.maxOutputBytes, "Converted Markdown");
              let total = 0;
              for (const entry of response.result.assetPlan) {
                if (!entry.resource) continue;
                if (!(entry.resource.bytes instanceof Uint8Array)) throw new Error("Invalid worker asset bytes");
                checkBytes(entry.resource.bytes, budget.maxAssetBytes, "Converted asset");
                total += entry.resource.bytes.byteLength;
              }
              if (total > budget.maxTotalAssetBytes) throw new Error("Converted assets exceed total budget");
              finish(null, response.result);
            } catch (error) {
              finish(error);
            }
          } else {
            const error = new Error(typeof response.error?.message === "string" ? response.error.message : "Document conversion failed");
            if (typeof response.error?.name === "string") error.name = response.error.name;
            if (typeof response.error?.code === "string") Object.assign(error, { code: response.error.code });
            finish(error);
          }
        }, (error) => finish(error));
        if (options.signal?.aborted) {
          abort();
          return;
        }
        // Transfer task-owned bytes only: caller buffers must remain usable after cancellation.
        const bytes = Uint8Array.from(request.bytes);
        try {
          worker.post({ ...request, bytes, limits: budget }, [bytes.buffer]);
        } catch (error) {
          finish(error);
        }
      });
      jobs.set(controller, promise);
      void promise.then(() => jobs.delete(controller), () => jobs.delete(controller));
      return promise;
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      const pending = [...jobs.values()];
      for (const controller of jobs.keys()) controller.abort();
      disposal = Promise.allSettled(pending).then(() => undefined);
      return disposal;
    },
  };
}
