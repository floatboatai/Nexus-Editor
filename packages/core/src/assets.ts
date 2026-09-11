/** Authorized resource bytes shared by editors, conversion and static rendering. */
export interface AssetResource {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

export interface AssetReadOptions {
  readonly signal?: AbortSignal;
  readonly sourcePath?: string;
  readonly documentId?: string;
  readonly maxBytes?: number;
}

/** The provider owns authorization; resolving a reference never grants new access. */
export interface AssetProvider {
  read(source: string, options?: AssetReadOptions): Promise<AssetResource | null>;
}

export interface AssetUploadContext {
  readonly signal: AbortSignal;
  readonly operation: "paste" | "drop" | "api";
  readonly operationId: string;
}

export type AssetInputStatus = "uploading" | "inserted" | "failed" | "cancelled";

export interface AssetInputEvent {
  readonly operationId: string;
  readonly status: AssetInputStatus;
  readonly completed: number;
  readonly total: number;
  readonly code?: "upload-failed" | "invalid-reference" | "read-only" | "unsupported-target" | "target-changed";
}

export interface ManagedAssetInputOptions {
  readonly managed: true;
  readonly onEvent?: (event: AssetInputEvent) => void;
}

/** A target-specific bookmark; callers must dispose it after inserting or cancelling. */
export interface EditorInputBookmark {
  readonly signal?: AbortSignal;
  isValid(): boolean;
  replaceSelection(text: string): boolean;
  dispose(): void;
}
