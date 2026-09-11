import { EditorState, StateEffect } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { EditorAPI, EditorContributionRegistration } from "@floatboat/nexus-core";
import { headlessActions, headlessSearchMode } from "./headless-extension";
import {
  SearchController,
  type SearchControllerOptions,
  type SearchState,
} from "./workspace";
import { SearchError, type SearchHit, type SearchQuery } from "./search-types";

export type { SearchQuery, SearchHit } from "./search-types";

export interface DocumentSearchOptions {
  readonly executor: SearchControllerOptions["executor"];
  readonly limits?: SearchControllerOptions["limits"];
  readonly document?: { readonly id: string; readonly path: string };
}

export interface DocumentSearchState extends Omit<SearchState, "status"> {
  readonly status: SearchState["status"] | "busy" | "disposed";
  readonly active: boolean;
  readonly readOnly: boolean;
  readonly canApply: boolean;
}

export interface DocumentSearchActionResult {
  readonly status: "applied" | "busy" | "conflict" | "read-only" | "unavailable" |
    "unsupported" | "disposed" | "transaction-rejected";
  readonly count: number;
}

const bindings = new WeakMap<EditorAPI, DocumentSearchController>();
let sequence = 0;

/** Binds one concrete editor. No global editor lookup, panel DOM or filesystem access. */
export function createDocumentSearchController(
  editor: EditorAPI,
  options: DocumentSearchOptions,
): DocumentSearchController {
  return new DocumentSearchController(editor, options);
}

export class DocumentSearchController {
  readonly ready: Promise<void>;
  private readonly search: SearchController;
  private readonly registration: EditorContributionRegistration;
  private readonly listeners = new Set<(state: DocumentSearchState) => void>();
  private readonly document: { readonly id: string; readonly path: string };
  private readonly refreshEffect = StateEffect.define<null>();
  private readonly unsubscribe: () => void;
  private view: EditorView | null = null;
  private query: SearchQuery = { text: "" };
  private queryGeneration = 0;
  private content = "";
  private version = "";
  private localRevision = 0;
  private active = false;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;
  private queued = false;
  private decorationsQueued = false;
  private busyTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly editor: EditorAPI, options: DocumentSearchOptions) {
    if (bindings.has(editor)) throw new Error("This editor already has a document search controller");
    this.document = options.document ?? { id: `document-search:${++sequence}`, path: "document.md" };
    this.search = new SearchController({
      executor: options.executor,
      limits: options.limits,
      source: {
        list: async (signal) => {
          const snapshot = await this.capture(signal);
          return [{ ...this.document, version: snapshot.version }];
        },
        read: async (_document, signal) => this.capture(signal),
      },
    });
    bindings.set(editor, this);
    const controller = this;
    const extension = ViewPlugin.fromClass(class {
      decorations: DecorationSet = Decoration.none;
      constructor(view: EditorView) {
        controller.view = view;
        if (view.state.facet(headlessSearchMode)) {
          headlessActions.set(view, {
            open: () => controller.open(),
            close: () => {
              const open = controller.active;
              controller.close();
              return open;
            },
            next: () => controller.findNext(),
            previous: () => controller.findPrevious(),
          });
        }
      }
      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = Decoration.none;
          controller.localRevision += 1;
          controller.scheduleQuery();
        } else if (update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(controller.refreshEffect)))) {
          const state = controller.getState();
          this.decorations = state.active && state.canApply
            ? Decoration.set(state.hits.filter((hit) => hit.from < hit.to).map((hit) =>
              Decoration.mark({ class: "cm-searchMatch" }).range(hit.from, hit.to)), true)
            : Decoration.none;
        }
      }
      destroy() { void controller.finish(false).catch(() => undefined); }
    }, { decorations: (plugin) => plugin.decorations });
    try {
      this.registration = editor.getContributionSink().registerExtension(this.document.id, extension);
    } catch (error) {
      bindings.delete(editor);
      void this.search.destroy().catch(() => undefined);
      throw error;
    }
    this.ready = this.registration.ready.then(() => {
      if (!this.view?.state.facet(headlessSearchMode)) {
        throw new SearchError("unsupported", "Install createSearchPlugin({ ui: 'headless' }) before binding its controller");
      }
      if (this.disposed) throw new SearchError("disposed", "Document search is disposed");
    });
    void this.ready.catch(() => this.finish(true)).catch(() => undefined);
    this.unsubscribe = this.search.subscribe(() => this.publish());
  }

  getState(): DocumentSearchState {
    const state = this.search.getState();
    const busy = !this.disposed && (state.error?.code === "busy" || this.isBusy());
    const current = this.editor.getDocumentRevision?.();
    return Object.freeze({
      ...state,
      status: this.disposed ? "disposed" : busy ? "busy" : state.status,
      active: this.active,
      readOnly: this.editor.isReadOnly?.() ?? true,
      canApply: !this.disposed && !busy && current !== undefined && current === this.version &&
        this.editor.getDocument() === this.content,
    });
  }

  subscribe(listener: (state: DocumentSearchState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  open(): void {
    if (this.disposed) return;
    this.active = true;
    this.publish();
  }

  close(): void {
    this.active = false;
    this.publish();
  }

  async setQuery(query: SearchQuery): Promise<void> {
    await this.ready;
    if (this.disposed) return;
    this.query = Object.freeze({ ...query });
    this.queryGeneration += 1;
    await this.search.search(this.query);
    this.publish();
  }

  async loadMore(): Promise<void> {
    await this.ready;
    await this.search.loadMore();
  }

  async findNext(): Promise<DocumentSearchActionResult> { return this.move(1); }
  async findPrevious(): Promise<DocumentSearchActionResult> { return this.move(-1); }

  async selectMatch(hit: SearchHit): Promise<DocumentSearchActionResult> {
    await this.ready;
    const rejected = this.validate([hit], false);
    if (rejected) return rejected;
    this.editor.setSelection(hit.from, hit.to);
    this.view?.dispatch({ effects: EditorView.scrollIntoView(hit.from) });
    return { status: "applied", count: 1 };
  }

  async selectAll(): Promise<DocumentSearchActionResult> {
    await this.complete();
    const hits = this.search.getState().hits;
    const rejected = this.validate(hits, false);
    if (rejected) return rejected;
    if (this.search.getState().truncated) return { status: "unavailable", count: 0 };
    if (hits.length > 1 && !this.view?.state.facet(EditorState.allowMultipleSelections)) {
      return { status: "unsupported", count: 0 };
    }
    this.editor.setSelections(hits.map((hit) => ({ anchor: hit.from, head: hit.to })));
    return { status: "applied", count: hits.length };
  }

  async replaceNext(replacement: string): Promise<DocumentSearchActionResult> {
    const guard = this.validate(this.search.getState().hits, true);
    if (guard) return guard;
    const selection = this.editor.getSelection();
    const version = this.version;
    const generation = this.queryGeneration + 1;
    const from = Math.min(selection.anchor, selection.head);
    const to = Math.max(selection.anchor, selection.head);
    await this.setQuery({ ...this.query, replacement });
    for (;;) {
      if (generation !== this.queryGeneration || version !== this.version) {
        return { status: "conflict", count: 0 };
      }
      const state = this.search.getState();
      const rejected = this.validate(state.hits, true);
      if (rejected) return rejected;
      const hit = state.hits.find((item) => item.from === from && item.to === to) ??
        state.hits.find((item) => item.from >= to);
      if (hit) return this.apply([hit]);
      // A missing match on this page is not permission to wrap to the beginning.
      if (state.hasMore) {
        await this.search.loadMore();
        continue;
      }
      if (state.truncated) return { status: "unavailable", count: 0 };
      return this.apply(state.hits.slice(0, 1));
    }
  }

  async replaceAll(replacement: string): Promise<DocumentSearchActionResult> {
    const guard = this.validate(this.search.getState().hits, true);
    if (guard) return guard;
    const version = this.version;
    const generation = this.queryGeneration + 1;
    await this.setQuery({ ...this.query, replacement });
    await this.complete();
    if (generation !== this.queryGeneration || version !== this.version) return { status: "conflict", count: 0 };
    if (this.search.getState().truncated) return { status: "unavailable", count: 0 };
    return this.apply(this.search.getState().hits);
  }

  dispose(): Promise<void> { return this.finish(true); }

  private isBusy(): boolean {
    return this.editor.isComposing() || this.editor.getContributionSink().isInteractionActive();
  }

  private async capture(signal: AbortSignal): Promise<{ content: string; version: string }> {
    if (this.disposed) throw new SearchError("disposed", "Document search is disposed");
    if (this.isBusy()) throw new SearchError("busy", "Input is still active; finish the table interaction first");
    const localRevision = this.localRevision;
    const snapshot = await this.editor.captureDocumentSnapshot({ signal });
    if (this.isBusy() || snapshot.markdown !== this.editor.getDocument()) {
      throw new SearchError("busy", "Pending input has not been committed to the document");
    }
    const revision = this.editor.getDocumentRevision?.();
    if (localRevision !== this.localRevision || (revision !== undefined && snapshot.revision !== undefined && snapshot.revision !== revision)) {
      throw new SearchError("source-changed", "Document changed during capture");
    }
    this.content = snapshot.markdown;
    this.version = revision ?? `local:${localRevision}`;
    return { content: this.content, version: this.version };
  }

  private async complete(): Promise<void> {
    await this.ready;
    while (!this.disposed && this.search.getState().hasMore) await this.search.loadMore();
  }

  private async move(direction: 1 | -1): Promise<DocumentSearchActionResult> {
    this.open();
    await this.complete();
    const hits = this.search.getState().hits;
    const rejected = this.validate(hits, false);
    if (rejected) return rejected;
    const { anchor, head } = this.editor.getSelection();
    const exact = hits.findIndex((hit) => hit.from === Math.min(anchor, head) && hit.to === Math.max(anchor, head));
    let index = exact >= 0 ? (exact + direction + hits.length) % hits.length : -1;
    if (exact < 0 && direction === 1) index = hits.findIndex((hit) => hit.from >= Math.max(anchor, head));
    if (exact < 0 && direction === -1) {
      for (let candidate = hits.length - 1; candidate >= 0; candidate -= 1) {
        if (hits[candidate].to <= Math.min(anchor, head)) {
          index = candidate;
          break;
        }
      }
    }
    const wrappedIndex = direction === 1 ? 0 : hits.length - 1;
    return this.selectMatch(hits[index < 0 ? wrappedIndex : index]);
  }

  private validate(hits: readonly SearchHit[], write: boolean): DocumentSearchActionResult | null {
    const reject = (status: DocumentSearchActionResult["status"]): DocumentSearchActionResult => ({ status, count: 0 });
    if (this.disposed) return reject("disposed");
    if (this.isBusy()) return reject("busy");
    if (!this.editor.getDocumentRevision || !this.editor.isReadOnly) return reject("unsupported");
    if (write && this.editor.isReadOnly()) return reject("read-only");
    if (this.editor.getDocumentRevision() !== this.version || this.editor.getDocument() !== this.content ||
      hits.some((hit) => hit.fileId !== this.document.id || hit.version !== this.version ||
        hit.from < 0 || hit.to < hit.from || hit.to > this.content.length)) {
      this.scheduleQuery();
      return reject("conflict");
    }
    if (!hits.length || this.search.getState().status !== "ready") return reject("unavailable");
    return null;
  }

  private apply(hits: readonly SearchHit[]): DocumentSearchActionResult {
    const rejected = this.validate(hits, true);
    if (rejected) return rejected;
    if (hits.some((hit) => hit.replacement === undefined)) return { status: "unavailable", count: 0 };
    const result = this.editor.dispatchTransaction({
      changes: hits.map((hit) => ({ from: hit.from, to: hit.to, insert: hit.replacement ?? "" })),
      origin: ["nexus-search"],
      userEvent: "input.replace",
      history: "isolate",
    });
    const applied = result.status === "success";
    return {
      status: applied ? "applied" : "transaction-rejected",
      count: applied ? hits.length : 0,
    };
  }

  private scheduleQuery(): void {
    if (this.queued || this.disposed || !this.query.text) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (!this.disposed) void this.setQuery(this.query).catch(() => undefined);
    });
  }

  private publish(): void {
    if (this.disposed) return;
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
    if (state.error?.code === "source-changed") this.scheduleQuery();
    if (state.status === "busy" && this.busyTimer === undefined) {
      this.busyTimer = setTimeout(() => {
        this.busyTimer = undefined;
        if (!this.disposed) {
          if (this.isBusy()) this.publish();
          else this.scheduleQuery();
        }
      }, 50);
    }
    if (!this.decorationsQueued) {
      this.decorationsQueued = true;
      queueMicrotask(() => {
        this.decorationsQueued = false;
        if (!this.disposed && this.view) this.view.dispatch({ effects: this.refreshEffect.of(null) });
      });
    }
  }

  private finish(remove: boolean): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.active = false;
    if (this.busyTimer !== undefined) clearTimeout(this.busyTimer);
    this.unsubscribe?.();
    if (this.view) headlessActions.delete(this.view);
    this.view = null;
    bindings.delete(this.editor);
    for (const listener of this.listeners) listener(this.getState());
    this.listeners.clear();
    this.disposePromise = Promise.resolve().then(async () => {
      await Promise.all([
        this.search.destroy(),
        ...(remove ? [this.registration.dispose()] : []),
      ]);
    });
    return this.disposePromise;
  }
}
