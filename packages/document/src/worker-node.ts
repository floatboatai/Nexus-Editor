import { parentPort } from "node:worker_threads";
import { executeConversion } from "./worker-operations";

if (!parentPort) throw new Error("Document conversion entry requires a Worker");
const port = parentPort;
globalThis.fetch = () => Promise.reject(new Error("Conversion workers do not grant network access"));
port.once("message", (request: unknown) => {
  void executeConversion(request).then((result) => port.postMessage({ protocol: "nexus-document-conversion-v1", ok: true, result }), (error: unknown) => {
    port.postMessage({ protocol: "nexus-document-conversion-v1", ok: false, error: serializeError(error) });
  });
});

function serializeError(error: unknown) {
  return {
    message: error instanceof Error ? error.message : "Document conversion failed",
    name: error instanceof Error ? error.name : "Error",
    code: typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined,
  };
}
