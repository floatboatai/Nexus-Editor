import { parentPort } from "node:worker_threads";
import { scanSearchDocument } from "./search-matcher";
import type { WorkerRequest, WorkerResponse } from "./worker-executor";

if (!parentPort) throw new Error("Search worker requires a parent port");
const port = parentPort;
port.on("message", (data: WorkerRequest) => {
  let response: WorkerResponse;
  try {
    response = { id: data.id, ok: true, result: scanSearchDocument(data.request) };
  } catch (error) {
    response = { id: data.id, ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  port.postMessage(response);
});
