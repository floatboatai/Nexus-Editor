import { Compartment, StateEffect, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { isTableEditing } from "./live-preview-table";
import { findProvidedInputTarget } from "./input-target-provider";
import type {
  EditorAPI,
  EditorContributionRegistration,
  EditorExtensionContributionSink,
  EditorDomEventHook,
  EditorDomEventHookContext,
  EditorDomEventHookOptions,
  EditorDomEventMap,
  EditorDomEventType,
  EditorInputSurface,
  EditorInputTarget,
} from "./types";

export const EDITOR_PLUGIN_PRIORITY_MIN = -10_000;
export const EDITOR_PLUGIN_PRIORITY_MAX = 10_000;

/** Non-document transaction used by dynamic registries to refresh derived editor state. */
export const editorContributionRefreshEffect = StateEffect.define<null>();

const DOM_EVENT_TYPES: readonly EditorDomEventType[] = [
  "copy",
  "cut",
  "paste",
  "beforeinput",
  "drop",
  "contextmenu",
  "keydown",
];

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
  settled: boolean;
}

interface OwnerExtensionState {
  compartment: Compartment;
  extensions: Map<string, Extension>;
  installed: boolean;
  version: number;
  appliedVersion: number;
  waiters: Array<{ version: number; deferred: Deferred }>;
}

interface DomHookEntry<K extends EditorDomEventType = EditorDomEventType> {
  id: string;
  ownerId: string;
  event: K;
  handler: EditorDomEventHook<K>;
  phase: "capture" | "bubble";
  priority: number;
  observeAfterConsumed: boolean;
  surfaces: ReadonlySet<EditorInputSurface> | null;
  sequence: number;
  disposed: boolean;
}

interface InputTargetEntry {
  id: string;
  ownerId: string;
  root: HTMLElement;
  target: Omit<EditorInputTarget, "element">;
  disposed: boolean;
  readonly lifetime: AbortController;
}

export interface DynamicContributionHost {
  readonly view: EditorView;
  readonly editor: EditorAPI;
  isComposing(): boolean;
  isDestroyed(): boolean;
  insertMarkdown(markdown: string): void;
  uploadAsset(file: File): Promise<string | null>;
}

function createDeferred(): Deferred {
  let resolvePromise!: () => void;
  let rejectPromise!: (reason: unknown) => void;
  const deferred: Deferred = {
    promise: new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve: () => {
      if (deferred.settled) return;
      deferred.settled = true;
      resolvePromise();
    },
    reject: (reason) => {
      if (deferred.settled) return;
      deferred.settled = true;
      rejectPromise(reason);
    },
    settled: false,
  };
  return deferred;
}

function validateOwnerId(ownerId: string): void {
  if (ownerId.trim().length === 0) {
    throw new TypeError("Editor contribution ownerId must not be empty");
  }
}

function normalizePriority(priority: number | undefined): number {
  const value = priority ?? 0;
  if (!Number.isInteger(value) || value < EDITOR_PLUGIN_PRIORITY_MIN || value > EDITOR_PLUGIN_PRIORITY_MAX) {
    throw new RangeError(
      `Editor DOM event priority must be an integer between ${EDITOR_PLUGIN_PRIORITY_MIN} and ${EDITOR_PLUGIN_PRIORITY_MAX}`
    );
  }
  return value;
}

function asElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

export class DynamicEditorContributionSink implements EditorExtensionContributionSink {
  private readonly dispatchedBubbleEvents = new WeakSet<Event>();
  private readonly ownerExtensions = new Map<string, OwnerExtensionState>();
  private readonly domHooks = new Map<string, DomHookEntry>();
  private readonly inputTargets = new Map<string, InputTargetEntry>();
  private readonly listeners: Array<{
    target: EventTarget;
    type: string;
    listener: EventListener;
    options?: boolean | AddEventListenerOptions;
  }> = [];
  private registrationSequence = 0;
  private registrationId = 0;
  private mouseInteractionActive = false;
  private flushScheduled = false;
  private destroyed = false;

  constructor(private readonly host: DynamicContributionHost) {
    const root = host.view.dom;
    for (const type of DOM_EVENT_TYPES) {
      this.listen(root, type, (event) => this.dispatchDomEvent(type, "capture", event), true);
      this.listen(root, type, (event) => this.dispatchDomEvent(type, "bubble", event), false);
    }
    this.listen(root, "mousedown", () => {
      this.mouseInteractionActive = true;
    }, true);
    const ownerWindow = root.ownerDocument.defaultView;
    if (ownerWindow) {
      this.listen(ownerWindow, "mouseup", () => {
        this.mouseInteractionActive = false;
        this.scheduleFlush();
      }, true);
      this.listen(ownerWindow, "blur", () => {
        this.mouseInteractionActive = false;
        this.scheduleFlush();
      });
    }
  }

  registerExtension(ownerId: string, extension: Extension): EditorContributionRegistration {
    validateOwnerId(ownerId);
    this.assertAlive();
    const id = this.nextId("extension");
    let state = this.ownerExtensions.get(ownerId);
    if (!state) {
      state = {
        compartment: new Compartment(),
        extensions: new Map(),
        installed: false,
        version: 0,
        appliedVersion: 0,
        waiters: [],
      };
      this.ownerExtensions.set(ownerId, state);
    }
    state.extensions.set(id, extension);
    const ready = this.bumpOwnerVersion(state);
    let disposed = false;
    let disposePromise: Promise<void> | null = null;
    return {
      id,
      ownerId,
      get disposed() {
        return disposed;
      },
      ready,
      dispose: () => {
        if (disposePromise) return disposePromise;
        disposed = true;
        if (!state!.extensions.delete(id) || this.destroyed) {
          disposePromise = Promise.resolve();
          return disposePromise;
        }
        disposePromise = this.bumpOwnerVersion(state!);
        return disposePromise;
      },
    };
  }

  registerDomEvent<K extends EditorDomEventType>(
    ownerId: string,
    event: K,
    handler: EditorDomEventHook<K>,
    options: EditorDomEventHookOptions = {}
  ): EditorContributionRegistration {
    validateOwnerId(ownerId);
    this.assertAlive();
    const id = this.nextId("dom");
    const entry: DomHookEntry<K> = {
      id,
      ownerId,
      event,
      handler,
      phase: options.phase ?? "capture",
      priority: normalizePriority(options.priority),
      observeAfterConsumed: options.observeAfterConsumed === true,
      surfaces: options.surfaces ? new Set(options.surfaces) : null,
      sequence: this.registrationSequence++,
      disposed: false,
    };
    this.domHooks.set(id, entry as unknown as DomHookEntry);
    return this.immediateRegistration(id, ownerId, () => {
      entry.disposed = true;
      this.domHooks.delete(id);
    });
  }

  registerInputTarget(
    ownerId: string,
    root: HTMLElement,
    target: Omit<EditorInputTarget, "element">
  ): EditorContributionRegistration {
    validateOwnerId(ownerId);
    this.assertAlive();
    if (!this.host.view.dom.contains(root)) {
      throw new RangeError("Editor input target root must be inside the editor DOM");
    }
    const id = this.nextId("target");
    const entry: InputTargetEntry = { id, ownerId, root, target, disposed: false, lifetime: new AbortController() };
    this.inputTargets.set(id, entry);
    return this.immediateRegistration(id, ownerId, () => {
      entry.disposed = true;
      entry.lifetime.abort();
      this.inputTargets.delete(id);
    });
  }

  isInteractionActive(): boolean {
    if (this.destroyed || this.host.isDestroyed()) return false;
    const view = this.host.view;
    return (
      this.mouseInteractionActive ||
      this.host.isComposing() ||
      view.composing ||
      view.compositionStarted ||
      isTableEditing(view)
    );
  }

  refresh(): Promise<void> {
    this.assertAlive();
    const deferred = createDeferred();
    const run = () => {
      if (this.destroyed || this.host.isDestroyed()) {
        deferred.resolve();
        return;
      }
      if (this.isInteractionActive()) {
        const ownerWindow = this.host.view.dom.ownerDocument.defaultView;
        if (ownerWindow?.requestAnimationFrame) ownerWindow.requestAnimationFrame(run);
        else setTimeout(run, 0);
        return;
      }
      try {
        this.host.view.dispatch({ effects: editorContributionRefreshEffect.of(null) });
        deferred.resolve();
      } catch (error) {
        deferred.reject(error);
      }
    };
    run();
    return deferred.promise;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const item of this.listeners) {
      item.target.removeEventListener(item.type, item.listener, item.options);
    }
    this.listeners.length = 0;
    this.domHooks.clear();
    for (const entry of this.inputTargets.values()) entry.lifetime.abort();
    this.inputTargets.clear();
    for (const state of this.ownerExtensions.values()) {
      for (const waiter of state.waiters) waiter.deferred.resolve();
      state.waiters.length = 0;
      state.extensions.clear();
    }
    this.ownerExtensions.clear();
  }

  private nextId(prefix: string): string {
    this.registrationId += 1;
    return `${prefix}:${this.registrationId}`;
  }

  private assertAlive(): void {
    if (this.destroyed || this.host.isDestroyed()) {
      throw new Error("Cannot register a contribution on a destroyed editor");
    }
  }

  private immediateRegistration(
    id: string,
    ownerId: string,
    dispose: () => void
  ): EditorContributionRegistration {
    let disposed = false;
    const ready = Promise.resolve();
    return {
      id,
      ownerId,
      get disposed() {
        return disposed;
      },
      ready,
      async dispose() {
        if (disposed) return;
        disposed = true;
        dispose();
      },
    };
  }

  private bumpOwnerVersion(state: OwnerExtensionState): Promise<void> {
    state.version += 1;
    const deferred = createDeferred();
    state.waiters.push({ version: state.version, deferred });
    this.scheduleFlush();
    return deferred.promise;
  }

  private scheduleFlush(): void {
    if (this.flushScheduled || this.destroyed) return;
    this.flushScheduled = true;
    const ownerWindow = this.host.view.dom.ownerDocument.defaultView;
    const run = () => {
      this.flushScheduled = false;
      if (this.destroyed) return;
      if (this.isInteractionActive()) {
        this.scheduleFlush();
        return;
      }
      this.flushExtensions();
    };
    if (ownerWindow?.requestAnimationFrame) {
      ownerWindow.requestAnimationFrame(run);
    } else {
      setTimeout(run, 0);
    }
  }

  private flushExtensions(): void {
    for (const state of this.ownerExtensions.values()) {
      if (state.appliedVersion >= state.version) continue;
      const targetVersion = state.version;
      const extensionTree = Array.from(state.extensions.values());
      try {
        if (state.installed) {
          this.host.view.dispatch({ effects: state.compartment.reconfigure(extensionTree) });
        } else {
          this.host.view.dispatch({ effects: StateEffect.appendConfig.of(state.compartment.of(extensionTree)) });
          state.installed = true;
        }
        state.appliedVersion = targetVersion;
        this.settleOwnerWaiters(state, targetVersion);
      } catch (error) {
        this.settleOwnerWaiters(state, targetVersion, error);
      }
    }
  }

  private settleOwnerWaiters(state: OwnerExtensionState, version: number, error?: unknown): void {
    const remaining: OwnerExtensionState["waiters"] = [];
    for (const waiter of state.waiters) {
      if (waiter.version <= version) {
        if (error === undefined) waiter.deferred.resolve();
        else waiter.deferred.reject(error);
      } else {
        remaining.push(waiter);
      }
    }
    state.waiters = remaining;
  }

  private listen(
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions
  ): void {
    target.addEventListener(type, listener, options);
    this.listeners.push({ target, type, listener, options });
  }

  private dispatchDomEvent(
    eventType: EditorDomEventType,
    phase: "capture" | "bubble",
    rawEvent: Event
  ): void {
    if (this.destroyed) return;
    if (phase === "bubble") {
      if (this.dispatchedBubbleEvents.has(rawEvent)) return;
      this.dispatchedBubbleEvents.add(rawEvent);
    }
    const event = rawEvent as EditorDomEventMap[typeof eventType];
    const element = asElement(event.target);
    const inputTarget = this.resolveInputTarget(element);
    const surface = inputTarget?.kind ?? this.resolveSurface(element);
    const entries = Array.from(this.domHooks.values())
      .filter((entry) => (
        !entry.disposed &&
        entry.event === eventType &&
        entry.phase === phase &&
        (!entry.surfaces || entry.surfaces.has(surface))
      ))
      .sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
    if (entries.length === 0) return;

    const context = this.createDomContext(surface, inputTarget);
    let consumed = event.defaultPrevented;
    for (const entry of entries) {
      if (entry.disposed || (consumed && !entry.observeAfterConsumed)) continue;
      try {
        const result = entry.handler(event as never, context);
        if (result === true || result === "consume") {
          consumed = true;
          if (event.cancelable && !event.defaultPrevented) event.preventDefault();
        } else if (event.defaultPrevented) {
          consumed = true;
        }
      } catch (error) {
        console.error(`[NexusEditor] DOM hook failed (${entry.ownerId}, ${eventType})`, error);
      }
    }
    if (!consumed) return;
    if (event.cancelable && !event.defaultPrevented) event.preventDefault();
    if (phase === "capture") {
      // A consumed capture event cannot reach the root's native bubble
      // listener. Notify bubble-phase post-consume observers here before
      // stopping propagation; consumable bubble handlers remain skipped.
      const bubbleObservers = Array.from(this.domHooks.values())
        .filter((entry) => (
          !entry.disposed &&
          entry.event === eventType &&
          entry.phase === "bubble" &&
          entry.observeAfterConsumed &&
          (!entry.surfaces || entry.surfaces.has(surface))
        ))
        .sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
      for (const entry of bubbleObservers) {
        if (entry.disposed) continue;
        try {
          entry.handler(event as never, context);
        } catch (error) {
          console.error(`[NexusEditor] DOM hook failed (${entry.ownerId}, ${eventType})`, error);
        }
      }
      event.stopPropagation();
    }
  }

  private resolveInputTarget(element: HTMLElement | null): EditorInputTarget | null {
    if (!element) return null;
    const provided = findProvidedInputTarget(element, this.host.view.dom);
    if (provided) return provided;
    let best: InputTargetEntry | null = null;
    for (const entry of this.inputTargets.values()) {
      if (entry.disposed || !entry.root.contains(element)) continue;
      if (!best || best.root.contains(entry.root)) best = entry;
    }
    if (best) {
      const entry = best;
      return {
        ...entry.target,
        element: entry.root,
        captureSelection: (point) => {
          const captured = entry.target.captureSelection?.(point);
          if (!captured) return null;
          const lifetime = new AbortController();
          const abort = () => lifetime.abort();
          entry.lifetime.signal.addEventListener("abort", abort, { once: true });
          captured.signal?.addEventListener("abort", abort, { once: true });
          if (entry.disposed || captured.signal?.aborted) abort();
          const valid = () => !lifetime.signal.aborted && !entry.disposed &&
            this.host.view.dom.contains(entry.root) && captured.isValid();
          return {
            signal: lifetime.signal,
            isValid: valid,
            replaceSelection: (text) => valid() && captured.replaceSelection(text),
            dispose() {
              entry.lifetime.signal.removeEventListener("abort", abort);
              captured.signal?.removeEventListener("abort", abort);
              try { captured.dispose(); }
              finally { lifetime.abort(); }
            },
          };
        },
      };
    }
    if (element.closest(".nexus-table-wrapper, [data-nexus-widget]")) return null;
    if (this.host.view.contentDOM.contains(element)) {
      return {
        kind: "document",
        element: this.host.view.contentDOM,
        getSelectedText: () => this.host.editor.getSelectedText(),
        replaceSelection: (text) => {
          this.host.editor.replaceSelection(text);
          return true;
        },
      };
    }
    return null;
  }

  /** CM6 handles defaults before root bubbling; give Nexus hooks first refusal exactly once. */
  dispatchBubbleBeforeDefault(type: "paste" | "drop", event: ClipboardEvent | DragEvent): boolean {
    this.dispatchDomEvent(type, "bubble", event);
    return event.defaultPrevented;
  }

  private resolveSurface(element: HTMLElement | null): EditorInputSurface {
    if (!element) return "external";
    if (element.closest(".nexus-table-wrapper")) return "table";
    if (element.closest("[data-nexus-widget]")) return "widget";
    if (this.host.view.contentDOM.contains(element)) return "document";
    return "external";
  }

  private createDomContext(
    surface: EditorInputSurface,
    inputTarget: EditorInputTarget | null
  ): EditorDomEventHookContext {
    return {
      editor: this.host.editor,
      editorRoot: this.host.view.dom,
      surface,
      inputTarget,
      insertMarkdown: (markdown) => {
        if (inputTarget) {
          inputTarget.replaceSelection(markdown);
          return;
        }
        if (surface === "document") this.host.insertMarkdown(markdown);
      },
      replaceTargetSelection: (text) => inputTarget?.replaceSelection(text) ?? false,
      uploadAsset: (file) => this.host.uploadAsset(file),
    };
  }
}
