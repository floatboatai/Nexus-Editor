import {
  NexusComponent,
} from "@floatboat/nexus-plugin-api";
import type {
  ComponentId,
  ContributionRegistration,
  EditorContext,
  FileId,
  JsonObject,
  ManagedResource,
  MissingViewPolicy,
  NavigationOptions,
  NavigationPlacement,
  NavigationResult,
  NavigationTarget,
  NexusDiagnostic,
  NexusFile,
  NexusView,
  PluginId,
  PluginIdentity,
  RegistrationId,
  RegistrationResult,
  RegistrationState,
  ResourceOwner,
  ViewFactory,
  ViewId,
  ViewRegistrationOptions,
  ViewState,
  WindowContext,
  WindowId,
  WorkspaceContainerType,
  WorkspaceEventMap,
  WorkspaceId,
  WorkspaceLayoutNode,
  WorkspaceLeaf,
  WorkspaceLeafId,
  WorkspaceService,
} from "@floatboat/nexus-plugin-api";

import { TypedEventRegistry } from "../events/typed-event-registry";
import {
  ComponentLifecycleRuntime,
  type ComponentController,
} from "../lifecycle/component-controller";

export type WorkspaceResourceRegistrar = (resource: ManagedResource) => void;

export interface RuntimeWorkspaceWindow extends WindowContext {
  /** Compatibility aliases used by the testkit's original lightweight model. */
  readonly document: Document;
  readonly window: Window;
}

export interface RuntimeWorkspaceLeafSnapshot {
  readonly id: string;
  readonly windowId: string;
  readonly containerType: Exclude<WorkspaceContainerType, "root" | "window">;
  readonly viewState: ViewState | null;
  readonly fileId: string | null;
  readonly filePath: string | null;
  readonly editorId: string | null;
}

export interface RuntimeWorkspaceSnapshot {
  readonly schemaVersion: 1;
  readonly layout: WorkspaceLayoutNode;
  readonly leaves: readonly RuntimeWorkspaceLeafSnapshot[];
  readonly focusedLeafId: string | null;
  readonly activeLeafId: string | null;
  readonly unknown?: JsonObject;
}

export interface RuntimeWorkspaceOptions {
  readonly id?: string;
  /** File-navigation view type; hosts register its factory separately. Defaults to "markdown". */
  readonly markdownViewType?: string;
  readonly supportedContainers?: readonly WorkspaceContainerType[];
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
  readonly saveLayout?: (snapshot: RuntimeWorkspaceSnapshot) => void | Promise<void>;
  readonly defaultNavigationPlacement?: Exclude<NavigationPlacement, "default">;
  readonly missingViewPolicy?: MissingViewPolicy;
}

export type RuntimeViewRegistration = ContributionRegistration & ManagedResource;

export interface VirtualWorkspaceEventMap {
  readonly "leaf-opened": { readonly type: "leaf-opened"; readonly leaf: RuntimeWorkspaceLeaf };
  readonly "leaf-closed": { readonly type: "leaf-closed"; readonly leafId: string };
  readonly "focused-leaf-changed": {
    readonly type: "focused-leaf-changed";
    readonly leaf: RuntimeWorkspaceLeaf | null;
  };
}

export type VirtualWorkspaceEvent = VirtualWorkspaceEventMap[keyof VirtualWorkspaceEventMap];

interface ViewRegistrationEntry {
  readonly key: string;
  readonly owner: ResourceOwner;
  readonly viewType: string;
  readonly factory: ViewFactory;
  readonly priority: number;
  readonly sequence: number;
  readonly missingViewPolicy: MissingViewPolicy;
  readonly stateVersion: number;
  state: RegistrationState;
}

interface LeafCreationOptions {
  readonly windowId?: string;
  readonly id?: string;
  readonly viewType?: string | null;
  readonly viewState?: ViewState | null;
  readonly file?: NexusFile | null;
  readonly filePath?: string | null;
  readonly editor?: EditorContext | null;
  readonly editorId?: string | null;
  readonly containerType?: Exclude<WorkspaceContainerType, "root" | "window">;
}

function workspaceId(value: string): WorkspaceId {
  return value as WorkspaceId;
}

function leafId(value: string): WorkspaceLeafId {
  return value as WorkspaceLeafId;
}

function viewId(value: string): ViewId {
  return value as ViewId;
}

function windowId(value: string): WindowId {
  return value as WindowId;
}

function registrationId(value: string): RegistrationId {
  return value as RegistrationId;
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function freezeViewState(state: ViewState): ViewState {
  return Object.freeze({
    type: state.type,
    stateVersion: state.stateVersion,
    state: cloneJson(state.state),
    ...(state.ephemeralState === undefined
      ? {}
      : { ephemeralState: cloneJson(state.ephemeralState) }),
  });
}

function ownerKey(owner: ResourceOwner): string {
  return `${owner.pluginId}:${owner.componentId}`;
}

function errorCause(error: unknown): NexusDiagnostic["cause"] {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { message: String(error) };
}

function isNexusFile(value: unknown): value is NexusFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "file" &&
    "path" in value
  );
}

function editorFromView(view: NexusView | null): EditorContext | null {
  if (!view || !("editor" in view)) return null;
  const editor = (view as { readonly editor?: unknown }).editor;
  return editor && typeof editor === "object" ? editor as EditorContext : null;
}

function fileFromView(view: NexusView | null): NexusFile | null {
  if (!view || !("file" in view)) return null;
  const file = (view as { readonly file?: unknown }).file;
  return isNexusFile(file) ? file : null;
}

class PlaceholderView extends NexusComponent implements NexusView {
  readonly id: ViewId;
  readonly type: string;
  readonly containerEl: HTMLElement;
  private persistentState: JsonObject;
  private ephemeralState: JsonObject;

  constructor(
    readonly leaf: RuntimeWorkspaceLeaf,
    initialState: ViewState,
  ) {
    super();
    this.id = viewId(`placeholder:${leaf.id}`);
    this.type = initialState.type;
    this.containerEl = leaf.containerEl.ownerDocument.createElement("div");
    this.containerEl.className = "nexus-missing-view";
    this.containerEl.dataset.viewType = initialState.type;
    this.containerEl.setAttribute("role", "status");
    this.containerEl.textContent = `View '${initialState.type}' is unavailable`;
    this.persistentState = cloneJson(initialState.state);
    this.ephemeralState = cloneJson(initialState.ephemeralState ?? {});
  }

  get window(): WindowContext {
    return this.leaf.window;
  }

  getState(): JsonObject {
    return cloneJson(this.persistentState);
  }

  setState(state: JsonObject): void {
    this.persistentState = cloneJson(state);
  }

  getEphemeralState(): JsonObject {
    return cloneJson(this.ephemeralState);
  }

  setEphemeralState(state: JsonObject): void {
    this.ephemeralState = cloneJson(state);
  }

  onOpen(): void {}
  onClose(): void {}
}

export class RuntimeWorkspaceLeaf implements WorkspaceLeaf {
  private currentView: NexusView | null = null;
  private currentState: ViewState | null = null;
  private currentRegistration: ViewRegistrationEntry | null = null;
  private currentController: ComponentController | null = null;
  private currentFile: NexusFile | null = null;
  private currentEditor: EditorContext | null = null;
  private currentWindow: RuntimeWorkspaceWindow;
  private currentContainerType: Exclude<WorkspaceContainerType, "root" | "window">;

  readonly containerEl: HTMLElement;

  constructor(
    private readonly host: RuntimeWorkspace,
    readonly id: WorkspaceLeafId,
    window: RuntimeWorkspaceWindow,
    containerType: Exclude<WorkspaceContainerType, "root" | "window">,
  ) {
    this.currentWindow = window;
    this.currentContainerType = containerType;
    this.containerEl = window.ownerDocument.createElement("div");
    this.containerEl.className = "nexus-workspace-leaf";
    this.containerEl.dataset.workspaceLeafId = id;
    this.containerEl.dataset.virtualLeafId = id;
    window.ownerDocument.body.append(this.containerEl);
  }

  get window(): RuntimeWorkspaceWindow {
    return this.currentWindow;
  }

  get windowId(): string {
    return this.currentWindow.id;
  }

  get view(): NexusView | null {
    return this.currentView;
  }

  get viewType(): string | null {
    return this.currentState?.type ?? null;
  }

  get active(): boolean {
    return this.host.isActiveLeaf(this);
  }

  get filePath(): string | null {
    return this.currentFile?.path ?? this.host.getCompatibilityFilePath(this.id);
  }

  get editorId(): string | null {
    return this.currentEditor?.editorId ?? this.host.getCompatibilityEditorId(this.id);
  }

  get container(): HTMLElement {
    return this.containerEl;
  }

  get containerType(): Exclude<WorkspaceContainerType, "root" | "window"> {
    return this.currentContainerType;
  }

  get resourceFile(): NexusFile | null {
    return this.currentFile;
  }

  get editorContext(): EditorContext | null {
    return this.currentEditor;
  }

  get registration(): ViewRegistrationEntry | null {
    return this.currentRegistration;
  }

  get viewController(): ComponentController | null {
    return this.currentController;
  }

  getViewState(): ViewState | null {
    if (!this.currentState) return null;
    const state = this.currentView?.getState() ?? this.currentState.state;
    const ephemeralState = this.currentView?.getEphemeralState() ?? this.currentState.ephemeralState;
    return freezeViewState({
      type: this.currentState.type,
      stateVersion: this.currentState.stateVersion,
      state,
      ...(ephemeralState === undefined ? {} : { ephemeralState }),
    });
  }

  async setViewState(state: ViewState): Promise<void> {
    const result = await this.host.assignViewState(this, state);
    if (!result.ok) throw new Error(result.diagnostic.message);
  }

  reveal(options?: { readonly focus?: boolean }): Promise<void> {
    return this.host.revealLeaf(this, options);
  }

  setMountedView(
    view: NexusView | null,
    state: ViewState | null,
    registration: ViewRegistrationEntry | null,
    controller: ComponentController | null = null,
  ): void {
    this.currentView = view;
    this.currentState = state ? freezeViewState(state) : null;
    this.currentRegistration = registration;
    this.currentController = controller;
    const viewFile = fileFromView(view);
    if (viewFile) this.currentFile = viewFile;
    const viewEditor = editorFromView(view);
    if (viewEditor) this.currentEditor = viewEditor;
  }

  setResourceContext(file: NexusFile | null, editor: EditorContext | null): void {
    this.currentFile = file;
    this.currentEditor = editor;
  }

  setWindow(window: RuntimeWorkspaceWindow): RuntimeWorkspaceWindow {
    const previous = this.currentWindow;
    this.currentWindow = window;
    return previous;
  }

  setContainerType(type: Exclude<WorkspaceContainerType, "root" | "window">): void {
    this.currentContainerType = type;
  }
}

class ViewRegistration implements RuntimeViewRegistration {
  private disposePromise: Promise<void> | null = null;

  constructor(
    private readonly host: RuntimeWorkspace,
    private readonly entry: ViewRegistrationEntry,
  ) {}

  get id(): RegistrationId {
    return registrationId(this.entry.key);
  }

  get owner(): ResourceOwner {
    return this.entry.owner;
  }

  get state(): RegistrationState {
    return this.entry.state;
  }

  get disposed(): boolean {
    return this.entry.state === "disposed";
  }

  get localId(): string {
    return this.entry.viewType;
  }

  get globalId(): string {
    return this.entry.viewType;
  }

  get priority(): number {
    return this.entry.priority;
  }

  activate(): Promise<void> {
    if (this.entry.state !== "staged") return Promise.resolve();
    return this.host.activateViewRegistration(this.entry);
  }

  quiesce(): void {
    this.host.quiesceViewRegistration(this.entry);
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = this.host.disposeViewRegistration(this.entry);
    return this.disposePromise;
  }
}

/**
 * Host-neutral in-memory Workspace implementation. Hosts drive focus/window
 * changes through the controller methods and expose owner-bound facades to plugins.
 */
export class RuntimeWorkspace {
  readonly id: WorkspaceId;
  readonly supportedContainers: readonly WorkspaceContainerType[];

  private readonly windows = new Map<string, RuntimeWorkspaceWindow>();
  private readonly leaves = new Map<string, RuntimeWorkspaceLeaf>();
  private readonly registrations = new Map<string, ViewRegistrationEntry>();
  private readonly activeRegistrations = new Map<string, ViewRegistrationEntry>();
  private readonly compatibilityListeners = new Set<(event: VirtualWorkspaceEvent) => void>();
  private readonly compatibilityFilePaths = new Map<string, string | null>();
  private readonly compatibilityEditorIds = new Map<string, string | null>();
  private readonly eventsRegistry: TypedEventRegistry<WorkspaceEventMap>;
  private readonly lifecycle = new ComponentLifecycleRuntime();
  private readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;
  private readonly saveLayout?: RuntimeWorkspaceOptions["saveLayout"];
  private readonly defaultNavigationPlacement: Exclude<NavigationPlacement, "default">;
  private readonly markdownViewType: string;
  private readonly defaultMissingViewPolicy: MissingViewPolicy;
  private windowSequence = 0;
  private leafSequence = 0;
  private registrationSequence = 0;
  private focusedLeafId: string | null = null;
  private activeLeafId: string | null = null;
  private activeFile: NexusFile | null = null;
  private recentEditor: EditorContext | null = null;
  private layoutReady = false;
  private preservedUnknownState: JsonObject | undefined;

  constructor(
    private readonly defaultDocument: Document,
    options: RuntimeWorkspaceOptions = {},
  ) {
    this.id = workspaceId(options.id ?? "runtime-workspace");
    this.markdownViewType = options.markdownViewType ?? "markdown";
    this.supportedContainers = Object.freeze([
      ...(options.supportedContainers ?? ["root", "tab", "split", "sidebar", "window"]),
    ]);
    this.reportDiagnostic = options.reportDiagnostic ?? (() => undefined);
    this.saveLayout = options.saveLayout;
    this.defaultNavigationPlacement = options.defaultNavigationPlacement ?? "reuse";
    this.defaultMissingViewPolicy = options.missingViewPolicy ?? "placeholder";
    this.eventsRegistry = new TypedEventRegistry<WorkspaceEventMap>({
      serviceId: `${this.id}.events`,
      events: {
        layoutReady: null,
        layoutChanged: null,
        focusedLeafChanged: null,
        activeViewChanged: null,
        activeFileChanged: null,
        recentEditorChanged: null,
        leafOpened: null,
        leafClosed: null,
        windowContextChanged: null,
      },
      reportDiagnostic: this.reportDiagnostic,
    });
  }

  createService(owner: ResourceOwner, registerResource: WorkspaceResourceRegistrar): WorkspaceService {
    return {
      id: this.id,
      supportedContainers: this.supportedContainers,
      events: this.eventsRegistry.createEvents(owner, registerResource),
      isLayoutReady: () => this.isLayoutReady(),
      getLayout: () => this.getLayout(),
      requestSaveLayout: () => this.requestSaveLayout(),
      getLeaves: () => this.getLeaves(),
      getLeavesOfType: (viewType) => this.getLeavesOfType(viewType),
      getFocusedLeaf: () => this.getFocusedLeaf(),
      getActiveView: () => this.getActiveView(),
      getActiveFile: () => this.getActiveFile(),
      getRecentEditor: () => this.getRecentEditor(),
      registerView: (viewType, factory, options) => {
        const result = this.registerView(owner, viewType, factory, options);
        if (result.ok) {
          try {
            registerResource(result.registration);
          } catch (error) {
            void result.registration.dispose();
            throw error;
          }
        }
        return result;
      },
      navigate: (target, options) => this.navigate(target, options),
      closeLeaf: (leaf) => this.closeLeaf(leaf),
      revealLeaf: (leaf, options) => this.revealLeaf(leaf, options),
    };
  }

  createWindow(
    document = this.defaultDocument,
    id = `window:${++this.windowSequence}`,
  ): RuntimeWorkspaceWindow {
    if (this.windows.has(id)) throw new Error(`Runtime workspace window '${id}' already exists`);
    const ownerWindow = document.defaultView;
    if (!ownerWindow) throw new Error("Runtime workspace document has no defaultView");
    const context = Object.freeze({
      id: windowId(id),
      ownerDocument: document,
      ownerWindow,
      document,
      window: ownerWindow,
    });
    this.windows.set(id, context);
    return context;
  }

  getWindows(): readonly RuntimeWorkspaceWindow[] {
    return [...this.windows.values()];
  }

  createLeaf(options: LeafCreationOptions = {}): RuntimeWorkspaceLeaf {
    const window = options.windowId
      ? this.windows.get(options.windowId)
      : this.windows.values().next().value as RuntimeWorkspaceWindow | undefined;
    if (!window) throw new RangeError("Runtime workspace needs a window before creating a leaf");
    const id = options.id ?? `leaf:${++this.leafSequence}`;
    if (this.leaves.has(id)) throw new Error(`Runtime workspace leaf '${id}' already exists`);
    const leaf = new RuntimeWorkspaceLeaf(
      this,
      leafId(id),
      window,
      options.containerType ?? "tab",
    );
    leaf.setResourceContext(options.file ?? null, options.editor ?? null);
    this.compatibilityFilePaths.set(id, options.filePath ?? options.file?.path ?? null);
    this.compatibilityEditorIds.set(id, options.editorId ?? options.editor?.editorId ?? null);
    this.leaves.set(id, leaf);
    this.emitCompatibility({ type: "leaf-opened", leaf });
    this.eventsRegistry.emit("leafOpened", { leaf });
    this.emitLayoutChanged();

    const initial = options.viewState ?? (options.viewType
      ? { type: options.viewType, stateVersion: 1, state: {} }
      : null);
    if (initial) {
      void this.assignViewState(leaf, initial);
    }
    return leaf;
  }

  registerView(
    owner: ResourceOwner,
    viewType: string,
    factory: ViewFactory,
    options: ViewRegistrationOptions = {},
  ): RegistrationResult<RuntimeViewRegistration> {
    const normalized = viewType.trim();
    if (!normalized || !normalized.startsWith(`${owner.pluginId}:`)) {
      return {
        ok: false,
        diagnostic: this.diagnostic(
          "registration-conflict",
          `View type '${viewType}' must be namespaced by plugin '${owner.pluginId}:'`,
          owner,
          viewType,
        ),
      };
    }
    if (this.registrations.has(normalized)) {
      return {
        ok: false,
        diagnostic: this.diagnostic(
          "registration-conflict",
          `View type '${normalized}' is already registered`,
          owner,
          normalized,
        ),
      };
    }
    const sequence = ++this.registrationSequence;
    const entry: ViewRegistrationEntry = {
      key: `workspace:view:${normalized}:${sequence}`,
      owner,
      viewType: normalized,
      factory,
      priority: 0,
      sequence,
      missingViewPolicy: options.missingViewPolicy ?? this.defaultMissingViewPolicy,
      stateVersion: options.stateVersion ?? 1,
      state: "staged",
    };
    this.registrations.set(normalized, entry);
    return { ok: true, registration: new ViewRegistration(this, entry) };
  }

  async activateViewRegistration(entry: ViewRegistrationEntry): Promise<void> {
    if (entry.state !== "staged") return;
    if (this.registrations.get(entry.viewType) !== entry) {
      throw new Error(`View registration '${entry.viewType}' lost its reservation`);
    }
    entry.state = "active";
    this.activeRegistrations.set(entry.viewType, entry);
    await this.recoverMissingViews(entry.viewType);
  }

  quiesceViewRegistration(entry: ViewRegistrationEntry): void {
    if (entry.state !== "staged" && entry.state !== "active") return;
    entry.state = "quiescing";
    if (this.activeRegistrations.get(entry.viewType) === entry) {
      this.activeRegistrations.delete(entry.viewType);
    }
  }

  async disposeViewRegistration(entry: ViewRegistrationEntry): Promise<void> {
    if (entry.state === "disposed") return;
    this.quiesceViewRegistration(entry);
    const affected = [...this.leaves.values()].filter((leaf) => leaf.registration === entry);
    for (const leaf of affected) {
      try {
        if (entry.missingViewPolicy === "close") {
          await this.closeLeaf(leaf);
        } else {
          const state = leaf.getViewState();
          await this.unmountView(leaf);
          if (state) await this.mountPlaceholder(leaf, state);
        }
      } catch (error) {
        this.diagnostic(
          "lifecycle-cleanup-failed",
          `Failed to clean view '${entry.viewType}' from leaf '${leaf.id}'`,
          entry.owner,
          String(leaf.id),
          error,
        );
      }
    }
    entry.state = "disposed";
    this.activeRegistrations.delete(entry.viewType);
    if (this.registrations.get(entry.viewType) === entry) {
      this.registrations.delete(entry.viewType);
    }
  }

  isLayoutReady(): boolean {
    return this.layoutReady;
  }

  markLayoutReady(): void {
    if (this.layoutReady) return;
    this.layoutReady = true;
    this.eventsRegistry.emit("layoutReady", { workspaceId: this.id });
  }

  getLayout(): WorkspaceLayoutNode {
    const windowNodes = [...this.windows.values()].map((window) => {
      const leaves = [...this.leaves.values()].filter((leaf) => leaf.windowId === window.id);
      const children = leaves.map((leaf) => Object.freeze({
        id: `container:${leaf.id}`,
        type: leaf.containerType,
        stateVersion: 1,
        state: {},
        leafIds: Object.freeze([leaf.id]),
        children: Object.freeze([]),
      } satisfies WorkspaceLayoutNode));
      return Object.freeze({
        id: `window-node:${window.id}`,
        type: "window" as const,
        stateVersion: 1,
        state: {},
        leafIds: Object.freeze(leaves.map((leaf) => leaf.id)),
        children: Object.freeze(children),
      } satisfies WorkspaceLayoutNode);
    });
    return Object.freeze({
      id: "root",
      type: "root",
      stateVersion: 1,
      state: {},
      leafIds: Object.freeze([...this.leaves.values()].map((leaf) => leaf.id)),
      children: Object.freeze(windowNodes),
    });
  }

  async requestSaveLayout(): Promise<void> {
    await this.saveLayout?.(this.createSnapshot());
  }

  createSnapshot(): RuntimeWorkspaceSnapshot {
    return Object.freeze({
      schemaVersion: 1 as const,
      layout: this.getLayout(),
      leaves: Object.freeze([...this.leaves.values()].map((leaf) => {
        const state = leaf.getViewState();
        return Object.freeze({
          id: leaf.id,
          windowId: leaf.windowId,
          containerType: leaf.containerType,
          viewState: state
            ? freezeViewState({
                type: state.type,
                stateVersion: state.stateVersion,
                state: state.state,
              })
            : null,
          fileId: leaf.resourceFile?.id ?? null,
          filePath: leaf.filePath,
          editorId: leaf.editorId,
        });
      })),
      focusedLeafId: this.focusedLeafId,
      activeLeafId: this.activeLeafId,
      ...(this.preservedUnknownState ? { unknown: cloneJson(this.preservedUnknownState) } : {}),
    });
  }

  async restoreSnapshot(
    snapshot: RuntimeWorkspaceSnapshot,
    options: {
      readonly resolveFile?: (id: FileId | null, path: string | null) => NexusFile | null;
      readonly resolveEditor?: (id: string | null) => EditorContext | null;
    } = {},
  ): Promise<void> {
    if (snapshot.schemaVersion !== 1) {
      throw new RangeError(`Unsupported workspace snapshot version '${snapshot.schemaVersion}'`);
    }
    for (const leaf of [...this.leaves.values()]) await this.closeLeaf(leaf);
    this.preservedUnknownState = snapshot.unknown ? cloneJson(snapshot.unknown) : undefined;
    // Empty windows have no leaf record from which to recover their identity.
    const restoreWindows = (node: WorkspaceLayoutNode): void => {
      if (node.type === "window" && node.id.startsWith("window-node:")) {
        const id = node.id.slice("window-node:".length);
        if (!this.windows.has(id)) this.createWindow(this.defaultDocument, id);
      }
      for (const child of node.children) restoreWindows(child);
    };
    restoreWindows(snapshot.layout);
    for (const item of snapshot.leaves) {
      if (!this.windows.has(item.windowId)) this.createWindow(this.defaultDocument, item.windowId);
      const leaf = this.createLeaf({
        id: item.id,
        windowId: item.windowId,
        containerType: item.containerType,
        file: options.resolveFile?.(item.fileId as FileId | null, item.filePath) ?? null,
        filePath: item.filePath,
        editor: options.resolveEditor?.(item.editorId) ?? null,
        editorId: item.editorId,
      });
      if (item.viewState) {
        const persistentOnly: ViewState = {
          type: item.viewState.type,
          stateVersion: item.viewState.stateVersion,
          state: cloneJson(item.viewState.state),
        };
        const result = await this.assignViewState(leaf, persistentOnly);
        if (!result.ok) await this.mountPlaceholder(leaf, persistentOnly);
      }
    }
    if (snapshot.activeLeafId && this.leaves.has(snapshot.activeLeafId)) {
      this.setActiveLeaf(snapshot.activeLeafId, false);
    }
    if (snapshot.focusedLeafId && this.leaves.has(snapshot.focusedLeafId)) {
      this.focusLeaf(snapshot.focusedLeafId);
    }
    this.markLayoutReady();
  }

  async recoverMissingViews(viewType?: string): Promise<void> {
    const leaves = [...this.leaves.values()].filter((leaf) =>
      leaf.registration === null &&
      leaf.view instanceof PlaceholderView &&
      (!viewType || leaf.viewType === viewType),
    );
    for (const leaf of leaves) {
      const state = leaf.getViewState();
      if (!state || !this.activeRegistrations.has(state.type)) continue;
      await this.assignViewState(leaf, state);
    }
  }

  getLeaves(): readonly RuntimeWorkspaceLeaf[] {
    return [...this.leaves.values()];
  }

  getLeavesOfType(viewType: string): readonly RuntimeWorkspaceLeaf[] {
    return [...this.leaves.values()].filter((leaf) => leaf.viewType === viewType);
  }

  getFocusedLeaf(): RuntimeWorkspaceLeaf | null {
    return this.focusedLeafId ? this.leaves.get(this.focusedLeafId) ?? null : null;
  }

  getActiveView(): NexusView | null {
    return this.activeLeafId ? this.leaves.get(this.activeLeafId)?.view ?? null : null;
  }

  getActiveFile(): NexusFile | null {
    return this.activeFile;
  }

  getRecentEditor(): EditorContext | null {
    return this.recentEditor;
  }

  setActiveFile(file: NexusFile | null): void {
    if (this.activeFile === file) return;
    this.activeFile = file;
    this.eventsRegistry.emit("activeFileChanged", { file });
  }

  setRecentEditor(editor: EditorContext | null): void {
    if (this.recentEditor === editor) return;
    this.recentEditor = editor;
    this.eventsRegistry.emit("recentEditorChanged", { editor });
  }

  focusLeaf(id: string | null): void {
    const leaf = id === null ? null : this.leaves.get(id);
    if (id !== null && !leaf) throw new RangeError(`Unknown runtime workspace leaf '${id}'`);
    if (this.focusedLeafId === id) return;
    this.focusedLeafId = id;
    this.emitCompatibility({ type: "focused-leaf-changed", leaf: leaf ?? null });
    this.eventsRegistry.emit("focusedLeafChanged", { leaf: leaf ?? null });
    if (leaf) this.setActiveLeaf(id, true);
  }

  setActiveLeaf(id: string | null, updateDerived = true): void {
    const leaf = id === null ? null : this.leaves.get(id);
    if (id !== null && !leaf) throw new RangeError(`Unknown runtime workspace leaf '${id}'`);
    const previousView = this.getActiveView();
    this.activeLeafId = id;
    const nextView = leaf?.view ?? null;
    if (previousView !== nextView) this.eventsRegistry.emit("activeViewChanged", { view: nextView });
    if (!updateDerived || !leaf) return;
    const file = fileFromView(nextView) ?? leaf.resourceFile;
    if (file) this.setActiveFile(file);
    const editor = editorFromView(nextView) ?? leaf.editorContext;
    if (editor) this.setRecentEditor(editor);
  }

  isActiveLeaf(leaf: RuntimeWorkspaceLeaf): boolean {
    return this.activeLeafId === leaf.id;
  }

  async navigate(
    target: NavigationTarget,
    options: NavigationOptions = {},
  ): Promise<NavigationResult> {
    if (target.kind === "url") {
      return {
        ok: false,
        diagnostic: this.diagnostic(
          "unsupported-operation",
          "URL navigation belongs to the host UI policy and is not implemented by Workspace",
          undefined,
          target.url,
        ),
      };
    }
    const requested = options.placement ?? "default";
    let placement = requested === "default" ? this.defaultNavigationPlacement : requested;
    if (!this.supportsPlacement(placement)) {
      if (options.fallback && this.supportsPlacement(options.fallback)) {
        placement = options.fallback;
      } else {
        return {
          ok: false,
          diagnostic: this.diagnostic(
            "platform-unsupported",
            `Workspace placement '${placement}' is not supported`,
            undefined,
            placement,
          ),
        };
      }
    }

    let leaf: RuntimeWorkspaceLeaf;
    if (placement === "reuse" && this.getFocusedLeaf()) {
      leaf = this.getFocusedLeaf()!;
    } else {
      let targetWindow = this.getFocusedLeaf()?.window ?? this.windows.values().next().value;
      if (placement === "window") targetWindow = this.createWindow(this.defaultDocument);
      if (!targetWindow) targetWindow = this.createWindow(this.defaultDocument);
      leaf = this.createLeaf({
        windowId: targetWindow.id,
        containerType: placement === "split" ? "split" : "tab",
      });
      if (placement === "reuse") placement = "new-tab";
    }

    const state: ViewState = target.kind === "view"
      ? {
          ...target.state,
          ...(options.ephemeralState === undefined
            ? {}
            : { ephemeralState: options.ephemeralState }),
        }
      : {
          type: this.markdownViewType,
          stateVersion: 1,
          state: { path: target.file.path },
          ...(options.ephemeralState === undefined
            ? {}
            : { ephemeralState: options.ephemeralState }),
        };
    if (target.kind === "file") leaf.setResourceContext(target.file, null);
    const mounted = await this.assignViewState(leaf, state);
    if (!mounted.ok) return mounted;

    if (options.reveal) await this.revealLeaf(leaf, { focus: false });
    if (options.active ?? true) this.setActiveLeaf(leaf.id);
    if (options.focus ?? (options.active ?? true)) this.focusLeaf(leaf.id);
    return { ok: true, value: { leaf, placement } };
  }

  async closeLeaf(leafOrId: WorkspaceLeaf | string): Promise<void> {
    const id = typeof leafOrId === "string" ? leafOrId : leafOrId.id;
    const leaf = this.leaves.get(id);
    if (!leaf) return;
    await this.unmountView(leaf);
    this.leaves.delete(id);
    this.compatibilityFilePaths.delete(id);
    this.compatibilityEditorIds.delete(id);
    leaf.containerEl.remove();
    if (this.focusedLeafId === id) {
      this.focusedLeafId = null;
      this.emitCompatibility({ type: "focused-leaf-changed", leaf: null });
      this.eventsRegistry.emit("focusedLeafChanged", { leaf: null });
    }
    if (this.activeLeafId === id) {
      this.activeLeafId = null;
      this.eventsRegistry.emit("activeViewChanged", { view: null });
    }
    this.emitCompatibility({ type: "leaf-closed", leafId: id });
    this.eventsRegistry.emit("leafClosed", { leafId: leaf.id });
    this.emitLayoutChanged();
  }

  async revealLeaf(leaf: WorkspaceLeaf, options: { readonly focus?: boolean } = {}): Promise<void> {
    const current = this.leaves.get(leaf.id);
    if (!current) throw new RangeError(`Unknown runtime workspace leaf '${leaf.id}'`);
    current.containerEl.hidden = false;
    if (current.view === null && current.getViewState()) {
      const result = await this.assignViewState(current, current.getViewState()!);
      if (!result.ok) throw new Error(result.diagnostic.message);
    }
    if (options.focus) {
      this.setActiveLeaf(current.id);
      this.focusLeaf(current.id);
      const target = current.view?.containerEl ?? current.containerEl;
      if (target.tabIndex < 0) target.tabIndex = -1;
      target.focus();
    }
  }

  async moveLeafToWindow(leafOrId: WorkspaceLeaf | string, target: RuntimeWorkspaceWindow): Promise<void> {
    const id = typeof leafOrId === "string" ? leafOrId : leafOrId.id;
    const leaf = this.leaves.get(id);
    if (!leaf) throw new RangeError(`Unknown runtime workspace leaf '${id}'`);
    if (this.windows.get(target.id) !== target) {
      throw new RangeError(`Unknown runtime workspace window '${target.id}'`);
    }
    const previous = leaf.setWindow(target);
    if (previous === target) return;
    target.ownerDocument.body.append(leaf.containerEl);
    await leaf.view?.onWindowContextChanged?.(previous, target);
    this.eventsRegistry.emit("windowContextChanged", { leaf, previous, current: target });
    this.emitLayoutChanged();
  }

  subscribe(listener: (event: VirtualWorkspaceEvent) => void): () => void {
    this.compatibilityListeners.add(listener);
    return () => this.compatibilityListeners.delete(listener);
  }

  async assignViewState(
    leaf: RuntimeWorkspaceLeaf,
    requested: ViewState,
  ): Promise<{ readonly ok: true; readonly leaf: RuntimeWorkspaceLeaf } | { readonly ok: false; readonly diagnostic: NexusDiagnostic }> {
    if (this.leaves.get(leaf.id) !== leaf) {
      return {
        ok: false,
        diagnostic: this.diagnostic(
          "file-invalid-reference",
          `Leaf '${leaf.id}' does not belong to this workspace`,
          undefined,
          String(leaf.id),
        ),
      };
    }
    const state = freezeViewState(requested);
    const registration = this.activeRegistrations.get(state.type) ?? null;
    await this.unmountView(leaf);
    if (!registration) {
      await this.mountPlaceholder(leaf, state);
      return { ok: true, leaf };
    }

    let view: NexusView | null = null;
    let controller: ComponentController | null = null;
    let openStarted = false;
    try {
      view = await registration.factory(leaf, state);
      if (view.leaf !== leaf) throw new TypeError("View factory returned a view bound to another leaf");
      if (view.type !== state.type) throw new TypeError("View factory returned a mismatched view type");
      if (view.containerEl.ownerDocument !== leaf.window.ownerDocument) {
        throw new TypeError("View container must belong to the target leaf ownerDocument");
      }
      if (view.containerEl !== leaf.containerEl && !leaf.containerEl.contains(view.containerEl)) {
        leaf.containerEl.append(view.containerEl);
      }
      const identity: PluginIdentity = Object.freeze({
        id: registration.owner.pluginId,
        name: registration.owner.pluginId,
        version: "unknown",
        source: Object.freeze({
          kind: "development",
          locator: `runtime:${registration.owner.pluginId}`,
        }),
      });
      controller = this.lifecycle.manageOwned(view, identity, {
        pluginId: registration.owner.pluginId,
        componentId: `${registration.owner.componentId}/view:${leaf.id}` as ComponentId,
      });
      await controller.load();
      await view.setState(cloneJson(state.state));
      view.setEphemeralState(cloneJson(state.ephemeralState ?? {}));
      openStarted = true;
      await view.onOpen();
      leaf.setMountedView(view, state, registration, controller);
      this.refreshDerivedForLeaf(leaf);
      return { ok: true, leaf };
    } catch (error) {
      if (view) {
        try {
          if (openStarted) await view.onClose();
        } catch (cleanupError) {
          this.diagnostic(
            "lifecycle-cleanup-failed",
            `Failed to close partially initialized view '${state.type}'`,
            registration.owner,
            state.type,
            cleanupError,
          );
        }
        try {
          if (controller) await controller.unload();
        } catch (cleanupError) {
          this.diagnostic(
            "lifecycle-cleanup-failed",
            `Failed to unload partially initialized view '${state.type}'`,
            registration.owner,
            state.type,
            cleanupError,
          );
        }
        if (view.containerEl !== leaf.containerEl) view.containerEl.remove();
      }
      const diagnostic = this.diagnostic(
        "callback-failed",
        `View factory or onOpen failed for '${state.type}'`,
        registration.owner,
        state.type,
        error,
      );
      await this.mountPlaceholder(leaf, state);
      return { ok: false, diagnostic };
    }
  }

  getCompatibilityFilePath(id: WorkspaceLeafId): string | null {
    return this.compatibilityFilePaths.get(id) ?? null;
  }

  getCompatibilityEditorId(id: WorkspaceLeafId): string | null {
    return this.compatibilityEditorIds.get(id) ?? null;
  }

  private async mountPlaceholder(leaf: RuntimeWorkspaceLeaf, state: ViewState): Promise<void> {
    const placeholder = new PlaceholderView(leaf, state);
    leaf.containerEl.append(placeholder.containerEl);
    await placeholder.onOpen();
    leaf.setMountedView(placeholder, state, null);
    this.refreshDerivedForLeaf(leaf);
  }

  private async unmountView(leaf: RuntimeWorkspaceLeaf): Promise<void> {
    const view = leaf.view;
    if (!view) return;
    const controller = leaf.viewController;
    const registration = leaf.registration;
    const preserved = leaf.getViewState();
    leaf.setMountedView(null, preserved, null);
    try {
      await view.onClose();
    } catch (error) {
      this.diagnostic(
        "callback-failed",
        `View onClose failed for '${view.type}'`,
        registration?.owner,
        String(view.id),
        error,
      );
    }
    try {
      await controller?.unload();
    } catch (error) {
      this.diagnostic(
        "lifecycle-cleanup-failed",
        `View component cleanup failed for '${view.type}'`,
        registration?.owner,
        String(view.id),
        error,
      );
    } finally {
      if (view.containerEl !== leaf.containerEl) view.containerEl.remove();
    }
  }

  private refreshDerivedForLeaf(leaf: RuntimeWorkspaceLeaf): void {
    if (this.activeLeafId !== leaf.id) return;
    this.eventsRegistry.emit("activeViewChanged", { view: leaf.view });
    const file = fileFromView(leaf.view) ?? leaf.resourceFile;
    if (file) this.setActiveFile(file);
    const editor = editorFromView(leaf.view) ?? leaf.editorContext;
    if (editor) this.setRecentEditor(editor);
  }

  private supportsPlacement(placement: Exclude<NavigationPlacement, "default">): boolean {
    if (placement === "reuse" || placement === "new-tab") return this.supportedContainers.includes("tab");
    return this.supportedContainers.includes(placement);
  }

  private emitLayoutChanged(): void {
    this.eventsRegistry.emit("layoutChanged", { layout: this.getLayout() });
  }

  private emitCompatibility(event: VirtualWorkspaceEvent): void {
    for (const listener of [...this.compatibilityListeners]) listener(event);
  }

  private diagnostic(
    code: NexusDiagnostic["code"],
    message: string,
    owner?: ResourceOwner,
    resourceId?: string,
    error?: unknown,
  ): NexusDiagnostic {
    const diagnostic: NexusDiagnostic = {
      code,
      severity: "error",
      phase: code === "callback-failed" ? "callback" : "runtime",
      message,
      ...(owner ? { plugin: { id: owner.pluginId, version: "unknown" } } : {}),
      ...(resourceId ? { resourceId } : {}),
      ...(error === undefined ? {} : { cause: errorCause(error) }),
    };
    this.reportDiagnostic(diagnostic);
    return diagnostic;
  }
}

export function createRuntimeOwner(plugin: string, component = `${plugin}/root`): ResourceOwner {
  return {
    pluginId: plugin as PluginId,
    componentId: component as ComponentId,
  };
}
