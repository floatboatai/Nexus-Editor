import {
  EDITOR_HOST_CAPABILITY,
  NexusComponent,
  NexusPluginBase,
  UI_CAPABILITY,
  type AuthorPluginManifest,
  type EditorContext,
  type EditorHostService,
  type EditorId,
  type NexusApp,
  type NormalizedPluginManifest,
  type UiSlotRegistration,
  type WindowId,
} from "@floatboat/nexus-plugin-api";

import { countMarkdown, type WordCountOptions, type WordCountStats } from "./count";
import type { Unsubscribe, WordCountState } from "./plugin";
import { defaultStatusBarLabels, type WordCountLabels } from "./status-bar";

export interface WordCountLifecyclePluginOptions extends WordCountOptions {
  /** Full-document recompute delay. Selection changes remain synchronous. */
  readonly debounceMs?: number;
  readonly labels?: Partial<WordCountLabels>;
  readonly locale?: string | string[];
  readonly summaryLabel?: string;
}

export interface EditorWordCountState extends WordCountState {
  readonly editorId: EditorId;
}

export type EditorWordCountListener = (state: EditorWordCountState) => void;

const EMPTY_STATS: WordCountStats = Object.freeze({
  words: 0,
  latinWords: 0,
  cjkCharacters: 0,
  characters: 0,
  charactersNoSpaces: 0,
  lines: 0,
  paragraphs: 0,
  sentences: 0,
  readingTimeSeconds: 0,
});

function emptyState(editorId: EditorId): EditorWordCountState {
  return Object.freeze({
    editorId,
    doc: EMPTY_STATS,
    selection: EMPTY_STATS,
    isSelectionActive: false,
  });
}

class EditorWordCountBinding extends NexusComponent {
  state: EditorWordCountState;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;

  constructor(
    public context: EditorContext,
    private readonly debounceMs: number,
    private readonly countOptions: WordCountOptions,
    private readonly publishState: (binding: EditorWordCountBinding) => void,
  ) {
    super();
    this.state = emptyState(context.editorId);
  }

  override onload(): void {
    this.register({
      activate: () => {
        if (this.active) return;
        this.active = true;
        this.context.editor.on("change", this.onChange);
        this.context.editor.on("selectionChange", this.onSelectionChange);
        this.recompute();
      },
      quiesce: this.release,
      dispose: this.release,
    });
  }

  private readonly computeSelection = (): Pick<WordCountState, "selection" | "isSelectionActive"> => {
    try {
      const { anchor, head } = this.context.editor.getSelection();
      const from = Math.min(anchor, head);
      const to = Math.max(anchor, head);
      if (from === to) return { selection: EMPTY_STATS, isSelectionActive: false };
      return {
        selection: countMarkdown(
          this.context.editor.getDocument().slice(from, to),
          this.countOptions,
        ),
        isSelectionActive: true,
      };
    } catch {
      return { selection: EMPTY_STATS, isSelectionActive: false };
    }
  };

  private readonly recompute = (): void => {
    if (!this.active) return;
    let doc = EMPTY_STATS;
    try {
      doc = countMarkdown(this.context.editor.getDocument(), {
        ...this.countOptions,
        ast: this.context.editor.getAst(),
      });
    } catch {
      // A detached editor can reject reads while its child removal is queued.
    }
    this.publish({ editorId: this.context.editorId, doc, ...this.computeSelection() });
  };

  private readonly onChange = (): void => {
    if (this.timer) clearTimeout(this.timer);
    if (this.debounceMs === 0) {
      this.recompute();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.recompute();
    }, this.debounceMs);
  };

  private readonly onSelectionChange = (): void => {
    if (!this.active) return;
    this.publish({
      editorId: this.context.editorId,
      doc: this.state.doc,
      ...this.computeSelection(),
    });
  };

  private readonly release = (): void => {
    if (!this.active) return;
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.context.editor.off("change", this.onChange);
    this.context.editor.off("selectionChange", this.onSelectionChange);
  };

  private publish(state: EditorWordCountState): void {
    this.state = Object.freeze(state);
    this.publishState(this);
  }
}

/** Manifest used by hosts that bundle the lifecycle-based word-count plugin. */
export const wordCountLifecyclePluginManifest = Object.freeze({
  schemaVersion: 1,
  id: "wordcount",
  name: "Word Count",
  version: "1.0.0",
  entrypoint: "wordcount.js",
  apiVersion: "^1.0.0",
  requiredCapabilities: [
    { id: EDITOR_HOST_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
  ],
  optionalCapabilities: [
    { id: UI_CAPABILITY.id, version: "^1.0.0", scope: "window" as const },
  ],
} satisfies AuthorPluginManifest);

/**
 * Application-level word-count plugin. One instance follows every editor host;
 * each editor owns an independent timer, listener pair and state snapshot.
 */
export class WordCountLifecyclePlugin extends NexusPluginBase {
  private readonly bindings = new Map<EditorId, EditorWordCountBinding>();
  private readonly listeners = new Set<EditorWordCountListener>();
  private readonly statusRegistrations = new Map<WindowId, UiSlotRegistration>();
  private readonly debounceMs: number;
  private readonly countOptions: WordCountOptions;
  private editors: EditorHostService | null = null;
  private recentWindowId: WindowId | null = null;
  private labels: WordCountLabels;
  private formatter: Intl.NumberFormat;
  private summaryLabel: string;

  constructor(
    app: NexusApp,
    manifest: NormalizedPluginManifest,
    options: WordCountLifecyclePluginOptions = {},
  ) {
    super(app, manifest);
    this.debounceMs = Math.max(0, options.debounceMs ?? 150);
    this.countOptions = {
      cjkUnit: options.cjkUnit,
      exclude: options.exclude,
      readingSpeed: options.readingSpeed,
    };
    this.labels = { ...defaultStatusBarLabels, ...options.labels };
    this.formatter = new Intl.NumberFormat(options.locale);
    this.summaryLabel = options.summaryLabel ?? "Document statistics";
  }

  setLabels(
    labels: Partial<WordCountLabels>,
    locale?: string | string[],
    summaryLabel = "Document statistics",
  ): void {
    this.labels = { ...defaultStatusBarLabels, ...labels };
    this.formatter = new Intl.NumberFormat(locale);
    this.summaryLabel = summaryLabel;
    for (const [windowId] of this.statusRegistrations) this.refreshWindowStatus(windowId);
  }

  override async onload(): Promise<void> {
    const editors = this.app.capabilities.require(EDITOR_HOST_CAPABILITY, "^1.0.0");
    this.editors = editors;
    editors.events.on("attached", (context) => {
      void this.attachEditor(context).catch((error) => this.reportBindingFailure(context.editorId, "attach", error));
    });
    editors.events.on("detached", ({ editorId }) => this.detachEditor(editorId));
    editors.events.on("contextChanged", (context) => this.updateEditorContext(context));
    editors.events.on("recentChanged", ({ editor }) => this.updateRecentEditor(editor));
    await Promise.all(editors.list().map((context) => this.attachEditor(context)));
    this.updateRecentEditor(editors.getRecent());
  }

  override onunload(): void {
    this.editors = null;
    this.recentWindowId = null;
    this.statusRegistrations.clear();
    this.listeners.clear();
    this.bindings.clear();
  }

  getEditorIds(): readonly EditorId[] {
    return Object.freeze([...this.bindings.keys()]);
  }

  getState(editorId: EditorId): EditorWordCountState | undefined {
    return this.bindings.get(editorId)?.state;
  }

  subscribe(listener: EditorWordCountListener): Unsubscribe {
    this.listeners.add(listener);
    for (const binding of this.bindings.values()) listener(binding.state);
    return () => this.listeners.delete(listener);
  }

  private async attachEditor(context: EditorContext): Promise<void> {
    if (this.bindings.has(context.editorId)) return;
    const binding = new EditorWordCountBinding(
      context,
      this.debounceMs,
      this.countOptions,
      (published) => this.publishBinding(published),
    );
    this.bindings.set(context.editorId, binding);
    this.mountWindowStatus(context);
    try {
      await this.addChild(binding);
    } catch (error) {
      if (this.bindings.get(context.editorId) === binding) {
        this.bindings.delete(context.editorId);
        const windowId = context.window?.id;
        if (windowId) this.reconcileWindowStatus(windowId);
      }
      throw error;
    }
  }

  private detachEditor(editorId: EditorId): void {
    const binding = this.bindings.get(editorId);
    if (!binding) return;
    this.bindings.delete(editorId);
    void this.removeChild(binding).catch((error) => this.reportBindingFailure(editorId, "detach", error));
    const windowId = binding.context.window?.id;
    if (windowId) this.reconcileWindowStatus(windowId);
  }

  private updateEditorContext(context: EditorContext): void {
    const binding = this.bindings.get(context.editorId);
    if (!binding) return;
    const previousWindowId = binding.context.window?.id;
    binding.context = context;
    const nextWindowId = context.window?.id;

    if (previousWindowId && previousWindowId !== nextWindowId) {
      this.reconcileWindowStatus(previousWindowId);
    }
    if (this.editors?.getRecent()?.editorId === context.editorId) {
      this.recentWindowId = nextWindowId ?? null;
    }
    this.mountWindowStatus(context);
    if (nextWindowId) this.refreshWindowStatus(nextWindowId, context.editorId);
  }

  private reconcileWindowStatus(windowId: WindowId): void {
    const replacement = [...this.bindings.values()].find(
      (candidate) => candidate.context.window?.id === windowId,
    );
    if (replacement) {
      this.refreshWindowStatus(windowId, replacement.context.editorId);
      return;
    }
    const result = this.statusRegistrations.get(windowId)?.update({});
    if (result && !result.ok) this.app.diagnostics.report(result.diagnostic);
  }

  private mountWindowStatus(context: EditorContext): void {
    const window = context.window;
    if (!window || this.statusRegistrations.has(window.id)) return;
    const ui = this.app.capabilities.get(UI_CAPABILITY, "^1.0.0", {
      windowId: window.id,
    });
    if (!ui) return;
    const result = ui.registerAction("status-bar", {
      id: "document-stats",
      label: `0 ${this.labels.words}, 0 ${this.labels.characters}`,
      ariaLabel: `${this.summaryLabel}: 0 ${this.labels.words}, 0 ${this.labels.characters}`,
      tooltip: this.summaryLabel,
      visible: () => this.hasBindingInWindow(window.id),
      action: () => undefined,
    });
    if (!result.ok) {
      if (result.diagnostic.code !== "platform-unsupported") {
        this.app.diagnostics.report(result.diagnostic);
      }
      return;
    }
    this.statusRegistrations.set(window.id, result.registration);
    this.refreshWindowStatus(window.id, context.editorId);
  }

  private refreshWindowStatus(windowId: WindowId, preferredEditorId?: EditorId): void {
    const registration = this.statusRegistrations.get(windowId);
    if (!registration) return;
    const recent = this.editors?.getRecent();
    const target = recent?.window?.id === windowId
      ? this.bindings.get(recent.editorId)
      : preferredEditorId && this.bindings.get(preferredEditorId)?.context.window?.id === windowId
        ? this.bindings.get(preferredEditorId)
        : [...this.bindings.values()].reverse().find(
            (binding) => binding.context.window?.id === windowId,
          );
    if (!target) {
      const hidden = registration.update({});
      if (!hidden.ok) this.app.diagnostics.report(hidden.diagnostic);
      return;
    }
    const state = target.state;
    const selectedLabel = this.labels.selection === defaultStatusBarLabels.selection
      ? "selected"
      : this.labels.selection;
    const selection = state.isSelectionActive
      ? `; ${selectedLabel} ${this.formatter.format(state.selection.words)} ${this.labels.words}, ${this.formatter.format(state.selection.characters)} ${this.labels.characters}`
      : "";
    const label = `${this.formatter.format(state.doc.words)} ${this.labels.words}, ${this.formatter.format(state.doc.characters)} ${this.labels.characters}${selection}`;
    const result = registration.update({
      label,
      ariaLabel: `${this.summaryLabel}: ${label}`,
      tooltip: this.summaryLabel,
    });
    if (!result.ok) this.app.diagnostics.report(result.diagnostic);
  }

  private publishBinding(binding: EditorWordCountBinding): void {
    if (this.bindings.get(binding.context.editorId) !== binding) return;
    for (const listener of this.listeners) listener(binding.state);
    const windowId = binding.context.window?.id;
    if (windowId) this.refreshWindowStatus(windowId, binding.context.editorId);
  }

  private updateRecentEditor(editor: EditorContext | null): void {
    const previousWindowId = this.recentWindowId;
    const nextWindowId = editor?.window?.id ?? null;
    this.recentWindowId = nextWindowId;
    if (previousWindowId && previousWindowId !== nextWindowId) {
      this.refreshWindowStatus(previousWindowId);
    }
    if (nextWindowId) this.refreshWindowStatus(nextWindowId, editor?.editorId);
  }

  private hasBindingInWindow(windowId: WindowId): boolean {
    return [...this.bindings.values()].some((binding) => binding.context.window?.id === windowId);
  }

  private reportBindingFailure(editorId: EditorId, operation: "attach" | "detach", error: unknown): void {
    this.app.diagnostics.report({
      code: operation === "attach" ? "callback-failed" : "lifecycle-cleanup-failed",
      severity: "error",
      phase: operation === "attach" ? "callback" : "unloading",
      message: `Word-count editor binding ${operation} failed`,
      plugin: { id: this.identity.id, version: this.identity.version },
      resourceId: String(editorId),
      cause: error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: String(error) },
    });
  }
}
