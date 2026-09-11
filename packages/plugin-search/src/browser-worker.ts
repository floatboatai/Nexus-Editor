import { createWorkerExecutor, type WorkerResponse } from "./worker-executor";
import type { SearchExecutor } from "./search-types";

/** Browser-only adapter. A custom factory can accommodate a host's bundler or CSP. */
export function createBrowserSearchExecutor(options: { readonly createWorker?: () => Worker } = {}): SearchExecutor {
  return createWorkerExecutor(() => {
    const worker = options.createWorker?.() ?? new Worker(new URL("./search-worker.js", import.meta.url), {
      type: "module",
      name: "nexus-search",
    });
    return {
      postMessage: (message) => worker.postMessage(message),
      listen(message, error) {
        const onMessage = (event: MessageEvent<WorkerResponse>) => message(event.data);
        const onError = (event: ErrorEvent) => error(event.error ?? event.message);
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        return () => {
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
        };
      },
      terminate: () => worker.terminate(),
    };
  });
}
