import { createWorkerExecutor } from "./worker-executor";
import type { ConversionExecutor } from "./types";

export function createBrowserConversionExecutor(createWorker: () => Worker = () => new Worker(new URL("./worker-browser.js", import.meta.url), { type: "module" }), options: { readonly maxConcurrent?: number } = {}): ConversionExecutor {
  return createWorkerExecutor(() => {
    const worker = createWorker();
    return {
      post: (message, transfer) => worker.postMessage(message, transfer),
      listen(message, error) {
        const onMessage = (event: MessageEvent<unknown>) => message(event.data);
        const onError = (event: ErrorEvent) => error(new Error(`${event.message || "Conversion worker failed"} (${event.filename}:${event.lineno}:${event.colno})`));
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        return () => { worker.removeEventListener("message", onMessage); worker.removeEventListener("error", onError); };
      },
      terminate() { worker.terminate(); },
    };
  }, options.maxConcurrent);
}
