export interface SearchDocument {
  readonly id: string;
  readonly path: string;
  readonly version: string;
  readonly size?: number;
}

export interface SearchQuery {
  readonly text: string;
  readonly regex?: boolean;
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
  readonly include?: string;
  readonly exclude?: string;
  /** Literal replacement text, or JavaScript substitution syntax for regex queries. */
  readonly replacement?: string;
}

export interface SearchHit {
  readonly fileId: string;
  readonly path: string;
  readonly version: string;
  /** UTF-16 offsets in the exact source version, not rendered text coordinates. */
  readonly from: number;
  readonly to: number;
  readonly line: number;
  readonly column: number;
  readonly snippet: string;
  readonly snippetFrom: number;
  readonly replacement?: string;
}

export interface SearchScanRequest {
  readonly document: SearchDocument;
  readonly content: string;
  readonly query: SearchQuery;
  readonly offset: number;
  readonly limit: number;
  /** Bounds expanded substitutions before crossing the worker message boundary. */
  readonly maxReplacementBytes?: number;
}

export interface SearchScanResult {
  readonly hits: readonly SearchHit[];
  readonly nextOffset: number | null;
  readonly elapsed: number;
}

export interface SearchExecutor {
  /** Arbitrary regex execution must run in a terminable isolation boundary. */
  scan(request: SearchScanRequest, options: {
    readonly signal: AbortSignal;
    readonly budgetMs?: number;
  }): Promise<SearchScanResult>;
  dispose(): void | Promise<void>;
}

export type SearchErrorCode = "aborted" | "invalid-query" | "timeout" | "source-changed" |
  "source-error" | "file-unavailable" | "executor-error" | "busy" | "disposed" | "unsupported";

export class SearchError extends Error {
  constructor(readonly code: SearchErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = code === "aborted" ? "AbortError" : "SearchError";
  }
}

export interface SearchLimits {
  readonly maxFileBytes: number;
  readonly pageSize: number;
  readonly maxResults: number;
  readonly regexBudgetMs: number;
}

export const DEFAULT_SEARCH_LIMITS: SearchLimits = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024,
  pageSize: 200,
  maxResults: 5000,
  regexBudgetMs: 250,
});

export function abortError(): SearchError {
  return new SearchError("aborted", "Search cancelled");
}

export function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/** Cancellation settles even when a host source does not cooperate with its signal. */
export function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    if (signal.aborted) {
      work.catch(() => undefined);
      reject(abortError());
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
