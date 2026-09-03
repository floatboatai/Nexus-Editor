import type {
  EditorAPI,
  EditorContributionSink,
  EditorDomEventHook,
  EditorDomEventHookOptions,
  EditorDomEventMap,
  EditorDomEventType,
  EditorDestroyListener,
  EditorInputSurface,
  EditorInputTarget,
  EditorLifecycleContributionSink,
  SelectionState,
} from "@floatboat/nexus-core";
import type { NexusComponent } from "./component";
import type { NexusFile } from "./content";
import type { NexusDiagnostic } from "./diagnostics";
import type { TypedEvents } from "./events";
import type { EditorId, OperationId, VaultPath } from "./identifiers";
import type {
  ContributionRegistration,
  RegistrationResult,
  ServiceResult,
} from "./ownership";
import type { JsonObject } from "./json";
import type { NexusView, WindowContext, WorkspaceLeaf } from "./workspace";

export type {
  EditorAPI,
  EditorContributionSink,
  EditorDomEventHook,
  EditorDomEventHookContext,
  EditorDomEventHookOptions,
  EditorDomEventHookResult,
  EditorDomEventMap,
  EditorDomEventType,
  EditorDestroyListener,
  EditorInputSurface,
  EditorInputTarget,
  EditorLifecycleContributionSink,
} from "@floatboat/nexus-core";

export interface EditorSurfaceContext {
  readonly kind: EditorInputSurface;
  readonly id?: string;
  readonly root: HTMLElement;
}

export interface EditorInputTargetAdapter {
  readonly id: string;
  readonly kind: EditorInputSurface;
  getSelectedText(): string;
  replaceSelection(text: string): ServiceResult<void>;
  copySelection?(): ClipboardPayload;
}

export interface EditorContext {
  readonly editorId: EditorId;
  readonly editor: EditorAPI;
  readonly contributions: EditorContributionSink;
  readonly file: NexusFile | null;
  readonly sourcePath: VaultPath | null;
  readonly view: NexusView | null;
  readonly leaf: WorkspaceLeaf | null;
  readonly window: WindowContext | null;
  readonly surface: EditorSurfaceContext;
}

export interface EditorHostEventMap {
  readonly attached: EditorContext;
  readonly detached: { readonly editorId: EditorId };
  readonly contextChanged: EditorContext;
  readonly recentChanged: { readonly editor: EditorContext | null };
}

export type EditorExtension = Parameters<EditorContributionSink["registerExtension"]>[1];

export type EditorExtensionFactory = (context: EditorContext) => EditorExtension;

export interface EditorExtensionOptions {
  readonly id: string;
  readonly priority?: number;
  readonly matches?: (context: EditorContext) => boolean;
}

export interface EditorDomEventContext extends EditorContext {
  readonly inputTarget: EditorInputTargetAdapter | null;
  replaceTargetSelection(text: string): ServiceResult<void>;
}

export type EditorDomEventHandler<K extends EditorDomEventType = EditorDomEventType> = (
  event: EditorDomEventMap[K],
  context: EditorDomEventContext,
) => ReturnType<EditorDomEventHook<K>>;

export interface EditorHostService {
  readonly events: TypedEvents<EditorHostEventMap>;
  get(editorId: EditorId): EditorContext | undefined;
  list(): readonly EditorContext[];
  getRecent(): EditorContext | null;
  registerEditorExtension(
    extension: EditorExtension | EditorExtensionFactory,
    options: EditorExtensionOptions,
  ): RegistrationResult<ContributionRegistration>;
  registerDomEvent<K extends EditorDomEventType>(
    event: K,
    handler: EditorDomEventHandler<K>,
    options?: EditorDomEventHookOptions & {
      readonly matches?: (context: EditorContext) => boolean;
    },
  ): RegistrationResult<ContributionRegistration>;
  registerInputTarget(
    root: HTMLElement,
    target: EditorInputTargetAdapter,
    options?: { readonly editorId?: EditorId },
  ): RegistrationResult<ContributionRegistration>;
}

export interface ClipboardFileItem {
  readonly kind: "file";
  readonly type: string;
  readonly file: File;
}

export interface ClipboardStringItem {
  readonly kind: "string";
  readonly type: string;
  readonly value: string;
}

export type ClipboardPayloadItem = ClipboardFileItem | ClipboardStringItem;

export interface ClipboardPayload {
  readonly text: string | null;
  readonly html: string | null;
  readonly files: readonly File[];
  readonly items: readonly ClipboardPayloadItem[];
}

export type ClipboardFilterResult =
  | { readonly action: "pass" }
  | { readonly action: "reject"; readonly reason?: string }
  | { readonly action: "replace"; readonly payload: ClipboardPayload };

export type ClipboardDirection = "incoming" | "outgoing";
export type ClipboardOperation = "paste" | "drop" | "copy" | "cut";

export interface ClipboardFilterContext {
  readonly direction: ClipboardDirection;
  readonly operation: ClipboardOperation;
  readonly editor: EditorContext;
  readonly target: EditorInputTarget | null;
  readonly event: ClipboardEvent | DragEvent;
}

export type ClipboardFilter = (
  payload: ClipboardPayload,
  context: ClipboardFilterContext,
) => ClipboardFilterResult;

export interface ClipboardWriteResult {
  readonly status: "written" | "permission-denied" | "format-unsupported" | "failed";
  readonly diagnostic?: NexusDiagnostic;
}

export interface ClipboardService {
  registerFilter(
    operation: ClipboardOperation,
    filter: ClipboardFilter,
    options?: { readonly priority?: number; readonly surfaces?: readonly EditorInputSurface[] },
  ): RegistrationResult<ContributionRegistration>;
  write(payload: ClipboardPayload, context: EditorContext): Promise<ClipboardWriteResult>;
}

export interface EditorChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface EditorTransaction {
  readonly changes: readonly EditorChange[];
  readonly selectionBefore: SelectionState;
  readonly selectionAfter: SelectionState;
  readonly origin: readonly string[];
  readonly userEvent?: string;
  readonly operationId?: OperationId;
  readonly annotations?: JsonObject;
}

export interface EditorTransactionContext extends EditorContext {
  readonly transaction: EditorTransaction;
}

export type TransactionFilterResult =
  | { readonly action: "accept" }
  | { readonly action: "reject"; readonly diagnostic?: NexusDiagnostic }
  | { readonly action: "replace"; readonly transaction: EditorTransaction };

export type EditorTransactionFilter = (
  context: EditorTransactionContext,
) => TransactionFilterResult;

export interface EditorUpdateContext extends EditorContext {
  readonly transaction: EditorTransaction;
  readonly documentBefore: string;
  readonly documentAfter: string;
}

export interface EditorTransactionService {
  registerFilter(
    filter: EditorTransactionFilter,
    options?: { readonly priority?: number },
  ): RegistrationResult<ContributionRegistration>;
  registerUpdateListener(
    listener: (update: EditorUpdateContext) => void,
    options?: { readonly priority?: number },
  ): RegistrationResult<ContributionRegistration>;
  dispatch(
    editorId: EditorId,
    transaction: EditorTransaction,
  ): ServiceResult<{ readonly operationId: OperationId }>;
}

export interface MarkdownSectionInfo {
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

export interface MarkdownPostProcessorContext {
  readonly sourcePath: VaultPath | null;
  readonly documentId: string;
  readonly generation: number;
  readonly frontmatter: JsonObject | null;
  readonly signal: AbortSignal;
  getSectionInfo(element: HTMLElement): MarkdownSectionInfo | null;
  addChild(child: NexusComponent): Promise<NexusComponent>;
}

export type MarkdownPostProcessor = (
  element: HTMLElement,
  context: MarkdownPostProcessorContext,
) => void | Promise<void>;

export type MarkdownCodeBlockProcessor = (
  source: string,
  element: HTMLElement,
  context: MarkdownPostProcessorContext,
) => void | Promise<void>;

export interface MarkdownProcessorService {
  registerPostProcessor(
    processor: MarkdownPostProcessor,
    options?: { readonly sortOrder?: number },
  ): RegistrationResult<ContributionRegistration>;
  registerMarkdownCodeBlockProcessor(
    language: string,
    processor: MarkdownCodeBlockProcessor,
    options?: { readonly sortOrder?: number },
  ): RegistrationResult<ContributionRegistration>;
  /** Short alias for registerMarkdownCodeBlockProcessor. */
  registerCodeBlockProcessor(
    language: string,
    processor: MarkdownCodeBlockProcessor,
    options?: { readonly sortOrder?: number },
  ): RegistrationResult<ContributionRegistration>;
}

export interface EditorDomHookCatalog {
  readonly copy: EditorDomEventMap["copy"];
  readonly cut: EditorDomEventMap["cut"];
  readonly paste: EditorDomEventMap["paste"];
  readonly beforeinput: EditorDomEventMap["beforeinput"];
  readonly drop: EditorDomEventMap["drop"];
  readonly contextmenu: EditorDomEventMap["contextmenu"];
  readonly keydown: EditorDomEventMap["keydown"];
}
