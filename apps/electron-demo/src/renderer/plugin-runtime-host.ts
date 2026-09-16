/// <reference path="../../../../packages/plugin-runtime/src/content/js-yaml.d.ts" />

import type { EditorAPI } from "@floatboat/nexus-core";
import {
  COMMANDS_CAPABILITY,
  EDITOR_CLIPBOARD_CAPABILITY,
  EDITOR_HOST_CAPABILITY,
  EDITOR_TRANSACTIONS_CAPABILITY,
  FILE_MANAGER_CAPABILITY,
  HOTKEYS_CAPABILITY,
  MARKDOWN_PROCESSORS_CAPABILITY,
  METADATA_CAPABILITY,
  PLUGIN_STORAGE_CAPABILITY,
  RESOURCES_CAPABILITY,
  SCOPES_CAPABILITY,
  UI_CAPABILITY,
  VAULT_CAPABILITY,
  WORKSPACE_CAPABILITY,
  type AuthorPluginManifest,
  type ComponentId,
  type ContentVersion,
  type ContentWriteResult,
  type EditorId,
  type FileManagerService,
  type FileOperationOrigin,
  type ManagedResource,
  type NexusAbstractFile,
  type NexusDiagnostic,
  type NexusFile,
  type NexusFolder,
  type NexusHostIdentity,
  type NexusPluginBase,
  type NexusPluginConstructor,
  type NormalizedPluginManifest,
  type OperationId,
  type PluginId,
  type RegistrationId,
  type RegistrationState,
  type ResourceOwner,
  type ResourceService,
  type ResourceUrlRegistration,
  type SemanticVersion,
  type ServiceResult,
  type UiActionContext,
  type UiPolicyService,
  type UiService,
  type UiSlot,
  type VaultPath,
  type VaultService,
} from "@floatboat/nexus-plugin-api";
import {
  CommandRegistry,
  ClipboardPipeline,
  DiagnosticBus,
  EditorHostRegistry,
  EditorTransactionPipeline,
  HostControlledPluginEntrypointLoader,
  HotkeyRegistry,
  MarkdownPostProcessorRegistry,
  MemoryFileManagerRuntime,
  MemoryMetadataRuntime,
  MemoryVaultRuntime,
  PluginCompatibilityValidator,
  PluginManager,
  PluginStorageRuntime,
  RemarkTransformRegistry,
  RuntimeCapabilityRegistry,
  RuntimeUiHost,
  RuntimeWorkspace,
  ScopeRegistry,
  TrustedPluginPackageLoader,
  UnsupportedSecretStorage,
  WidgetRegistry,
  normalizeVaultPath,
  type CapabilityProviderRegistration,
  type EditorHostAttachment,
  type HostPluginEntrypointResolver,
  type HostVaultChange,
  type PermissionDecisions,
  type PluginDiscoveryResult,
  type PluginEnableResult,
  type PluginStorageBackend,
  type PluginStorageBackendReadResult,
  type PluginStorageBackendWriteResult,
  type RuntimeUiHostOptions,
  type RuntimeWorkspaceLeaf,
  type RuntimeWorkspaceWindow,
  type TrustedPluginPackageCandidate,
  type UiSlotContext,
} from "@floatboat/nexus-plugin-runtime";

import type {
  IpcContentVersion,
  PluginHostBridge,
  PluginHostPermissionId,
  PluginIpcEventContract,
  PluginVaultChangeEvent,
  PluginVaultNode,
  PluginVaultSession,
} from "../shared/plugin-ipc";
import { MetadataLinkIndex } from "./link-index";

const DEFAULT_HOST = Object.freeze({
  id: "nexus-electron-demo",
  name: "Nexus Editor",
  version: "0.0.13",
  platform: "desktop",
} satisfies NexusHostIdentity);

const DEFAULT_API_VERSION = "1.0.0";
const PRIMARY_EDITOR_ID = "electron-primary-editor" as EditorId;

export type PluginRuntimeEntrypoint =
  | NexusPluginConstructor
  | { readonly default: NexusPluginConstructor };

export type PluginRuntimeEntrypointMap = Readonly<Record<string, PluginRuntimeEntrypoint>>;

export type PluginRuntimeSlot = HTMLElement | UiSlotContext;

export interface PluginRuntimeHostOptions {
  readonly bridge: PluginHostBridge;
  readonly document: Document;
  readonly slots?: Partial<Record<UiSlot, PluginRuntimeSlot>>;
  readonly entrypoints?: PluginRuntimeEntrypointMap;
  readonly host?: NexusHostIdentity;
  readonly apiVersion?: SemanticVersion;
  readonly windowId?: string;
  readonly workspaceId?: string;
  readonly platform?: "macos" | "windows" | "linux";
  readonly permissionDecisions?: (
    manifest: NormalizedPluginManifest,
  ) => PermissionDecisions;
  readonly confirmDangerousAction?: RuntimeUiHostOptions["confirmDangerousAction"];
  readonly destroyEditor?: () => void | Promise<void>;
  readonly onShutdownRequested?: (
    event: PluginIpcEventContract["nexus:host:shutdown"],
  ) => void | Promise<void>;
}

export interface PluginRuntimeShutdownOptions {
  readonly destroyEditor?: () => void | Promise<void>;
  /** Boot rollback disposes renderer resources without acknowledging a window close. */
  readonly notifyHost?: boolean;
}

export interface PluginRuntimeProductContent {
  list(): readonly PluginVaultNode[];
  read(path: string): Promise<{ readonly path: string; readonly content: string }>;
  write(path: string, content: string): Promise<{ readonly path: string }>;
  createFile(path: string): Promise<{ readonly path: string }>;
  createFolder(path: string): Promise<{ readonly path: string }>;
  rename(path: string, destination: string): Promise<{ readonly path: string }>;
  trash(path: string): Promise<{ readonly ok: true }>;
  onChanged(listener: () => void): () => void;
}

export interface BundledPluginOptions {
  readonly sourceLocator?: string;
  readonly entrypoint?: PluginRuntimeEntrypoint;
}

interface PreparedVaultMirror {
  readonly vault: MemoryVaultRuntime;
  readonly metadata: MemoryMetadataRuntime;
  readonly versions: ReadonlyMap<string, IpcContentVersion>;
}

interface VaultMutationContext {
  readonly session: PluginVaultSession;
  readonly vault: MemoryVaultRuntime;
}

export interface PluginRuntimeHost {
  readonly capabilities: RuntimeCapabilityRegistry;
  readonly pluginManager: PluginManager;
  readonly diagnostics: DiagnosticBus;
  readonly editorHost: EditorHostRegistry;
  readonly clipboard: ClipboardPipeline;
  readonly workspace: RuntimeWorkspace;
  readonly windowContext: RuntimeWorkspaceWindow;
  readonly leaf: RuntimeWorkspaceLeaf;
  readonly ui: RuntimeUiHost;
  readonly commands: CommandRegistry;
  readonly hotkeys: HotkeyRegistry;
  readonly scopes: ScopeRegistry;
  readonly markdownPostProcessors: MarkdownPostProcessorRegistry;
  readonly remarkTransforms: RemarkTransformRegistry;
  readonly widgets: WidgetRegistry;
  readonly storage: PluginStorageRuntime;
  readonly secrets: UnsupportedSecretStorage;
  readonly session: PluginVaultSession | null;
  readonly vault: MemoryVaultRuntime;
  readonly metadata: MemoryMetadataRuntime;
  readonly linkIndex: MetadataLinkIndex;
  readonly productContent: PluginRuntimeProductContent;
  readonly dispatching: boolean;
  pickSession(): Promise<PluginVaultSession | null>;
  restoreSession(): Promise<PluginVaultSession | null>;
  attachEditor(editor: EditorAPI, root: HTMLElement): Promise<EditorHostAttachment>;
  setActiveFile(path: string | null): Promise<NexusFile | null>;
  discoverBundledPlugin(
    manifest: AuthorPluginManifest,
    options?: BundledPluginOptions | PluginRuntimeEntrypoint,
  ): PluginDiscoveryResult;
  enableBundledPlugin(
    manifest: AuthorPluginManifest,
    options?: BundledPluginOptions | PluginRuntimeEntrypoint,
  ): Promise<PluginEnableResult>;
  shutdown(options?: PluginRuntimeShutdownOptions): Promise<void>;
}

function isEntrypoint(value: unknown): value is PluginRuntimeEntrypoint {
  return typeof value === "function" ||
    (typeof value === "object" && value !== null && typeof Reflect.get(value, "default") === "function");
}

function asEntrypointModule(value: PluginRuntimeEntrypoint): { readonly default: NexusPluginConstructor } {
  return typeof value === "function" ? Object.freeze({ default: value }) : value;
}

function asOperationId(value: string): OperationId {
  return value as OperationId;
}

function asRegistrationId(value: string): RegistrationId {
  return value as RegistrationId;
}

function failure(
  code: NexusDiagnostic["code"],
  message: string,
  cause?: unknown,
  details?: NexusDiagnostic["details"],
): NexusDiagnostic {
  return Object.freeze({
    code,
    severity: "error",
    phase: "runtime",
    message,
    ...(cause === undefined
      ? {}
      : {
          cause: cause instanceof Error
            ? { name: cause.name, message: cause.message }
            : { message: String(cause) },
        }),
    ...(details === undefined ? {} : { details }),
  });
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index + 1);
}

function stemOf(name: string): string {
  const extension = extensionOf(name);
  return extension ? name.slice(0, -(extension.length + 1)) : name;
}

function escapeLinkPart(value: string): string {
  return value.replace(/([\\|\]#^])/g, "\\$1");
}

function normalizeComparableLink(target: string): string {
  return target.replace(/\\/g, "/").replace(/\.md$/i, "").toLocaleLowerCase();
}

function rewriteWikiLinks(source: string, oldPath: string, newPath: string): string {
  const oldWithoutExtension = oldPath.replace(/\.md$/i, "");
  const oldBasename = stemOf(oldPath.slice(oldPath.lastIndexOf("/") + 1));
  const replacement = newPath.replace(/\.md$/i, "");
  return source.replace(
    /(?<!\\)(!?)\[\[([^\[\]\n|]+?)(\|[^\[\]\n]+?)?\]\]/g,
    (whole, embed: string, rawTarget: string, alias: string | undefined) => {
      const anchorIndex = rawTarget.search(/[#^]/);
      const pathPart = (anchorIndex < 0 ? rawTarget : rawTarget.slice(0, anchorIndex)).trim();
      const anchor = anchorIndex < 0 ? "" : rawTarget.slice(anchorIndex);
      const comparable = normalizeComparableLink(pathPart);
      if (
        comparable !== normalizeComparableLink(oldPath) &&
        comparable !== normalizeComparableLink(oldWithoutExtension) &&
        comparable !== normalizeComparableLink(oldBasename)
      ) return whole;
      return `${embed}[[${replacement}${anchor}${alias ?? ""}]]`;
    },
  );
}

function collectFolderPaths(nodes: readonly PluginVaultNode[], target = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.kind === "folder" && node.path) target.add(node.path);
    if (node.children) collectFolderPaths(node.children, target);
  }
  return target;
}

class IpcPluginStorageBackend implements PluginStorageBackend {
  constructor(private readonly bridge: PluginHostBridge["storage"]) {}

  async read(pluginId: PluginId): Promise<PluginStorageBackendReadResult> {
    const snapshot = await this.bridge.load(pluginId);
    if (!snapshot.found) return { status: "missing" };
    if (typeof snapshot.data !== "string") {
      return {
        status: "corrupt",
        raw: JSON.stringify(snapshot.data),
        version: String(snapshot.revision),
      };
    }
    return {
      status: "available",
      serialized: snapshot.data,
      version: String(snapshot.revision),
    };
  }

  async write(
    pluginId: PluginId,
    serialized: string,
    expectedVersion?: string,
  ): Promise<PluginStorageBackendWriteResult> {
    const expectedRevision = expectedVersion === undefined
      ? (await this.bridge.load(pluginId)).revision
      : Number.parseInt(expectedVersion, 10);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return { ok: false, currentVersion: null };
    }
    const result = await this.bridge.save(pluginId, expectedRevision, serialized);
    return result.ok
      ? { ok: true, version: String(result.revision) }
      : { ok: false, currentVersion: String(result.revision) };
  }
}

class ElectronResourceRegistration implements ResourceUrlRegistration, ManagedResource {
  private currentState: RegistrationState = "staged";
  private disposePromise: Promise<void> | null = null;

  constructor(
    readonly owner: ResourceOwner,
    readonly fileId: NexusFile["id"],
    readonly url: string,
    readonly registrationId: string,
    private readonly revoke: () => Promise<void>,
    private readonly released: () => void,
  ) {}

  get id(): RegistrationId { return asRegistrationId(`resource-url:${this.registrationId}`); }
  get state(): RegistrationState { return this.currentState; }
  get disposed(): boolean { return this.currentState === "disposed"; }
  get revoked(): boolean { return this.currentState === "quiescing" || this.disposed; }

  activate(): void {
    if (this.currentState === "staged") this.currentState = "active";
  }

  quiesce(): void {
    if (!this.revoked) this.currentState = "quiescing";
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.quiesce();
    this.disposePromise = this.revoke().finally(() => {
      this.currentState = "disposed";
      this.released();
    });
    return this.disposePromise;
  }
}

class ElectronPluginRuntimeHost implements PluginRuntimeHost {
  readonly capabilities = new RuntimeCapabilityRegistry();
  readonly diagnostics = new DiagnosticBus();
  readonly editorHost: EditorHostRegistry;
  readonly clipboard: ClipboardPipeline;
  readonly workspace: RuntimeWorkspace;
  readonly windowContext: RuntimeWorkspaceWindow;
  readonly leaf: RuntimeWorkspaceLeaf;
  readonly ui: RuntimeUiHost;
  readonly commands: CommandRegistry;
  readonly hotkeys: HotkeyRegistry;
  readonly scopes: ScopeRegistry;
  readonly markdownPostProcessors: MarkdownPostProcessorRegistry;
  readonly remarkTransforms: RemarkTransformRegistry;
  readonly widgets: WidgetRegistry;
  readonly storage: PluginStorageRuntime;
  readonly secrets: UnsupportedSecretStorage;
  readonly pluginManager: PluginManager;
  readonly productContent: PluginRuntimeProductContent;

  private currentSession: PluginVaultSession | null = null;
  private currentVault = new MemoryVaultRuntime();
  private currentMetadata = new MemoryMetadataRuntime({ vault: this.currentVault });
  readonly linkIndex = new MetadataLinkIndex(this.currentVault, this.currentMetadata);
  private readonly bridge: PluginHostBridge;
  private readonly document: Document;
  private readonly entrypoints = new Map<string, PluginRuntimeEntrypoint>();
  private readonly providers: CapabilityProviderRegistration[] = [];
  private readonly resourceRegistrations = new Set<ElectronResourceRegistration>();
  private readonly ipcVersions = new Map<string, IpcContentVersion>();
  private readonly pendingPluginOperations = new Set<string>();
  private readonly permissionDecisions: (
    manifest: NormalizedPluginManifest,
  ) => PermissionDecisions;
  private readonly configuredExternalPlugins = new Set<string>();
  private readonly externalPermissionRevocations = new Map<string, Promise<void>>();
  private readonly externalPermissionOwners = new WeakSet<NexusPluginBase>();
  private readonly defaultDestroyEditor?: () => void | Promise<void>;
  private editorAttachment: EditorHostAttachment | null = null;
  private markdownAttachments: Array<{ dispose(): Promise<void> }> = [];
  private operationSequence = 0;
  private vaultOperationTail: Promise<void> = Promise.resolve();
  private sessionLifecycleTail: Promise<void> = Promise.resolve();
  private sessionTransitionActive = false;
  private shutdownPromise: Promise<void> | null = null;
  private acceptsDispatch = true;
  private readonly unsubscribeVaultChanges: () => void;
  private readonly unsubscribeHostShutdown: () => void;
  private readonly keydownListener: (event: KeyboardEvent) => void;

  constructor(options: PluginRuntimeHostOptions) {
    this.bridge = options.bridge;
    this.document = options.document;
    this.defaultDestroyEditor = options.destroyEditor;
    for (const [key, value] of Object.entries(options.entrypoints ?? {})) {
      if (value) this.entrypoints.set(key, value);
    }

    const reportDiagnostic = (diagnostic: NexusDiagnostic) => this.diagnostics.report(diagnostic);
    this.editorHost = new EditorHostRegistry({ reportDiagnostic, editorIdPrefix: "electron-editor" });
    this.clipboard = new ClipboardPipeline({ reportDiagnostic });
    this.workspace = new RuntimeWorkspace(this.document, {
      id: options.workspaceId ?? "runtime-workspace",
      supportedContainers: ["root", "tab", "sidebar"],
      defaultNavigationPlacement: "reuse",
      reportDiagnostic,
    });
    this.windowContext = this.workspace.createWindow(this.document, options.windowId ?? "electron-window");
    this.leaf = this.workspace.createLeaf({
      id: "electron-markdown-leaf",
      windowId: this.windowContext.id,
      containerType: "tab",
    });
    this.workspace.setActiveLeaf(this.leaf.id);
    this.workspace.focusLeaf(this.leaf.id);
    this.workspace.markLayoutReady();

    this.commands = new CommandRegistry({
      reportDiagnostic,
      resolveContext: (context) => Object.freeze({
        trigger: context.trigger ?? "api",
        editor: context.editor ?? this.editorAttachment?.context ?? null,
        ...(context.sourceId === undefined ? {} : { sourceId: context.sourceId }),
      }),
    });
    const navigatorPlatform = this.document.defaultView?.navigator.platform.toLocaleLowerCase() ?? "";
    const platform = options.platform ?? (navigatorPlatform.includes("mac")
      ? "macos"
      : navigatorPlatform.includes("win") ? "windows" : "linux");
    this.hotkeys = new HotkeyRegistry(this.commands, { platform, reportDiagnostic });
    this.scopes = new ScopeRegistry({ platform, reportDiagnostic });
    this.markdownPostProcessors = new MarkdownPostProcessorRegistry({ reportDiagnostic });
    this.remarkTransforms = new RemarkTransformRegistry({ reportDiagnostic });
    this.widgets = new WidgetRegistry({ reportDiagnostic });
    this.storage = new PluginStorageRuntime({
      backend: new IpcPluginStorageBackend(this.bridge.storage),
      reportDiagnostic,
    });
    this.secrets = new UnsupportedSecretStorage(
      "Electron secret storage is not available in this host version",
    );

    const actionContext = this.createActionContext();
    const slots: RuntimeUiHostOptions["slots"] = {};
    for (const [slot, value] of Object.entries(options.slots ?? {}) as Array<[UiSlot, PluginRuntimeSlot]>) {
      slots[slot] = value instanceof this.document.defaultView!.HTMLElement
        ? { window: this.windowContext, containerEl: value, actionContext }
        : value;
    }
    this.ui = new RuntimeUiHost({
      slots,
      commandRegistry: this.commands,
      defaultWindow: this.windowContext,
      resolveStorage: (owner) => this.storage.createService(owner, () => undefined),
      confirmDangerousAction: options.confirmDangerousAction,
      reportDiagnostic,
    });

    this.registerCapabilities();
    const host = options.host ?? DEFAULT_HOST;
    const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
    this.permissionDecisions = options.permissionDecisions ?? denyPermissions;
    const validator = new PluginCompatibilityValidator({
      hostId: host.id,
      hostVersion: host.version,
      apiVersion,
      platform: host.platform,
      capabilities: this.capabilities,
      capabilityContext: {
        windowId: this.windowContext.id,
        workspaceId: this.workspace.id,
        editorId: PRIMARY_EDITOR_ID,
      },
      permissionDecisions: this.permissionDecisions,
    });
    const resolver: HostPluginEntrypointResolver = {
      loadEntrypoint: (request) => {
        const value = this.entrypoints.get(request.entrypoint) ??
          this.entrypoints.get(request.manifest.identity.id) ??
          this.entrypoints.get(request.source.locator);
        if (!value) throw new Error("Bundled plugin entrypoint is not registered");
        return Promise.resolve(asEntrypointModule(value));
      },
    };
    this.pluginManager = new PluginManager({
      host,
      apiVersion,
      diagnostics: this.diagnostics,
      loader: new TrustedPluginPackageLoader({
        validator,
        entrypoints: new HostControlledPluginEntrypointLoader(resolver),
      }),
    });
    this.productContent = this.createProductContentFacade();

    this.unsubscribeVaultChanges = this.bridge.vault.onChanged((event) => {
      if (!this.acceptsDispatch || event.sessionId !== this.currentSession?.sessionId) return;
      void this.enqueueVaultOperation(() => this.mergeWatchEvent(event)).catch((error) => {
        this.reportHostFailure("Vault watch event could not be merged", error);
      });
    });
    this.unsubscribeHostShutdown = this.bridge.host.onShutdown((event) => {
      if (options.onShutdownRequested) {
        void Promise.resolve(options.onShutdownRequested(event)).catch((error) => {
          this.reportHostFailure("Host shutdown request handler failed", error);
        });
      } else {
        void this.shutdown().catch((error) => this.reportHostFailure("Plugin host shutdown failed", error));
      }
    });
    this.keydownListener = (event) => this.dispatchKeyboardEvent(event);
    this.document.addEventListener("keydown", this.keydownListener, true);
  }

  get session(): PluginVaultSession | null { return this.currentSession; }
  get vault(): MemoryVaultRuntime { return this.currentVault; }
  get metadata(): MemoryMetadataRuntime { return this.currentMetadata; }
  get dispatching(): boolean { return this.acceptsDispatch; }

  pickSession(): Promise<PluginVaultSession | null> {
    return this.openSession(() => this.bridge.vault.pick());
  }

  restoreSession(): Promise<PluginVaultSession | null> {
    return this.openSession(() => this.bridge.vault.restore());
  }

  async attachEditor(editor: EditorAPI, root: HTMLElement): Promise<EditorHostAttachment> {
    if (this.shutdownPromise) throw new Error("Plugin runtime host is shutting down");
    if (this.editorAttachment && !this.editorAttachment.detached) {
      throw new Error("The single-leaf Electron host already has an attached editor");
    }
    const reportDiagnostic = (diagnostic: NexusDiagnostic) => this.diagnostics.report(diagnostic);
    const file = this.workspace.getActiveFile();
    const attachment = this.editorHost.attach({
      editor,
      editorId: PRIMARY_EDITOR_ID,
      surface: { kind: "document", id: "electron-primary-editor", root },
      file,
      sourcePath: file?.path ?? null,
      leaf: this.leaf,
      window: this.windowContext,
    });
    const transactions = new EditorTransactionPipeline({
      reportDiagnostic,
      context: () => attachment.context,
    });
    const onFocus = () => attachment.markRecent();
    let focusListenerAttached = false;
    let detachPromise: Promise<void> | null = null;
    let clipboardBridge: ManagedResource | null = null;
    let clipboardProvider: CapabilityProviderRegistration | null = null;
    let transactionsProvider: CapabilityProviderRegistration | null = null;
    const removeFocusListener = (): void => {
      if (!focusListenerAttached) return;
      focusListenerAttached = false;
      editor.off("focus", onFocus);
    };
    const hostAttachment: EditorHostAttachment = {
      editorId: attachment.editorId,
      get context() { return attachment.context; },
      ready: attachment.ready,
      get detached() { return attachment.detached; },
      updateContext: (patch) => attachment.updateContext(patch),
      markRecent: () => attachment.markRecent(),
      detach: () => {
        if (detachPromise) return detachPromise;
        removeFocusListener();
        // Failures in this batch surface through the diagnostics bus only (never the console),
        // so a clean log is NOT evidence that this cleanup succeeded.
        // 注意：本批次的失败只上报诊断总线（不落 console）—— 日志里没有报错并不代表清理成功。
        detachPromise = (async () => {
          const results = await Promise.allSettled([
            clipboardProvider?.revoke("editor-detached"),
            clipboardBridge?.dispose(),
            transactionsProvider?.revoke("editor-detached"),
            transactions.dispose(),
          ]);
          await attachment.detach();
          const errors = results
            .filter((result): result is PromiseRejectedResult => result.status === "rejected")
            .map((result) => result.reason);
          if (errors.length > 0) {
            throw new AggregateError(errors, "Editor capability cleanup failed");
          }
        })();
        return detachPromise;
      },
    };
    const markdownAttachments: Array<{ readonly ready: Promise<void>; dispose(): Promise<void> }> = [];
    try {
      clipboardBridge = await this.clipboard.attachEditorHost(() => attachment.context);
      clipboardProvider = this.capabilities.registerOwnerBound(
        EDITOR_CLIPBOARD_CAPABILITY,
        ({ owner, registerResource }) => this.clipboard.createService(owner, registerResource),
        { context: { editorId: PRIMARY_EDITOR_ID } },
      );
      this.providers.push(clipboardProvider);
      transactionsProvider = this.capabilities.registerOwnerBound(
        EDITOR_TRANSACTIONS_CAPABILITY,
        ({ owner, registerResource }) => transactions.createService(owner, registerResource),
        { context: { editorId: PRIMARY_EDITOR_ID } },
      );
      this.providers.push(transactionsProvider);
      markdownAttachments.push(this.remarkTransforms.attach(editor.getContributionSink()));
      markdownAttachments.push(this.widgets.attach(editor.getContributionSink()));
      focusListenerAttached = true;
      editor.on("focus", onFocus);
      this.editorAttachment = hostAttachment;
      this.markdownAttachments = markdownAttachments;
      await Promise.all([attachment.ready, ...markdownAttachments.map((item) => item.ready)]);
    } catch (error) {
      removeFocusListener();
      await Promise.allSettled([
        clipboardProvider?.revoke("editor-attach-failed"),
        clipboardBridge?.dispose(),
        transactionsProvider?.revoke("editor-attach-failed"),
        transactions.dispose(),
        ...markdownAttachments.map((item) => item.dispose()),
        attachment.detach(),
      ]);
      this.editorAttachment = null;
      this.markdownAttachments = [];
      throw error;
    }
    hostAttachment.markRecent();
    this.leaf.setResourceContext(file, hostAttachment.context);
    this.workspace.setRecentEditor(hostAttachment.context);
    return hostAttachment;
  }

  async setActiveFile(path: string | null): Promise<NexusFile | null> {
    const file = path === null ? null : this.currentVault.getFileByPath(normalizeVaultPath(path));
    if (path !== null && !file) throw new RangeError(`Vault file '${path}' does not exist`);
    this.workspace.setActiveFile(file);
    if (this.editorAttachment && !this.editorAttachment.detached) {
      const context = await this.editorAttachment.updateContext({
        file,
        sourcePath: file?.path ?? null,
        leaf: this.leaf,
        window: this.windowContext,
      });
      this.leaf.setResourceContext(file, context);
      this.workspace.setRecentEditor(context);
    } else {
      this.leaf.setResourceContext(file, null);
    }
    return file;
  }

  discoverBundledPlugin(
    manifest: AuthorPluginManifest,
    input: BundledPluginOptions | PluginRuntimeEntrypoint = {},
  ): PluginDiscoveryResult {
    const options = isEntrypoint(input) ? { entrypoint: input } : input;
    if (options.entrypoint) {
      this.entrypoints.set(manifest.entrypoint, options.entrypoint);
      this.entrypoints.set(manifest.id, options.entrypoint);
    }
    const locator = options.sourceLocator ?? `bundled:${manifest.id}`;
    if (options.entrypoint) this.entrypoints.set(locator, options.entrypoint);
    const candidate: TrustedPluginPackageCandidate = Object.freeze({
      authorManifest: manifest,
      host: Object.freeze({
        source: Object.freeze({ kind: "bundled" as const, locator }),
        installLocation: Object.freeze({ scheme: "host" as const, locator }),
      }),
    });
    return this.pluginManager.discover(candidate);
  }

  async enableBundledPlugin(
    manifest: AuthorPluginManifest,
    input: BundledPluginOptions | PluginRuntimeEntrypoint = {},
  ): Promise<PluginEnableResult> {
    const existing = this.pluginManager.get(manifest.id);
    let pluginId: string;
    if (!existing) {
      const discovered = this.discoverBundledPlugin(manifest, input);
      if (!discovered.ok) return { ok: false, state: "failed", diagnostics: discovered.diagnostics };
      pluginId = discovered.plugin.id;
    } else {
      pluginId = existing.id;
    }
    return this.enablePluginWithHostPermissions(pluginId);
  }

  shutdown(options: PluginRuntimeShutdownOptions = {}): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.performShutdown(
      options.destroyEditor ?? this.defaultDestroyEditor,
      options.notifyHost ?? true,
    );
    return this.shutdownPromise;
  }

  private openSession(open: () => Promise<PluginVaultSession | null>): Promise<PluginVaultSession | null> {
    if (this.shutdownPromise || !this.acceptsDispatch) {
      return Promise.reject(new Error("Plugin runtime host is shutting down"));
    }
    const operation = this.sessionLifecycleTail.then(async () => {
      this.assertSessionOperationActive();
      const enabled = this.pluginManager.list()
        .filter((plugin) => plugin.state === "enabled")
        .map((plugin) => plugin.id);
      this.sessionTransitionActive = true;
      try {
        if (enabled.length > 0) await this.pluginManager.disableAll();
        return await this.enqueueVaultOperation(() => this.performOpenSession(open));
      } finally {
        this.sessionTransitionActive = false;
        // Re-enable outside the Vault queue. Plugin onload hooks may themselves
        // await durable operations, which would otherwise wait on this task.
        if (!this.shutdownPromise && this.acceptsDispatch) {
          for (const pluginId of enabled) await this.enablePluginWithHostPermissions(pluginId);
        }
      }
    });
    this.sessionLifecycleTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async performOpenSession(
    open: () => Promise<PluginVaultSession | null>,
  ): Promise<PluginVaultSession | null> {
    this.assertSessionOperationActive();
    let next: PluginVaultSession | null = null;
    let prepared: PreparedVaultMirror | null = null;
    const previous = this.currentSession;
    try {
      next = await open();
      this.assertSessionOperationActive();
      if (!next) return null;
      prepared = await this.prepareMirror(next.sessionId);
      this.assertSessionOperationActive();
      await this.commitMirror(next, prepared);
      prepared = null;
      return next;
    } catch (error) {
      const errors = [error];
      if (prepared) {
        const abandoned = prepared;
        prepared = null;
        try { await this.disposeMirror(abandoned); }
        catch (disposeError) { errors.push(disposeError); }
      }
      if (next && next.sessionId !== previous?.sessionId) {
        try { await this.bridge.vault.close(next.sessionId); }
        catch (closeError) { errors.push(closeError); }
      }
      if (errors.length > 1) throw new AggregateError(errors, "Vault session switch failed");
      throw error;
    }
  }

  private assertSessionOperationActive(): void {
    if (this.shutdownPromise || !this.acceptsDispatch) {
      throw new Error("Plugin runtime host is shutting down");
    }
  }

  private async prepareMirror(sessionId: PluginVaultSession["sessionId"]): Promise<PreparedVaultMirror> {
    const [files, nodes] = await Promise.all([
      this.bridge.vault.readAll(sessionId),
      this.bridge.vault.list(sessionId),
    ]);
    const initialFiles: Record<string, string> = {};
    const versions = new Map<string, IpcContentVersion>();
    for (const file of files) {
      initialFiles[file.path] = file.content;
      versions.set(file.path, file.version);
    }
    const vault = new MemoryVaultRuntime({
      initialFiles,
      reportDiagnostic: (diagnostic) => this.diagnostics.report(diagnostic),
    });
    let metadata: MemoryMetadataRuntime | null = null;
    try {
      const folderPaths = [...collectFolderPaths(nodes)]
        .map((path) => normalizeVaultPath(path))
        .sort((left, right) => left.split("/").length - right.split("/").length);
      for (const path of folderPaths) {
        if (vault.getFolderByPath(path)) continue;
        const operationId = asOperationId(`hydrate-folder:${++this.operationSequence}`);
        const result = await vault.confirmHostChange(
          { type: "create-folder", path, operationId },
          { kind: "host", operationId },
        );
        if (!result.ok) throw new Error(result.diagnostic.message);
      }
      metadata = new MemoryMetadataRuntime({
        vault,
        reportDiagnostic: (diagnostic) => this.diagnostics.report(diagnostic),
      });
      return { vault, metadata, versions };
    } catch (error) {
      if (metadata) await metadata.dispose();
      await vault.dispose();
      throw error;
    }
  }

  private async commitMirror(session: PluginVaultSession, prepared: PreparedVaultMirror): Promise<void> {
    const previousSession = this.currentSession;
    const previousMetadata = this.currentMetadata;
    const previousVault = this.currentVault;
    const previousVersions = new Map(this.ipcVersions);
    const previousActivePath = this.workspace.getActiveFile()?.path ?? null;
    try {
      this.currentSession = session;
      this.currentVault = prepared.vault;
      this.currentMetadata = prepared.metadata;
      this.linkIndex.replaceMirror(this.currentVault, this.currentMetadata);
      this.ipcVersions.clear();
      for (const [path, version] of prepared.versions) this.ipcVersions.set(path, version);
      try {
        await this.setActiveFile(null);
      } catch (error) {
        this.reportHostFailure("Active editor context could not be cleared after a Vault switch", error);
      }
      if (previousSession && previousSession.sessionId !== session.sessionId) {
        await this.bridge.vault.close(previousSession.sessionId);
      }
    } catch (error) {
      const errors = [error];
      this.currentSession = previousSession;
      this.currentVault = previousVault;
      this.currentMetadata = previousMetadata;
      this.ipcVersions.clear();
      for (const [path, version] of previousVersions) this.ipcVersions.set(path, version);
      try { this.linkIndex.replaceMirror(previousVault, previousMetadata); }
      catch (rollbackError) { errors.push(rollbackError); }
      try { await this.setActiveFile(previousActivePath); }
      catch (rollbackError) { errors.push(rollbackError); }
      if (errors.length > 1) throw new AggregateError(errors, "Vault mirror commit rollback failed");
      throw error;
    }
    try {
      await this.bridge.vault.commit(session.sessionId);
    } catch (error) {
      this.reportHostFailure("The opened Vault could not be persisted as recent", error);
    }
    try {
      await this.disposeMirror({
        vault: previousVault,
        metadata: previousMetadata,
        versions: new Map(),
      });
    } catch (error) {
      this.reportHostFailure("Previous Vault mirror cleanup failed after a session switch", error);
    }
  }

  private async disposeMirror(mirror: PreparedVaultMirror): Promise<void> {
    const results = await Promise.allSettled([
      mirror.metadata.dispose(),
      mirror.vault.dispose(),
    ]);
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length > 0) throw new AggregateError(errors, "Vault mirror cleanup failed");
  }

  private registerCapabilities(): void {
    const ownerBound = <T>(
      token: Parameters<RuntimeCapabilityRegistry["registerOwnerBound"]>[0],
      factory: (owner: ResourceOwner, registerResource: (resource: ManagedResource) => void) => T,
      context?: { readonly windowId?: RuntimeWorkspaceWindow["id"]; readonly workspaceId?: RuntimeWorkspace["id"] },
    ) => {
      this.providers.push(this.capabilities.registerOwnerBound(token, ({ owner, registerResource }) =>
        factory(owner, registerResource), context ? { context } : {}));
    };
    ownerBound(COMMANDS_CAPABILITY, (owner, register) => this.commands.createService(owner, register));
    this.providers.push(this.capabilities.register(HOTKEYS_CAPABILITY, this.hotkeys.createService()));
    ownerBound(SCOPES_CAPABILITY, (owner, register) => this.scopes.createService(owner, register));
    ownerBound(EDITOR_HOST_CAPABILITY, (owner, register) => this.editorHost.createService(owner, register));
    ownerBound(
      MARKDOWN_PROCESSORS_CAPABILITY,
      (owner, register) => this.markdownPostProcessors.createService(owner, register),
    );
    ownerBound(
      WORKSPACE_CAPABILITY,
      (owner, register) => this.workspace.createService(owner, register),
      { workspaceId: this.workspace.id },
    );
    ownerBound(
      VAULT_CAPABILITY,
      (owner, register) => this.createDurableVaultService(owner, register),
      { workspaceId: this.workspace.id },
    );
    ownerBound(
      FILE_MANAGER_CAPABILITY,
      (owner) => this.createDurableFileManagerService(owner),
      { workspaceId: this.workspace.id },
    );
    ownerBound(
      METADATA_CAPABILITY,
      (owner, register) => ({ ...this.currentMetadata.createService(owner, register) }),
      { workspaceId: this.workspace.id },
    );
    ownerBound(
      RESOURCES_CAPABILITY,
      (owner, register) => this.createResourceService(owner, register),
      { workspaceId: this.workspace.id },
    );
    ownerBound(
      UI_CAPABILITY,
      (owner, register) => this.createUiService(owner, register),
      { windowId: this.windowContext.id },
    );
    ownerBound(PLUGIN_STORAGE_CAPABILITY, (owner, register) => ({
      ...this.storage.createService(owner, register),
    }));
  }

  private createUiService(
    owner: ResourceOwner,
    registerResource: (resource: ManagedResource) => void,
  ): UiService {
    let active = true;
    registerResource({
      quiesce: () => { active = false; },
      dispose: () => { active = false; },
    });
    const service = this.ui.createService(owner, registerResource);
    const policy: UiPolicyService = {
      sanitizeHtml: (html) => service.policy.sanitizeHtml(html),
      confirmDangerousAction: (options) => service.policy.confirmDangerousAction(options),
      openExternalUrl: async (url, context) => {
        if (!active) {
          return {
            ok: false,
            diagnostic: failure("permission-denied", "External URL permission is no longer active"),
          };
        }
        let parsed: URL;
        try {
          parsed = new URL(url, context.ownerDocument.baseURI);
        } catch (error) {
          return { ok: false, diagnostic: failure("ui-policy-denied", `External URL '${url}' is invalid`, error) };
        }
        if (!["https:", "mailto:"].includes(parsed.protocol)) {
          return {
            ok: false,
            diagnostic: failure(
              "ui-policy-denied",
              `External URL scheme '${parsed.protocol}' is not allowed`,
            ),
          };
        }
        try {
          await this.bridge.host.openExternal(owner.pluginId, parsed.href);
          return { ok: true, value: undefined };
        } catch (error) {
          return {
            ok: false,
            diagnostic: failure("permission-denied", "External URL permission was denied by the host", error),
          };
        }
      },
    };
    return Object.freeze({ ...service, policy: Object.freeze(policy) });
  }

  private async configureExternalPermissions(manifest: NormalizedPluginManifest): Promise<void> {
    const hasExternalPermission = manifest.permissions.some((permission) =>
      isExternalNavigationPermission(permission.id));
    if (!hasExternalPermission) return;
    await this.bridge.host.activatePlugin(manifest.identity.id);
    this.configuredExternalPlugins.add(manifest.identity.id);
  }

  private async enablePluginWithHostPermissions(pluginId: string): Promise<PluginEnableResult> {
    const record = this.pluginManager.get(pluginId);
    if (!record) throw new Error(`Plugin '${pluginId}' disappeared after discovery.`);
    try {
      await this.configureExternalPermissions(record.manifest);
      const result = await this.pluginManager.enable(record.id);
      if (!result.ok) {
        await this.revokeExternalPermissions(record.id);
      } else {
        this.bindExternalPermissionLifecycle(result.plugin);
      }
      return result;
    } catch (error) {
      await this.revokeExternalPermissions(record.id).catch(() => undefined);
      throw error;
    }
  }

  private bindExternalPermissionLifecycle(plugin: NexusPluginBase): void {
    if (this.externalPermissionOwners.has(plugin)) return;
    this.externalPermissionOwners.add(plugin);
    let revokePromise: Promise<void> | null = null;
    const revoke = (): Promise<void> => {
      revokePromise ??= this.revokeExternalPermissions(plugin.identity.id);
      return revokePromise;
    };
    plugin.register({
      quiesce: () => { void revoke(); },
      dispose: revoke,
    });
  }

  private revokeExternalPermissions(pluginId: string): Promise<void> {
    const existing = this.externalPermissionRevocations.get(pluginId);
    if (existing) return existing;
    if (!this.configuredExternalPlugins.has(pluginId)) return Promise.resolve();
    const revocation = this.bridge.host.revokePlugin(pluginId).then(() => {
      this.configuredExternalPlugins.delete(pluginId);
    }).finally(() => {
      this.externalPermissionRevocations.delete(pluginId);
    });
    this.externalPermissionRevocations.set(pluginId, revocation);
    return revocation;
  }

  private createDurableVaultService(
    owner: ResourceOwner,
    registerResource: (resource: ManagedResource) => void,
  ): VaultService {
    const events = this.currentVault.createService(owner, registerResource).events;
    const service: VaultService = {
      events,
      getAbstractFileByPath: (path) => this.currentVault.getAbstractFileByPath(path),
      getFileByPath: (path) => this.currentVault.getFileByPath(path),
      getFolderByPath: (path) => this.currentVault.getFolderByPath(path),
      read: (file, options) => this.currentVault.read(file, options),
      readBinary: (file, options) => this.currentVault.readBinary(file, options),
      create: (path, data, options) =>
        this.writeDurably(owner, path, data, "create", options?.expectedVersion),
      createBinary: (path, data, options) =>
        this.writeDurably(owner, path, new Uint8Array(data.slice(0)), "create", options?.expectedVersion),
      createFolder: (path) => this.createFolderDurably(owner, path),
      modify: (file, data, options) => this.modifyDurably(owner, file, data, options?.expectedVersion),
      modifyBinary: (file, data, options) =>
        this.modifyDurably(owner, file, new Uint8Array(data.slice(0)), options?.expectedVersion),
      append: (file, data, options) => this.enqueueMutationResult(
        async (context) => {
          if (!context.vault.ownsFile(file)) {
            return { ok: false, diagnostic: failure("file-invalid-reference", "Invalid Vault file reference") };
          }
          const current = await context.vault.read(file);
          return this.writeDurablyNow(
            context,
            owner,
            file.path,
            current + data,
            "modify",
            options?.expectedVersion,
          );
        },
        (error) => this.contentFailure("Vault append failed before durable commit", error, file),
      ),
      process: (file, transform) => this.enqueueMutationResult(
        async (context) => {
          if (!context.vault.ownsFile(file)) {
            return { ok: false, diagnostic: failure("file-invalid-reference", "Invalid Vault file reference") };
          }
          let next: string;
          try {
            next = transform(await context.vault.read(file));
            if (typeof next !== "string") throw new TypeError("Vault process transform must return a string");
          } catch (error) {
            const diagnostic = failure("callback-failed", "Vault process transform failed", error);
            this.diagnostics.report(diagnostic);
            return { ok: false as const, diagnostic };
          }
          return this.writeDurablyNow(context, owner, file.path, next, "modify", file.version);
        },
        (error) => this.contentFailure("Vault process failed before durable commit", error, file),
      ),
      rename: (file, destination, options) =>
        this.renameDurably(owner, file, destination, options?.expectedVersion),
      trash: (file) => this.trashDurably(owner, file),
      delete: (file) => Promise.resolve({
        ok: false as const,
        diagnostic: failure(
          "permission-denied",
          "Permanent deletion is not exposed by the Electron Vault bridge",
          undefined,
          { path: file.path },
        ),
      }),
    };
    return service;
  }

  private createProductContentFacade(): PluginRuntimeProductContent {
    const owner: ResourceOwner = Object.freeze({
      pluginId: "nexus-electron-product" as PluginId,
      componentId: "nexus-electron-product/vault-panel" as ComponentId,
    });
    const requireNode = (path: string): NexusAbstractFile => {
      const normalized = normalizeVaultPath(path);
      const node = this.currentVault.getAbstractFileByPath(normalized);
      if (!node) throw new RangeError(`Vault path '${normalized}' does not exist`);
      return node;
    };
    const requireFile = (path: string): NexusFile => {
      const normalized = normalizeVaultPath(path);
      const file = this.currentVault.getFileByPath(normalized);
      if (!file) throw new RangeError(`Vault file '${normalized}' does not exist`);
      return file;
    };
    const requireSuccess = <T>(result: ServiceResult<T>): T => {
      if (!result.ok) throw new Error(result.diagnostic.message);
      return result.value;
    };
    const requireWrite = (result: ContentWriteResult): NexusFile => {
      if (!result.ok) throw new Error(result.diagnostic.message);
      return result.file;
    };
    const facade: PluginRuntimeProductContent = {
      list: () => this.listProductNodes(),
      read: async (path) => {
        const file = requireFile(path);
        return Object.freeze({ path: file.path, content: await this.currentVault.read(file) });
      },
      write: async (path, content) => {
        const normalized = normalizeVaultPath(path);
        const existing = this.currentVault.getFileByPath(normalized);
        const result = existing
          ? await this.modifyDurably(owner, existing, content, existing.version)
          : await this.writeDurably(owner, normalized, content, "create");
        return Object.freeze({ path: requireWrite(result).path });
      },
      createFile: async (path) => {
        const result = await this.writeDurably(owner, normalizeVaultPath(path), "", "create");
        return Object.freeze({ path: requireWrite(result).path });
      },
      createFolder: async (path) => {
        const folder = requireSuccess(await this.createFolderDurably(owner, normalizeVaultPath(path)));
        return Object.freeze({ path: folder.path });
      },
      rename: async (path, destination) => {
        const moved = await this.createDurableFileManagerService(owner).moveFile(
          requireNode(path),
          normalizeVaultPath(destination),
          { updateLinks: "host-default" },
        );
        return Object.freeze({ path: requireSuccess(moved).path });
      },
      trash: async (path) => {
        requireSuccess(await this.createDurableFileManagerService(owner).trashFile(requireNode(path)));
        return Object.freeze({ ok: true as const });
      },
      onChanged: (listener) => this.linkIndex.subscribe(listener),
    };
    return Object.freeze(facade);
  }

  private listProductNodes(folderPath = "" as VaultPath): readonly PluginVaultNode[] {
    return Object.freeze(this.currentVault.childrenOf(folderPath).map((node) => {
      const name = node.path.slice(node.path.lastIndexOf("/") + 1);
      return node.kind === "folder"
        ? Object.freeze({
            name,
            path: node.path,
            kind: "folder" as const,
            children: this.listProductNodes(node.path),
          })
        : Object.freeze({ name, path: node.path, kind: "file" as const });
    }));
  }

  private writeDurably(
    owner: ResourceOwner,
    path: VaultPath,
    data: string | Uint8Array,
    type: "create" | "modify",
    expectedVersion?: ContentVersion,
  ): Promise<ContentWriteResult> {
    return this.enqueueMutationResult(
      (context) => this.writeDurablyNow(context, owner, path, data, type, expectedVersion),
      (error) => this.contentFailure("Vault write was rejected", error),
    );
  }

  private async writeDurablyNow(
    context: VaultMutationContext,
    owner: ResourceOwner,
    path: VaultPath,
    data: string | Uint8Array,
    type: "create" | "modify",
    expectedVersion?: ContentVersion,
  ): Promise<ContentWriteResult> {
    const normalized = normalizeVaultPath(path);
    const existing = context.vault.getFileByPath(normalized);
    if (type === "create" && context.vault.getAbstractFileByPath(normalized)) {
      return this.contentFailure(`Vault path '${normalized}' already exists`, undefined, existing);
    }
    if (type === "modify" && !existing) {
      return this.contentFailure(`Vault file '${normalized}' does not exist`, undefined);
    }
    if (expectedVersion !== undefined && existing?.version !== expectedVersion) {
      return {
        ok: false,
        diagnostic: failure("file-version-conflict", "File changed after the caller read it"),
        ...(existing ? { currentVersion: existing.version } : {}),
      };
    }
    const requested = this.nextOperationId(owner);
    this.pendingPluginOperations.add(requested);
    try {
      const ipcExpected = expectedVersion === undefined ? undefined : this.ipcVersions.get(normalized);
      const mutation = typeof data === "string"
        ? await this.bridge.vault.write(context.session.sessionId, normalized, data, {
            ...(ipcExpected ? { expectedVersion: ipcExpected } : {}),
            operationId: requested,
          })
        : await this.bridge.vault.writeBinary(context.session.sessionId, normalized, data, {
            ...(ipcExpected ? { expectedVersion: ipcExpected } : {}),
            operationId: requested,
          });
      const confirmed = await this.confirmPluginChange(context.vault, owner, {
        type,
        path: normalized,
        data,
        operationId: mutation.operationId,
      });
      if (!confirmed.ok) return confirmed;
      if (mutation.version) this.ipcVersions.set(normalized, mutation.version);
      const file = context.vault.getFileByPath(normalized);
      if (!file) return { ok: false, diagnostic: failure("file-invalid-reference", "Committed file is missing") };
      return { ok: true, file, version: file.version, operationId: asOperationId(mutation.operationId) };
    } catch (error) {
      return this.contentFailure("Vault write failed before mirror commit", error, existing);
    } finally {
      this.pendingPluginOperations.delete(requested);
    }
  }

  private modifyDurably(
    owner: ResourceOwner,
    file: NexusFile,
    data: string | Uint8Array,
    expectedVersion?: ContentVersion,
  ): Promise<ContentWriteResult> {
    return this.writeDurably(owner, file.path, data, "modify", expectedVersion);
  }

  private createFolderDurably(
    owner: ResourceOwner,
    path: VaultPath,
  ): Promise<ServiceResult<NexusFolder>> {
    return this.enqueueMutationResult(
      (context) => this.createFolderDurablyNow(context, owner, path),
      (error) => ({ ok: false, diagnostic: this.reportHostFailure("Vault folder creation was rejected", error) }),
    );
  }

  private async createFolderDurablyNow(
    context: VaultMutationContext,
    owner: ResourceOwner,
    path: VaultPath,
  ): Promise<ServiceResult<NexusFolder>> {
    const normalized = normalizeVaultPath(path);
    const requested = this.nextOperationId(owner);
    this.pendingPluginOperations.add(requested);
    try {
      const mutation = await this.bridge.vault.createFolder(
        context.session.sessionId,
        normalized,
        requested,
      );
      const confirmed = await this.confirmPluginChange(context.vault, owner, {
        type: "create-folder",
        path: normalized,
        operationId: mutation.operationId,
      });
      if (!confirmed.ok) return confirmed;
      const folder = context.vault.getFolderByPath(normalized);
      return folder
        ? { ok: true, value: folder }
        : { ok: false, diagnostic: failure("file-invalid-reference", "Committed folder is missing") };
    } catch (error) {
      return { ok: false, diagnostic: this.reportHostFailure("Vault folder creation failed", error) };
    } finally {
      this.pendingPluginOperations.delete(requested);
    }
  }

  private renameDurably(
    owner: ResourceOwner,
    file: NexusAbstractFile,
    destination: VaultPath,
    expectedVersion?: ContentVersion,
  ): Promise<ServiceResult<NexusAbstractFile>> {
    return this.enqueueMutationResult(
      (context) => this.renameDurablyNow(context, owner, file, destination, expectedVersion),
      (error) => ({ ok: false, diagnostic: this.reportHostFailure("Vault rename was rejected", error) }),
    );
  }

  private async renameDurablyNow(
    context: VaultMutationContext,
    owner: ResourceOwner,
    file: NexusAbstractFile,
    destination: VaultPath,
    expectedVersion?: ContentVersion,
  ): Promise<ServiceResult<NexusAbstractFile>> {
    if (!file.valid || context.vault.getAbstractFileByPath(file.path)?.id !== file.id) {
      return { ok: false, diagnostic: failure("file-invalid-reference", "Invalid Vault file reference") };
    }
    if (file.kind === "file" && expectedVersion !== undefined && file.version !== expectedVersion) {
      return { ok: false, diagnostic: failure("file-version-conflict", "File changed after the caller read it") };
    }
    const normalized = normalizeVaultPath(destination);
    const oldPath = file.path;
    const requested = this.nextOperationId(owner);
    this.pendingPluginOperations.add(requested);
    try {
      const mutation = await this.bridge.vault.rename(
        context.session.sessionId,
        oldPath,
        normalized,
        requested,
      );
      const confirmed = await this.confirmPluginChange(context.vault, owner, {
        type: "rename",
        path: oldPath,
        destination: normalized,
        operationId: mutation.operationId,
      });
      if (!confirmed.ok) return confirmed;
      const ipcVersion = this.ipcVersions.get(oldPath);
      this.ipcVersions.delete(oldPath);
      if (mutation.version ?? ipcVersion) this.ipcVersions.set(normalized, mutation.version ?? ipcVersion!);
      return { ok: true, value: file };
    } catch (error) {
      return { ok: false, diagnostic: this.reportHostFailure("Vault rename failed", error) };
    } finally {
      this.pendingPluginOperations.delete(requested);
    }
  }

  private trashDurably(
    owner: ResourceOwner,
    file: NexusAbstractFile,
  ): Promise<ServiceResult<{ readonly recoverable: true }>> {
    return this.enqueueMutationResult(
      (context) => this.trashDurablyNow(context, owner, file),
      (error) => ({ ok: false, diagnostic: this.reportHostFailure("Vault trash was rejected", error) }),
    );
  }

  private async trashDurablyNow(
    context: VaultMutationContext,
    owner: ResourceOwner,
    file: NexusAbstractFile,
  ): Promise<ServiceResult<{ readonly recoverable: true }>> {
    if (!file.valid || context.vault.getAbstractFileByPath(file.path)?.id !== file.id) {
      return { ok: false, diagnostic: failure("file-invalid-reference", "Invalid Vault file reference") };
    }
    const path = file.path;
    const requested = this.nextOperationId(owner);
    this.pendingPluginOperations.add(requested);
    try {
      const mutation = await this.bridge.vault.trash(
        context.session.sessionId,
        path,
        requested,
      );
      const confirmed = await this.confirmPluginChange(context.vault, owner, {
        type: "delete",
        path,
        operationId: mutation.operationId,
      });
      if (!confirmed.ok) return confirmed;
      this.ipcVersions.delete(path);
      return { ok: true, value: { recoverable: true } };
    } catch (error) {
      return { ok: false, diagnostic: this.reportHostFailure("Vault trash failed", error) };
    } finally {
      this.pendingPluginOperations.delete(requested);
    }
  }

  private createDurableFileManagerService(owner: ResourceOwner): FileManagerService {
    const service: FileManagerService = {
      getAvailableAttachmentPath: async (request) => {
        const name = request.name.trim();
        if (!name || name.includes("/") || name.includes("\\")) {
          throw new RangeError("Attachment name must be a single path segment");
        }
        const folder = request.sourcePath ? dirname(normalizeVaultPath(request.sourcePath)) : "attachments";
        const extension = extensionOf(name);
        const stem = stemOf(name);
        for (let suffix = 0; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
          const candidateName = suffix === 0
            ? name
            : extension ? `${stem} ${suffix}.${extension}` : `${stem} ${suffix}`;
          const candidate = normalizeVaultPath(folder ? `${folder}/${candidateName}` : candidateName);
          if (!this.currentVault.getAbstractFileByPath(candidate)) return candidate;
        }
        throw new Error("No attachment path is available");
      },
      moveFile: (file, destination, moveOptions) => this.enqueueMutationResult(
        (context) => this.moveFileDurablyNow(
          context,
          owner,
          file,
          destination,
          moveOptions?.expectedVersion,
          moveOptions?.updateLinks !== "never",
        ),
        (error) => ({
          ok: false,
          diagnostic: this.reportHostFailure("Vault move was rejected", error),
        }),
      ),
      renameFile: (file, name, moveOptions) => {
        if (!name.trim() || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
          return Promise.resolve({
            ok: false as const,
            diagnostic: failure("path-outside-authorized-root", "File name must be a single path segment"),
          });
        }
        const destination = normalizeVaultPath(dirname(file.path) ? `${dirname(file.path)}/${name}` : name);
        return this.renameDurably(owner, file, destination, moveOptions?.expectedVersion);
      },
      trashFile: async (file, trashOptions) => {
        if (trashOptions?.permanent) return {
          ok: false as const,
          diagnostic: failure("permission-denied", "Permanent deletion is not exposed by this host"),
        };
        return this.trashDurably(owner, file);
      },
      generateMarkdownLink: (file, linkOptions = {}) => {
        if (!file.valid) throw new RangeError("Cannot link to an invalid file reference");
        let target = file.extension.toLocaleLowerCase() === "md"
          ? file.path.slice(0, -(file.extension.length + 1))
          : file.path;
        if (linkOptions.subpath) target += linkOptions.subpath;
        const alias = linkOptions.alias ? `|${escapeLinkPart(linkOptions.alias)}` : "";
        return `${linkOptions.embed ? "!" : ""}[[${escapeLinkPart(target)}${alias}]]`;
      },
      processFrontmatter: (file, transform) => this.enqueueMutationResult(
        (context) => this.processFrontmatterDurablyNow(context, owner, file, transform),
        (error) => ({
          ok: false,
          diagnostic: this.reportHostFailure("Frontmatter transform was rejected", error),
        }),
      ),
    };
    return service;
  }

  private async moveFileDurablyNow(
    context: VaultMutationContext,
    owner: ResourceOwner,
    file: NexusAbstractFile,
    destination: VaultPath,
    expectedVersion: ContentVersion | undefined,
    updateLinks: boolean,
  ): Promise<ServiceResult<NexusAbstractFile>> {
    const oldPath = file.path;
    const moved = await this.renameDurablyNow(context, owner, file, destination, expectedVersion);
    if (!moved.ok || !updateLinks || !oldPath.toLocaleLowerCase().endsWith(".md")) return moved;

    for (const source of context.vault.listFiles()) {
      if (!source.path.toLocaleLowerCase().endsWith(".md")) continue;
      const current = await context.vault.read(source);
      const next = rewriteWikiLinks(current, oldPath, destination);
      if (next === current) continue;
      const updated = await this.writeDurablyNow(
        context,
        owner,
        source.path,
        next,
        "modify",
        source.version,
      );
      if (!updated.ok) return {
        ok: false,
        diagnostic: failure(
          "unsupported-operation",
          "File moved, but a Markdown reference update failed",
          undefined,
          { moved: true, failedFile: source.path },
        ),
      };
    }
    return moved;
  }

  private async processFrontmatterDurablyNow(
    context: VaultMutationContext,
    owner: ResourceOwner,
    file: NexusFile,
    transform: Parameters<FileManagerService["processFrontmatter"]>[1],
  ): Promise<ContentWriteResult> {
    let temporaryVault: MemoryVaultRuntime | null = null;
    try {
      if (!context.vault.ownsFile(file)) {
        return { ok: false, diagnostic: failure("file-invalid-reference", "Invalid Vault file reference") };
      }
      const expectedVersion = file.version;
      const source = await context.vault.read(file);
      temporaryVault = new MemoryVaultRuntime({ initialFiles: { [file.path]: source } });
      const temporaryFile = temporaryVault.getFileByPath(file.path);
      if (!temporaryFile) throw new Error("Temporary frontmatter file could not be created");
      const temporaryManager = new MemoryFileManagerRuntime({ vault: temporaryVault });
      const transformed = await temporaryManager.createService(owner).processFrontmatter(
        temporaryFile,
        transform,
      );
      if (!transformed.ok) {
        this.diagnostics.report(transformed.diagnostic);
        return transformed;
      }
      const next = await temporaryVault.read(temporaryFile);
      return this.writeDurablyNow(context, owner, file.path, next, "modify", expectedVersion);
    } catch (error) {
      const diagnostic = failure("callback-failed", "Frontmatter transform failed", error);
      this.diagnostics.report(diagnostic);
      return { ok: false, diagnostic };
    } finally {
      if (temporaryVault) await temporaryVault.dispose();
    }
  }

  private createResourceService(
    owner: ResourceOwner,
    registerResource: (resource: ManagedResource) => void,
  ): ResourceService {
    const service: ResourceService = {
      createResourceUrl: async (file) => {
        if (!this.currentVault.ownsFile(file)) {
          return { ok: false as const, diagnostic: failure("file-invalid-reference", "Invalid Vault file reference") };
        }
        const session = this.requireSession();
        try {
          const created = await this.bridge.vault.createResourceUrl(session.sessionId, file.path);
          let registration!: ElectronResourceRegistration;
          registration = new ElectronResourceRegistration(
            owner,
            file.id,
            created.url,
            created.registrationId,
            () => this.bridge.vault.revokeResourceUrl(session.sessionId, created.registrationId).then(() => undefined),
            () => this.resourceRegistrations.delete(registration),
          );
          this.resourceRegistrations.add(registration);
          try {
            registerResource(registration);
          } catch (error) {
            await registration.dispose();
            throw error;
          }
          return { ok: true as const, value: registration };
        } catch (error) {
          return { ok: false as const, diagnostic: this.reportHostFailure("Resource URL creation failed", error) };
        }
      },
    };
    return service;
  }

  private async confirmPluginChange(
    vault: MemoryVaultRuntime,
    owner: ResourceOwner,
    change: HostVaultChange,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly diagnostic: NexusDiagnostic }> {
    const operationId = asOperationId(change.operationId!);
    const origin: FileOperationOrigin = Object.freeze({
      kind: "plugin",
      pluginId: owner.pluginId,
      operationId,
    });
    const confirmed = await vault.confirmHostChange(change, origin);
    if (!confirmed.ok) {
      this.diagnostics.report(confirmed.diagnostic);
      return confirmed;
    }
    return { ok: true };
  }

  private async mergeWatchEvent(event: PluginVaultChangeEvent): Promise<void> {
    if (!this.acceptsDispatch || event.sessionId !== this.currentSession?.sessionId) return;
    if (event.operationId && this.pendingPluginOperations.has(event.operationId)) return;
    if (event.operationId && this.currentVault.hasOperation(event.operationId)) return;
    if (event.kind === "rescan") {
      await this.rescan();
      return;
    }
    const origin: FileOperationOrigin = Object.freeze({
      kind: event.origin,
      operationId: asOperationId(event.operationId ?? `watch:${++this.operationSequence}`),
    });
    let change: HostVaultChange;
    if (event.kind === "delete") {
      change = { type: "delete", path: event.path, operationId: origin.operationId };
      this.ipcVersions.delete(event.path);
    } else if (event.kind === "rename") {
      if (!event.oldPath) return;
      change = {
        type: "rename",
        path: event.oldPath,
        destination: event.path,
        operationId: origin.operationId,
      };
      const previous = this.ipcVersions.get(event.oldPath);
      this.ipcVersions.delete(event.oldPath);
      if (event.version ?? previous) this.ipcVersions.set(event.path, event.version ?? previous!);
    } else {
      const file = await this.bridge.vault.read(event.sessionId, event.path);
      change = {
        type: this.currentVault.getFileByPath(event.path) ? "modify" : "create",
        path: event.path,
        data: file.content,
        operationId: origin.operationId,
      };
      this.ipcVersions.set(event.path, file.version);
    }
    const result = await this.currentVault.confirmHostChange(change, origin);
    if (!result.ok) this.diagnostics.report(result.diagnostic);
  }

  private async rescan(): Promise<void> {
    const session = this.requireSession();
    const [files, nodes] = await Promise.all([
      this.bridge.vault.readAll(session.sessionId),
      this.bridge.vault.list(session.sessionId),
    ]);
    const paths = new Set(files.map((file) => file.path));
    const folderPaths = collectFolderPaths(nodes);
    for (const file of files) {
      let parent = dirname(file.path);
      while (parent) {
        folderPaths.add(parent);
        parent = dirname(parent);
      }
    }
    for (const existing of this.currentVault.listFiles()) {
      if (!paths.has(existing.path)) {
        await this.currentVault.confirmHostChange(
          { type: "delete", path: existing.path },
          { kind: "external", operationId: asOperationId(`rescan:${++this.operationSequence}`) },
        );
        this.ipcVersions.delete(existing.path);
      }
    }
    const existingFolders = this.collectCurrentFolderPaths()
      .sort((left, right) => right.split("/").length - left.split("/").length);
    for (const path of existingFolders) {
      if (folderPaths.has(path)) continue;
      const operationId = asOperationId(`rescan:${++this.operationSequence}`);
      const result = await this.currentVault.confirmHostChange(
        { type: "delete", path, operationId },
        { kind: "external", operationId },
      );
      if (!result.ok) this.diagnostics.report(result.diagnostic);
    }
    const missingFolders = [...folderPaths]
      .filter((path) => !this.currentVault.getFolderByPath(path))
      .sort((left, right) => left.split("/").length - right.split("/").length);
    for (const path of missingFolders) {
      const operationId = asOperationId(`rescan:${++this.operationSequence}`);
      const result = await this.currentVault.confirmHostChange(
        { type: "create-folder", path, operationId },
        { kind: "external", operationId },
      );
      if (!result.ok) this.diagnostics.report(result.diagnostic);
    }
    for (const file of files) {
      const existing = this.currentVault.getFileByPath(file.path);
      const current = existing ? await this.currentVault.read(existing) : null;
      this.ipcVersions.set(file.path, file.version);
      if (current === file.content) continue;
      const operationId = asOperationId(`rescan:${++this.operationSequence}`);
      const result = await this.currentVault.confirmHostChange(
        {
          type: existing ? "modify" : "create",
          path: file.path,
          data: file.content,
          operationId,
        },
        { kind: "external", operationId },
      );
      if (!result.ok) this.diagnostics.report(result.diagnostic);
    }
  }

  private collectCurrentFolderPaths(path = "" as VaultPath, output: string[] = []): string[] {
    for (const node of this.currentVault.childrenOf(path)) {
      if (node.kind !== "folder") continue;
      output.push(node.path);
      this.collectCurrentFolderPaths(node.path, output);
    }
    return output;
  }

  private dispatchKeyboardEvent(event: KeyboardEvent): void {
    if (!this.acceptsDispatch || event.defaultPrevented) return;
    const commandContext = Object.freeze({
      trigger: "hotkey" as const,
      editor: this.editorAttachment?.context ?? null,
    });
    const scopeResult = this.scopes.dispatchKeyboardEvent(event, commandContext);
    if (scopeResult.status !== "pass" || event.defaultPrevented) return;
    this.hotkeys.dispatchKeyboardEvent(event, commandContext);
  }

  private async performShutdown(
    destroyEditor?: () => void | Promise<void>,
    notifyHost = true,
  ): Promise<void> {
    const errors: unknown[] = [];
    this.acceptsDispatch = false;
    this.document.removeEventListener("keydown", this.keydownListener, true);
    const attempt = async (operation: () => void | Promise<void>) => {
      try { await operation(); } catch (error) { errors.push(error); }
    };
    await attempt(() => this.sessionLifecycleTail);
    await attempt(() => this.vaultOperationTail);
    await attempt(() => this.pluginManager.disableAll().then(() => undefined));
    for (const pluginId of [...this.configuredExternalPlugins]) {
      await attempt(() => this.revokeExternalPermissions(pluginId));
    }
    for (const attachment of this.markdownAttachments.reverse()) {
      await attempt(() => attachment.dispose());
    }
    this.markdownAttachments = [];
    if (this.editorAttachment) await attempt(() => this.editorAttachment!.detach());
    this.editorAttachment = null;
    await attempt(() => this.workspace.closeLeaf(this.leaf));
    if (destroyEditor) await attempt(destroyEditor);

    for (const registration of [...this.resourceRegistrations].reverse()) {
      await attempt(() => registration.dispose());
    }
    await attempt(() => this.markdownPostProcessors.dispose());
    await attempt(() => this.linkIndex.dispose());
    await attempt(() => this.currentMetadata.dispose());
    await attempt(() => this.currentVault.dispose());
    await attempt(() => this.storage.dispose());
    for (const provider of this.providers.reverse()) await attempt(() => provider.revoke("host-shutdown"));

    const session = this.currentSession;
    this.currentSession = null;
    if (session) await attempt(() => this.bridge.vault.close(session.sessionId).then(() => undefined));
    await attempt(() => this.unsubscribeVaultChanges());
    await attempt(() => this.unsubscribeHostShutdown());
    if (notifyHost) {
      await attempt(() => this.bridge.host.shutdownComplete().then(() => undefined));
    }
    if (errors.length > 0) throw new AggregateError(errors, "Plugin runtime host shutdown was not clean");
  }

  private createActionContext(): UiActionContext {
    const host = this;
    return Object.freeze({
      window: this.windowContext,
      get leaf() { return host.leaf; },
      get view() { return host.leaf.view; },
      get editor() { return host.editorAttachment?.context ?? null; },
      get file() { return host.workspace.getActiveFile(); },
      command: null,
    });
  }

  private enqueueVaultOperation<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.vaultOperationTail.then(operation, operation);
    this.vaultOperationTail = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private enqueueMutationResult<T>(
    operation: (context: VaultMutationContext) => Promise<T>,
    rejected: (error: unknown) => T,
  ): Promise<T> {
    if (!this.acceptsDispatch || this.shutdownPromise || this.sessionTransitionActive) {
      return Promise.resolve(rejected(new Error("Plugin runtime host is not accepting Vault mutations")));
    }
    return this.enqueueVaultOperation(async () => {
      if (!this.acceptsDispatch || this.shutdownPromise || this.sessionTransitionActive) {
        return rejected(new Error("Plugin runtime host is not accepting Vault mutations"));
      }
      const context = Object.freeze({
        session: this.requireSession(),
        vault: this.currentVault,
      });
      return operation(context);
    });
  }

  private requireSession(): PluginVaultSession {
    if (!this.currentSession) throw new Error("No Electron Vault session is open");
    return this.currentSession;
  }

  private nextOperationId(owner: ResourceOwner): string {
    return `renderer:${owner.pluginId}:${++this.operationSequence}`;
  }

  private contentFailure(message: string, error: unknown, file?: NexusFile | null): ContentWriteResult {
    const diagnostic = this.reportHostFailure(message, error);
    return {
      ok: false,
      diagnostic,
      ...(file ? { currentVersion: file.version } : {}),
    };
  }

  private reportHostFailure(message: string, error: unknown): NexusDiagnostic {
    const diagnostic = failure("unsupported-operation", message, error);
    this.diagnostics.report(diagnostic);
    return diagnostic;
  }
}

function denyPermissions(): PermissionDecisions {
  return Object.freeze({});
}

function isExternalNavigationPermission(permission: string): permission is PluginHostPermissionId {
  return permission === "host.external-url.https" ||
    permission === "host.external-protocol.mailto";
}

export function createPluginRuntimeHost(options: PluginRuntimeHostOptions): PluginRuntimeHost {
  return new ElectronPluginRuntimeHost(options);
}
