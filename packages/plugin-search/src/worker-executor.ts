import {
  SearchError,
  abortError,
  checkAbort,
  type SearchExecutor,
  type SearchScanRequest,
  type SearchScanResult,
} from "./search-types";

export interface WorkerRequest { readonly id: number; readonly request: SearchScanRequest }
export type WorkerResponse = { readonly id: number } & (
  | { readonly ok: true; readonly result: SearchScanResult }
  | { readonly ok: false; readonly message: string }
);

export interface SearchWorkerPort {
  postMessage(message: WorkerRequest): void;
  listen(message: (data: WorkerResponse) => void, error: (cause: unknown) => void): () => void;
  terminate(): void | Promise<void>;
}

/** One serial task per executor. No worker starts until the first scan. */
export function createWorkerExecutor(factory: () => SearchWorkerPort): SearchExecutor {
  let worker: SearchWorkerPort | null = null;
  let sequence = 0;
  let pending: ((error: SearchError) => void) | null = null;
  let disposed = false;
  const terminations = new Set<Promise<void>>();
  const terminationErrors: unknown[] = [];
  const stop = () => {
    const current = worker;
    worker = null;
    if (!current) return;
    const task = Promise.resolve().then(() => current.terminate()).then(() => undefined);
    terminations.add(task);
    void task.then(() => terminations.delete(task), (error) => {
      terminationErrors.push(error);
      terminations.delete(task);
    });
  };
  return {
    scan(request, { signal, budgetMs }) {
      if (disposed) return Promise.reject(new SearchError("disposed", "Search executor is disposed"));
      if (pending) return Promise.reject(new SearchError("executor-error", "Search executor is already scanning"));
      if (signal.aborted) return Promise.reject(abortError());
      if (budgetMs !== undefined && (!Number.isFinite(budgetMs) || budgetMs <= 0)) {
        return Promise.reject(new SearchError("timeout", "Search execution budget exhausted"));
      }
      return new Promise<SearchScanResult>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let unlisten: () => void = () => undefined;
        const id = ++sequence;
        const cleanup = () => {
          if (timer !== undefined) clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          unlisten();
          pending = null;
        };
        const fail = (error: SearchError) => {
          cleanup();
          stop();
          reject(error);
        };
        const abort = () => fail(abortError());
        pending = fail;
        signal.addEventListener("abort", abort, { once: true });
        try {
          checkAbort(signal);
          worker ??= factory();
          unlisten = worker.listen((message) => {
            if (message.id !== id) return;
            cleanup();
            if (message.ok) resolve(message.result);
            else reject(new SearchError("invalid-query", message.message));
          }, (cause) => fail(new SearchError("executor-error", "Search worker failed", { cause })));
          checkAbort(signal);
          if (budgetMs !== undefined) timer = setTimeout(() => {
            fail(new SearchError("timeout", "Regular expression exceeded its per-file budget"));
          }, budgetMs);
          worker.postMessage({ id, request });
        } catch (cause) {
          fail(cause instanceof SearchError ? cause : new SearchError("executor-error", "Could not start search worker", { cause }));
        }
      });
    },
    async dispose() {
      if (!disposed) {
        disposed = true;
        pending?.(new SearchError("disposed", "Search executor is disposed"));
        stop();
      }
      await Promise.allSettled([...terminations]);
      if (terminationErrors.length) throw new AggregateError(terminationErrors, "Search worker cleanup failed");
    },
  };
}
