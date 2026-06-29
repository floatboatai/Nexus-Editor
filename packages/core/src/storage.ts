export type NoteVaultNodeKind = "file" | "folder";

export interface NoteVaultRef {
  /** Stable within the adapter, e.g. "local-fs" or "dropbox". */
  providerId: string;
  /** Provider-owned identity: an absolute path, relative path, or opaque ID. */
  id: string;
  kind: NoteVaultNodeKind;
  name?: string;
  /** UI-friendly path. Hosts must not treat this as the only stable identity. */
  displayPath?: string;
  revision?: string;
  etag?: string;
  metadata?: Record<string, unknown>;
}

export interface NoteVaultFileRef extends NoteVaultRef {
  kind: "file";
}

export interface NoteVaultFolderRef extends NoteVaultRef {
  kind: "folder";
}

export type AnyNoteVaultRef = NoteVaultFileRef | NoteVaultFolderRef;

export interface NoteVaultNode {
  ref: AnyNoteVaultRef;
  name: string;
  kind: NoteVaultNodeKind;
  children?: NoteVaultNode[];
  revision?: string;
  etag?: string;
  displayPath?: string;
}

export interface NoteVaultFile {
  ref: NoteVaultFileRef;
  content: string;
  revision?: string;
  etag?: string;
}

export interface NoteVaultCapabilities {
  watch?: boolean;
  trash?: boolean;
  renameFile?: boolean;
  renameFolder?: boolean;
  createFile?: boolean;
  createFolder?: boolean;
  deleteFile?: boolean;
  deleteFolder?: boolean;
  optimisticWrites?: boolean;
  offline?: boolean;
}

export interface NoteVaultListOptions {
  root?: NoteVaultFolderRef;
  recursive?: boolean;
}

export interface NoteVaultWriteOptions {
  revision?: string;
  etag?: string;
}

export interface NoteVaultWriteResult {
  ref: NoteVaultFileRef;
  revision?: string;
  etag?: string;
}

export interface NoteVaultDeleteOptions {
  trash?: boolean;
}

export type NoteVaultChangeKind = "created" | "updated" | "deleted" | "renamed" | "refreshed";

export interface NoteVaultChangeEvent {
  kind: NoteVaultChangeKind;
  ref?: AnyNoteVaultRef;
  previousRef?: AnyNoteVaultRef;
}

export type NoteVaultErrorCode =
  | "unsupported-operation"
  | "auth-required"
  | "permission-denied"
  | "conflict"
  | "offline"
  | "not-found"
  | "invalid-ref"
  | "unknown";

export interface NoteVaultErrorDetails {
  ref?: AnyNoteVaultRef;
  operation?: string;
  cause?: unknown;
}

export class NoteVaultError extends Error {
  readonly code: NoteVaultErrorCode;
  readonly ref?: AnyNoteVaultRef;
  readonly operation?: string;
  readonly cause?: unknown;

  constructor(code: NoteVaultErrorCode, message: string, details: NoteVaultErrorDetails = {}) {
    super(message);
    this.name = "NoteVaultError";
    this.code = code;
    this.ref = details.ref;
    this.operation = details.operation;
    this.cause = details.cause;
  }
}

export function createNoteVaultError(
  code: NoteVaultErrorCode,
  message: string,
  details?: NoteVaultErrorDetails
): NoteVaultError {
  return new NoteVaultError(code, message, details);
}

export function isNoteVaultError(value: unknown): value is NoteVaultError {
  return value instanceof NoteVaultError;
}

export interface NoteVaultAdapter {
  readonly id: string;
  readonly label: string;
  readonly capabilities: NoteVaultCapabilities;
  list(options?: NoteVaultListOptions): Promise<NoteVaultNode[]>;
  readAll?(options?: NoteVaultListOptions): Promise<NoteVaultFile[]>;
  read(ref: NoteVaultRef): Promise<NoteVaultFile>;
  write(ref: NoteVaultRef, content: string, options?: NoteVaultWriteOptions): Promise<NoteVaultWriteResult>;
  createFile(parent: NoteVaultRef, name: string, content?: string): Promise<NoteVaultFileRef>;
  createFolder(parent: NoteVaultRef, name: string): Promise<NoteVaultFolderRef>;
  rename(ref: NoteVaultRef, name: string): Promise<AnyNoteVaultRef>;
  delete(ref: NoteVaultRef, options?: NoteVaultDeleteOptions): Promise<void>;
  watch?(listener: (event: NoteVaultChangeEvent) => void): () => void;
}

export interface NoteVaultReadAllOptions extends NoteVaultListOptions {
  onError?: (error: unknown, ref: NoteVaultFileRef) => void;
}

const DEFAULT_READ_ALL_CONCURRENCY = 32;

export function flattenNoteVaultNodes(nodes: readonly NoteVaultNode[]): AnyNoteVaultRef[] {
  const refs: AnyNoteVaultRef[] = [];
  for (const node of nodes) {
    refs.push(node.ref);
    if (node.children) refs.push(...flattenNoteVaultNodes(node.children));
  }
  return refs;
}

export async function readAllNoteVaultFiles(
  adapter: NoteVaultAdapter,
  options: NoteVaultReadAllOptions = {}
): Promise<NoteVaultFile[]> {
  const listOptions: NoteVaultListOptions = {
    root: options.root,
    recursive: options.recursive,
  };
  if (adapter.readAll) return adapter.readAll(listOptions);

  const nodes = await adapter.list(listOptions);
  const files = flattenNoteVaultNodes(nodes).filter((ref): ref is NoteVaultFileRef => ref.kind === "file");
  const out = new Array<NoteVaultFile | undefined>(files.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < files.length) {
      const index = cursor++;
      const ref = files[index];
      try {
        out[index] = await adapter.read(ref);
      } catch (err) {
        options.onError?.(err, ref);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(DEFAULT_READ_ALL_CONCURRENCY, files.length) }, worker));

  return out.filter((file): file is NoteVaultFile => file !== undefined);
}
