import type { AssetResource } from "@floatboat/nexus-core";
import type { DocumentTextFormat, TextEncoding } from "@floatboat/nexus-text-codec";
import type { AppendDocumentVersionResult, DocumentHistorySnapshot } from "@floatboat/nexus-document-history";
import type { VaultSessionId } from "./plugin-ipc";

export const PUBLIC_CAPABILITIES_CHANNEL = "nexus:public-capabilities";

export type PublicDocumentSource =
  | { readonly kind: "vault"; readonly sessionId: VaultSessionId; readonly path: string }
  | { readonly kind: "selected"; readonly id: string };

export interface PublicImportedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly source: PublicDocumentSource;
  readonly version: string;
}

export type PublicDocumentRead = {
  readonly name: string;
  readonly version: string;
} & (
  | { readonly status: "decoded"; readonly text: string; readonly format: DocumentTextFormat }
  | { readonly status: "needs-encoding"; readonly candidates: readonly TextEncoding[]; readonly reason: string }
);

export interface PublicSaveAsset extends AssetResource {
  readonly source: string;
  readonly suggestedName: string;
}

export interface PublicDocumentSaveRequest {
  readonly source: PublicDocumentSource | null;
  readonly name?: string;
  readonly markdown: string;
  readonly format: DocumentTextFormat;
  /** Existing resources require their original byte version; absent means a new target. */
  readonly expectedVersion?: string;
  readonly assets?: readonly PublicSaveAsset[];
  readonly history: boolean;
}

export interface PublicDocumentSaved {
  readonly source: PublicDocumentSource;
  readonly name: string;
  readonly markdown: string;
  readonly format: DocumentTextFormat;
  readonly version: string;
  readonly historyWarning?: string;
}

export interface PublicHistoryState {
  readonly documentKey: string;
  readonly snapshot: DocumentHistorySnapshot;
  readonly head: string | null;
}

export interface PublicSearchDocumentOptions {
  readonly includeContent?: boolean;
  readonly encoding?: TextEncoding;
}

export type PublicSearchDocumentInspection =
  | {
      readonly status: "available";
      readonly name: string;
      readonly size: number;
      /** A metadata observation token, never a disk-save CAS version. */
      readonly metadataVersion: string;
      readonly document?: Extract<PublicDocumentRead, { readonly status: "decoded" }>;
    }
  | {
      readonly status: "unavailable";
      readonly name: string;
      readonly code: "missing" | "unreadable" | "changed" | "too-large" | "encoding-required";
      readonly message: string;
    };

/** Main-owned public capability operations. No absolute path or arbitrary file API crosses preload. */
export interface PublicCapabilitiesBridge {
  pickImport(): Promise<PublicImportedFile | null>;
  readDocument(source: PublicDocumentSource, encoding?: TextEncoding): Promise<PublicDocumentRead>;
  /** Optional on older hosts. The default request inspects metadata without reading text. */
  inspectSearchDocument?(source: PublicDocumentSource, options?: PublicSearchDocumentOptions): Promise<PublicSearchDocumentInspection>;
  readAsset(source: PublicDocumentSource, reference: string): Promise<AssetResource | null>;
  grantResourceDirectory(source: PublicDocumentSource): Promise<boolean>;
  saveDocument(request: PublicDocumentSaveRequest): Promise<PublicDocumentSaved | null>;
  history(source: PublicDocumentSource): Promise<PublicHistoryState>;
  appendHistory(source: PublicDocumentSource, record: {
    readonly markdown: string;
    readonly reason: "checkpoint" | "before-restore";
    readonly label?: string;
  }, expectedHead?: string | null): Promise<AppendDocumentVersionResult>;
  exportHtml(artifact: { readonly bytes: Uint8Array; readonly name: string }): Promise<boolean>;
  cancelShutdown(): Promise<void>;
}

export type PublicCapabilitiesRequest =
  | { readonly operation: "pick-import" }
  | { readonly operation: "read"; readonly source: PublicDocumentSource; readonly encoding?: TextEncoding }
  | { readonly operation: "inspect-search-document"; readonly source: PublicDocumentSource; readonly includeContent?: boolean; readonly encoding?: TextEncoding }
  | { readonly operation: "asset"; readonly source: PublicDocumentSource; readonly reference: string }
  | { readonly operation: "grant-resource-directory"; readonly source: PublicDocumentSource }
  | { readonly operation: "save"; readonly request: PublicDocumentSaveRequest }
  | { readonly operation: "history"; readonly source: PublicDocumentSource }
  | { readonly operation: "append-history"; readonly source: PublicDocumentSource;
      readonly record: Parameters<PublicCapabilitiesBridge["appendHistory"]>[1]; readonly expectedHead?: string | null }
  | { readonly operation: "export-html"; readonly bytes: Uint8Array; readonly name: string }
  | { readonly operation: "cancel-shutdown" };
