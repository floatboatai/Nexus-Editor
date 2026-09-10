import { matchesSearchPath } from "./search-matcher";
import {
  DEFAULT_SEARCH_LIMITS,
  SearchError,
  withAbort,
  type SearchExecutor,
  type SearchLimits,
  type SearchDocument,
  type SearchHit,
  type SearchQuery,
  type SearchScanResult,
} from "./search-types";

export type {
  SearchDocument,
  SearchHit,
  SearchQuery,
  SearchExecutor,
  SearchLimits,
  SearchScanRequest,
  SearchScanResult,
  SearchErrorCode,
} from "./search-types";
export { DEFAULT_SEARCH_LIMITS, SearchError } from "./search-types";

export interface SearchSource {
  list(signal: AbortSignal): Promise<readonly SearchDocument[]>;
  /** Throw SearchError("file-unavailable", ...) to explicitly skip one file. Other failures stop the query. */
  read(
    document: SearchDocument,
    signal: AbortSignal,
  ): Promise<{ readonly content: string; readonly version: string }>;
}

export interface SearchState {
  readonly status: "idle" | "searching" | "ready" | "error";
  readonly hits: readonly SearchHit[];
  readonly hasMore: boolean;
  readonly truncated: boolean;
  readonly skippedFiles: number;
  readonly message: string;
  readonly error: { readonly code: import("./search-types").SearchErrorCode; readonly message: string } | null;
}

export interface SearchControllerOptions {
  readonly source: SearchSource;
  /** Owned by this controller; do not share a serial executor between controllers. */
  readonly executor: SearchExecutor;
  readonly limits?: Partial<SearchLimits>;
}

interface SearchRun {
  readonly generation: number;
  readonly query: SearchQuery;
  readonly abort: AbortController;
  documents: readonly SearchDocument[];
  index: number;
  content: string | null;
  offset: number;
  regexElapsed: number;
  replacementBytes: number;
}

const emptyState = (): SearchState => ({
  status: "idle",
  hits: [],
  hasMore: false,
  truncated: false,
  skippedFiles: 0,
  message: "",
  error: null,
});

export class SearchController {
  private state = emptyState();
  private readonly listeners = new Set<(state: SearchState) => void>();
  private run: SearchRun | null = null;
  private generation = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshQuery: SearchQuery | null = null;
  private destroyed = false;
  private destroyPromise: Promise<void> | null = null;

  private readonly limits: SearchLimits;

  constructor(private readonly options: SearchControllerOptions) {
    this.limits = Object.freeze({ ...DEFAULT_SEARCH_LIMITS, ...options.limits });
    for (const value of Object.values(this.limits)) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("Search limits must be positive safe integers");
    }
  }

  getState(): SearchState {
    return this.state;
  }

  subscribe(listener: (state: SearchState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async search(query: SearchQuery): Promise<void> {
    this.cancel();
    if (this.destroyed) return;
    this.setState(emptyState());
    if (!query.text) return;
    const run: SearchRun = {
      generation: ++this.generation,
      query: { ...query },
      abort: new AbortController(),
      documents: [],
      index: 0,
      content: null,
      offset: 0,
      regexElapsed: 0,
      replacementBytes: 0,
    };
    this.run = run;
    this.setState({ ...emptyState(), status: "searching" });
    try {
      if (query.text.length > 4096 || (query.include?.length ?? 0) + (query.exclude?.length ?? 0) > 4096) {
        throw new SearchError("invalid-query", "Query or file filters exceed 4096 characters");
      }
      if (query.replacement !== undefined && (query.replacement.length > this.limits.maxFileBytes ||
        new TextEncoder().encode(query.replacement).byteLength > this.limits.maxFileBytes)) {
        throw new SearchError("invalid-query", "Replacement text exceeds the file-size limit");
      }
      const documents = await withAbort(this.options.source.list(run.abort.signal), run.abort.signal);
      if (!this.isCurrent(run)) return;
      const selected: SearchDocument[] = [];
      for (let index = 0; index < documents.length; index += 1) {
        if (!this.isCurrent(run)) return;
        const file = documents[index];
        if (matchesSearchPath(file.path, run.query.include, run.query.exclude)) {
          selected.push(Object.freeze({ ...file }));
        }
        if (index > 0 && index % 128 === 0) {
          await withAbort(new Promise<void>((resolve) => setTimeout(resolve, 0)), run.abort.signal);
        }
      }
      run.documents = selected.sort((left, right) => left.path.localeCompare(right.path));
      await this.pump(run);
    } catch (error) {
      this.fail(run, error);
    }
  }

  async loadMore(): Promise<void> {
    if (!this.run || !this.state.hasMore || this.state.status === "searching")
      return;
    const run = this.run;
    // Re-read the current document before resuming a suspended page cursor.
    run.content = null;
    this.setState({ ...this.state, status: "searching", hasMore: false });
    try {
      await this.pump(run);
    } catch (error) {
      this.fail(run, error);
    }
  }

  /** Changes invalidate both existing locations and any suspended page cursor. */
  invalidate(): void {
    const query = this.run?.query ?? this.refreshQuery;
    this.cancel();
    if (!query || this.destroyed) return;
    this.refreshQuery = query;
    this.setState({
      ...emptyState(),
      message: "Files changed. Refreshing search…",
    });
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshQuery = null;
      void this.search(query);
    }, 180);
  }

  cancel(): void {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.refreshQuery = null;
    this.run?.abort.abort();
    this.run = null;
    if (!this.destroyed) this.setState(emptyState());
  }

  destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.cancel();
    this.destroyed = true;
    this.listeners.clear();
    this.destroyPromise = Promise.resolve().then(() => this.options.executor.dispose());
    return this.destroyPromise;
  }

  private setState(state: SearchState): void {
    this.state = Object.freeze({
      ...state,
      hits: Object.freeze(state.hits.map((hit) => Object.isFrozen(hit) ? hit : Object.freeze({ ...hit }))),
    });
    for (const listener of this.listeners) listener(this.state);
  }

  private isCurrent(run: SearchRun): boolean {
    return this.run === run && !run.abort.signal.aborted && !this.destroyed;
  }

  private fail(run: SearchRun, error: unknown): void {
    if (!this.isCurrent(run)) return;
    // A timed-out expression must not retry just because another file changes.
    run.abort.abort();
    this.run = null;
    this.setState({
      ...this.state,
      status: "error",
      hasMore: false,
      message: error instanceof Error ? error.message : String(error),
      error: { code: error instanceof SearchError ? error.code : "source-error", message: error instanceof Error ? error.message : String(error) },
    });
  }

  private async pump(run: SearchRun): Promise<void> {
    const pageLimit = Math.min(
      this.limits.maxResults,
      this.state.hits.length + this.limits.pageSize,
    );
    while (
      this.isCurrent(run) &&
      run.index < run.documents.length &&
      this.state.hits.length < pageLimit
    ) {
      const document = run.documents[run.index];
      if (run.content === null) {
        if (
          document.size !== undefined &&
          document.size > this.limits.maxFileBytes
        ) {
          this.skipFile(run);
          continue;
        }
        let result: Awaited<ReturnType<SearchSource["read"]>>;
        try {
          result = await withAbort(this.options.source.read(document, run.abort.signal), run.abort.signal);
        } catch (error) {
          if (!this.isCurrent(run)) return;
          if (error instanceof SearchError && error.code === "file-unavailable") {
            this.skipFile(run);
            continue;
          }
          throw error;
        }
        if (!this.isCurrent(run)) return;
        if (result.version !== document.version) {
          this.invalidate();
          return;
        }
        if (
          result.content.length > this.limits.maxFileBytes ||
          new TextEncoder().encode(result.content).byteLength >
            this.limits.maxFileBytes
        ) {
          this.skipFile(run);
          continue;
        }
        run.content = result.content;
      }
      const response = await this.scan(
        run,
        document,
        Math.min(50, pageLimit - this.state.hits.length),
      );
      if (!this.isCurrent(run)) return;
      run.regexElapsed += response.elapsed;
      run.replacementBytes += response.hits.reduce((bytes, hit) =>
        bytes + (hit.replacement === undefined ? 0 : new TextEncoder().encode(hit.replacement).byteLength), 0);
      if (run.query.regex && run.regexElapsed > this.limits.regexBudgetMs)
        throw new SearchError("timeout", "Regular expression exceeded its per-file budget");
      this.setState({
        ...this.state,
        hits: [...this.state.hits, ...response.hits],
      });
      if (response.nextOffset === null) this.nextFile(run);
      else run.offset = response.nextOffset;
    }
    if (!this.isCurrent(run)) return;
    const more = run.index < run.documents.length;
    const truncated = more && this.state.hits.length >= this.limits.maxResults;
    this.setState({
      ...this.state,
      status: "ready",
      hasMore: more && !truncated,
      truncated,
      message: truncated
        ? `Showing the first ${this.limits.maxResults} matches. Narrow your search.`
        : "",
    });
  }

  private nextFile(run: SearchRun): void {
    run.index += 1;
    run.content = null;
    run.offset = 0;
    run.regexElapsed = 0;
    run.replacementBytes = 0;
  }

  private skipFile(run: SearchRun): void {
    const fileId = run.documents[run.index].id;
    this.setState({
      ...this.state,
      hits: this.state.hits.filter((hit) => hit.fileId !== fileId),
      skippedFiles: this.state.skippedFiles + 1,
    });
    this.nextFile(run);
  }

  private scan(run: SearchRun, document: SearchDocument, limit: number): Promise<SearchScanResult> {
    return this.options.executor.scan({
      document,
      content: run.content ?? "",
      query: run.query,
      offset: run.offset,
      limit,
      maxReplacementBytes: this.limits.maxFileBytes - run.replacementBytes,
    }, {
      signal: run.abort.signal,
      ...(run.query.regex ? { budgetMs: Math.max(1, this.limits.regexBudgetMs - run.regexElapsed) } : {}),
    });
  }
}
