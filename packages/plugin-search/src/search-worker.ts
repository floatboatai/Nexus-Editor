import { scanSearchDocument } from "./search-matcher";
import type { WorkerRequest, WorkerResponse } from "./worker-executor";

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<WorkerRequest>) => void;
  postMessage(response: WorkerResponse): void;
};
scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, ok: true, result: scanSearchDocument(data.request) });
  } catch (error) {
    scope.postMessage({ id: data.id, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};
