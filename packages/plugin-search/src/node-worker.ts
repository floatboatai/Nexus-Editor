import { Worker } from "node:worker_threads";
import { createWorkerExecutor } from "./worker-executor";
import type { SearchExecutor } from "./search-types";

/** Node-only entry. Each executor owns its workers and awaits termination on disposal. */
export function createNodeSearchExecutor(): SearchExecutor {
  return createWorkerExecutor(() => {
    const worker = new Worker(new URL("./node-search-worker.js", import.meta.url));
    return {
      postMessage: (message) => worker.postMessage(message),
      listen(message, error) {
        const exit = (code: number) => error(new Error(`Search worker exited (${code})`));
        worker.on("message", message);
        worker.on("error", error);
        worker.on("exit", exit);
        return () => {
          worker.off("message", message);
          worker.off("error", error);
          worker.off("exit", exit);
        };
      },
      terminate: async () => { await worker.terminate(); },
    };
  });
}
