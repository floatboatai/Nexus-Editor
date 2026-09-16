export {
  RuntimeCapabilityRegistry,
  PluginCapabilityAccess,
  type CapabilityProviderOptions,
  type CapabilityProviderRegistration,
  type CapabilityRevocationContext,
  type OwnerBoundCapabilityContext,
  type OwnerBoundCapabilityFactory,
  type PermissionDecision,
  type PermissionDecisions,
} from "./capability";
export {
  PluginCompatibilityValidator,
  type CompatibilityApiPolicy,
  type PluginCompatibilityResult,
  type PluginCompatibilityValidatorOptions,
} from "./compatibility";
export {
  ClipboardPipeline,
  normalizeClipboardPayload,
  readClipboardPayload,
  type ClipboardFilterOutcome,
  type ClipboardPipelineOptions,
  type ClipboardTransferOptions,
  type ClipboardTransferResult,
  type ClipboardWriter,
} from "./clipboard-pipeline";
export {
  CommandRegistry,
  type CommandContextResolutionOptions,
  type CommandContextResolver,
  type CommandHotkeyCandidate,
  type CommandRegistryOptions,
  type CommandResourceRegistrar,
} from "./commands/command-registry";
export {
  HotkeyRegistry,
  MemoryHotkeyPreferenceStore,
  type HotkeyDispatchResult,
  type HotkeyPreferenceStore,
  type HotkeyRegistryOptions,
} from "./commands/hotkey-registry";
export {
  hotkeyToString,
  keyboardEventToHotkey,
  normalizeHotkeyBinding,
  normalizeSemanticHotkey,
  normalizeSemanticHotkeys,
  type HotkeyPlatform,
} from "./commands/hotkey-normalization";
export {
  ScopeRegistry,
  type ScopeDispatchResult,
  type ScopeRegistryOptions,
  type ScopeResourceRegistrar,
} from "./commands/scope-registry";
export {
  MemoryContentRuntime,
  type MemoryContentRuntimeOptions,
} from "./content/content-runtime";
export {
  MemoryFileManagerRuntime,
  type MemoryFileManagerOptions,
} from "./content/file-manager-runtime";
export {
  MemoryMetadataRuntime,
  type MemoryMetadataRuntimeOptions,
} from "./content/metadata-runtime";
export {
  VaultPathPolicy,
  normalizeVaultPath,
  type VaultPathAuthorization,
  type VaultPathAuthorizationResolver,
  type VaultPathPolicyOptions,
} from "./content/path-policy";
export {
  MemoryResourceRuntime,
  type MemoryResourceRuntimeOptions,
  type ResourceResolution,
} from "./content/resource-runtime";
export {
  MemoryVaultRuntime,
  createContentOwner,
  type HostVaultChange,
  type HostVaultChangeResult,
  type MemoryVaultRuntimeOptions,
  type VaultCommit,
} from "./content/vault-runtime";
export {
  DiagnosticBus,
  DiagnosticSanitizer,
  runPluginCallback,
  runPluginCallbackAsync,
  type DiagnosticBusOptions,
  type DiagnosticInput,
  type PluginCallbackBoundaryOptions,
} from "./diagnostics";
export {
  CancelableEventRegistry,
  TypedEventRegistry,
  type EventContractMap,
  type EventResourceRegistrar,
  type EventValidator,
  type TypedEventRegistryOptions,
} from "./events/typed-event-registry";
export * from "./editor-host-registry";
export {
  EditorTransactionPipeline,
  type EditorTransactionPipelineOptions,
} from "./editor-transaction-pipeline";
export {
  ComponentController,
  ComponentLifecycleRuntime,
  type ComponentControllerOptions,
  type ComponentUnloadResult,
} from "./lifecycle/component-controller";
export { LifecycleOperationError, PluginLoadError } from "./lifecycle/errors";
export {
  LifecycleRegistration,
  type LifecycleRegistrationOptions,
} from "./lifecycle/registration";
export {
  HostControlledPluginEntrypointLoader,
  TrustedPluginPackageLoader,
  type EntrypointLoadResult,
  type HostEntrypointLoadRequest,
  type HostPluginEntrypointResolver,
  type LoadedTrustedPlugin,
  type PluginEntrypointLoader,
  type RejectedTrustedPlugin,
  type TrustedPluginLoadResult,
  type TrustedPluginPackageCandidate,
  type TrustedPluginPackageLoaderOptions,
} from "./loader";
export {
  LegacyPluginAdapter,
  LegacyPluginRegistration,
  type LegacyPluginAdapterOptions,
  type LegacyPluginAdapterResult,
  type LegacyRemarkTransformPort,
  type LegacySlashCommandPort,
  type LegacyWidgetPort,
} from "./legacy-adapter";
export {
  PluginIdentityRegistry,
  normalizeAuthorManifest,
  normalizePluginId,
  type ManifestNormalizationResult,
  type PluginIdentityReservation,
  type PluginIdentityReservationResult,
  type RuntimeManifestHostFields,
} from "./manifest";
export {
  MarkdownPostProcessorRegistry,
  type MarkdownPostProcessorRegistryOptions,
  type MarkdownRenderCodeBlockOptions,
  type MarkdownRenderFragmentOptions,
  type MarkdownRenderHandle,
  type MarkdownRenderResult,
} from "./markdown/post-processor-registry";
export {
  RemarkTransformRegistry,
  type RemarkTransformRegistrationOptions,
  type RemarkTransformRegistryOptions,
} from "./markdown/remark-transform-registry";
export {
  WidgetRegistry,
  type WidgetRegistrationOptions,
  type WidgetRegistryOptions,
} from "./markdown/widget-registry";
export {
  MemoryPluginStorageBackend,
  PluginStorageRuntime,
  UnsupportedSecretStorage,
  type PluginStorageBackend,
  type PluginStorageBackendChange,
  type PluginStorageBackendReadResult,
  type PluginStorageBackendWriteResult,
  type PluginStorageRuntimeOptions,
} from "./storage";
export {
  PluginManager,
  type PluginDisableResult,
  type PluginDiscoveryResult,
  type PluginEnableResult,
  type PluginManagerOptions,
  type PluginManagerState,
  type PluginPackageLoader,
  type PluginRecordSnapshot,
} from "./plugin-manager";
export {
  RuntimeWorkspace,
  RuntimeWorkspaceLeaf,
  createRuntimeOwner,
  type RuntimeViewRegistration,
  type RuntimeWorkspaceLeafSnapshot,
  type RuntimeWorkspaceOptions,
  type RuntimeWorkspaceSnapshot,
  type RuntimeWorkspaceWindow,
  type WorkspaceResourceRegistrar,
} from "./workspace/runtime-workspace";
export {
  RuntimeUiHost,
  createWindowContext,
  type CommandPaletteRegistry,
  type HeadlessUiLogEntry,
  type RuntimeUiHostOptions,
  type UiResourceRegistrar,
  type UiSlotContext,
} from "./ui/runtime-ui";
export * from "./testkit";
