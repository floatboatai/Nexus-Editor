import { executeConversion } from "./worker-operations";

const scope = globalThis as typeof globalThis & {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown): void;
};
scope.fetch = () => Promise.reject(new Error("Conversion workers do not grant network access"));
scope.onmessage = (event) => {
  scope.onmessage = null;
  void executeConversion(event.data).then((result) => scope.postMessage({ protocol: "nexus-document-conversion-v1", ok: true, result }), (error: unknown) => {
    scope.postMessage({ protocol: "nexus-document-conversion-v1", ok: false, error: {
      message: error instanceof Error ? error.message : "Document conversion failed",
      name: error instanceof Error ? error.name : "Error",
      code: typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined,
    } });
  });
};
