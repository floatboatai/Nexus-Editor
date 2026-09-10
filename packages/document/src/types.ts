import type { AssetProvider, AssetResource, EditorDocumentSnapshot } from "@floatboat/nexus-core";
import type { Root } from "mdast";
import type { Root as HtmlRoot } from "hast";

export type { AssetProvider, AssetResource, AssetReadOptions } from "@floatboat/nexus-core";
export interface DocumentDiagnostic {
  readonly code: "unsafe-content" | "asset-unavailable" | "unsupported-content" | "conversion-warning" | "no-text-layer" | "password-required";
  readonly message: string;
  readonly source?: string;
  readonly page?: number;
}

/** Logical sources exist only inside this conversion artifact, never as file grants. */
export interface AssetPlanEntry {
  readonly source: string;
  readonly suggestedName: string;
  readonly resource: AssetResource | null;
  readonly originalSource?: string;
}

export interface ConversionResult {
  readonly markdown: string;
  readonly assetPlan: readonly AssetPlanEntry[];
  readonly diagnostics: readonly DocumentDiagnostic[];
}

export interface DocumentLimits {
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxAssetBytes?: number;
  readonly maxTotalAssetBytes?: number;
  readonly maxArchiveBytes?: number;
  readonly maxArchiveEntries?: number;
  readonly maxCompressionRatio?: number;
  readonly maxPages?: number;
  readonly maxNodes?: number;
  readonly timeoutMs?: number;
}

export interface ConversionOptions {
  readonly signal?: AbortSignal;
  readonly limits?: DocumentLimits;
  readonly sourcePath?: string;
  readonly documentId?: string;
  readonly assetProvider?: AssetProvider;
}

export interface BinaryConversionOptions {
  readonly executor: ConversionExecutor;
  readonly signal?: AbortSignal;
  readonly limits?: DocumentLimits;
  readonly password?: string;
}

export interface ConversionRequest {
  readonly format: "docx" | "pdf-text";
  readonly bytes: Uint8Array;
  readonly limits?: DocumentLimits;
  readonly password?: string;
}

/** Heavy conversions require an explicitly selected terminable executor. */
export interface ConversionExecutor {
  run(request: ConversionRequest, options?: { readonly signal?: AbortSignal }): Promise<ConversionResult>;
  dispose(): Promise<void>;
}

export interface StaticRenderContext {
  readonly signal: AbortSignal;
  readonly markdown: string;
  readonly documentId: string;
  readonly sourcePath?: string;
  readonly diagnostics: DocumentDiagnostic[];
  addCleanup(cleanup: () => void | Promise<void>): void;
}

export interface DocumentRenderContext extends StaticRenderContext {
  readonly document: Document;
}

/** Host-owned hooks are trusted code; resource and output policies still run afterwards. */
export interface DocumentRenderExtension {
  readonly remarkPlugins?: readonly import("unified").Plugin<[], Root, Root>[];
  transformHtml?(tree: HtmlRoot, context: StaticRenderContext): void | Promise<void>;
  render?(element: HTMLElement, context: DocumentRenderContext): void | Promise<void>;
}

export interface RenderDocumentOptions extends ConversionOptions {
  readonly document: Document;
  readonly title?: string;
  readonly styles?: readonly string[];
  readonly extensions?: readonly DocumentRenderExtension[];
  readonly resolveWikilink?: (target: string, sourcePath?: string) => string | null;
  readonly strictAssets?: boolean;
}

export type DocumentRenderInput = string | EditorDocumentSnapshot;

export interface DocumentRenderHandle {
  readonly element: HTMLElement;
  readonly ready: Promise<void>;
  readonly diagnostics: readonly DocumentDiagnostic[];
  dispose(): Promise<void>;
}

export interface HtmlArtifact {
  readonly html: string;
  readonly bytes: Uint8Array;
  readonly diagnostics: readonly DocumentDiagnostic[];
}
