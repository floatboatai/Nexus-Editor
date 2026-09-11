import { Worker } from "node:worker_threads";
import { createWorkerExecutor } from "./worker-executor";
import type { ConversionExecutor } from "./types";

export function createNodeConversionExecutor(options: { readonly workerUrl?: URL; readonly maxMemoryMb?: number; readonly maxConcurrent?: number } = {}): ConversionExecutor {
  return createWorkerExecutor(() => {
    const worker = new Worker(options.workerUrl ?? new URL("./worker-node.js", import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: options.maxMemoryMb ?? 128 },
    });
    return {
      post: (message, transfer) => worker.postMessage(message, transfer),
      listen(message, error) {
        const exit = (code: number) => error(new Error(`Conversion worker exited before completing (${code})`));
        worker.on("message", message);
        worker.on("error", error);
        worker.on("exit", exit);
        return () => { worker.off("message", message); worker.off("error", error); worker.off("exit", exit); };
      },
      async terminate() { await worker.terminate(); },
    };
  }, options.maxConcurrent);
}
