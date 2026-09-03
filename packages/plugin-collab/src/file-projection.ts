import type { DocumentId, Unsubscribe } from "./types";

declare const fileIdBrand: unique symbol;

/** Host-scoped identity that survives a supported file rename. */
export type FileId = string & { readonly [fileIdBrand]: true };

export function asFileId(value: string): FileId {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 256) {
    throw new TypeError("FileId must contain between 1 and 256 characters");
  }
  return normalized as FileId;
}

export interface FileProjectionRef {
  readonly id: FileId;
  readonly path: string;
}

export interface CollaborativeMarkdownSnapshot {
  /** Canonical LF Markdown. */
  readonly markdown: string;
  /** Opaque revision suitable for compare-before-replace within this document handle. */
  readonly revision: string;
}

export type FileProjectionReplacementOrigin = "external-file" | "file-conflict-resolution";

/** Small seam the collaboration Engine implements for File Projection. */
export interface CollaborativeMarkdownPort {
  readonly id: DocumentId;
  getMarkdownSnapshot(): CollaborativeMarkdownSnapshot | undefined;
  replaceMarkdown(
    markdown: string,
    options: { readonly origin: FileProjectionReplacementOrigin; readonly expectedRevision: string },
  ): Promise<CollaborativeMarkdownSnapshot>;
  subscribeMarkdown(listener: (snapshot: CollaborativeMarkdownSnapshot) => void): Unsubscribe;
}

export interface FileSnapshot {
  readonly markdown: string;
  readonly version: string;
  /** Optional Host-propagated token. Hash/version matching remains the fallback. */
  readonly echoToken?: string;
}

export interface FileWriteOptions {
  /** Null means the target is expected not to exist. */
  readonly expectedVersion: string | null;
  readonly echoToken: string;
}

export interface FileWriteReceipt {
  readonly version: string;
  readonly echoToken: string;
}

export type ExternalFileChange =
  | { readonly kind: "changed" | "replaced"; readonly snapshot?: FileSnapshot }
  | { readonly kind: "deleted" }
  | { readonly kind: "renamed"; readonly file: FileProjectionRef; readonly snapshot?: FileSnapshot };

export interface FileWatchLease {
  dispose(): Promise<void>;
}

/** Host adapter: all writes must be atomic compare-before-replace operations. */
export interface FileProjectionAdapter {
  read(file: FileProjectionRef): Promise<FileSnapshot | null>;
  writeAtomic(
    file: FileProjectionRef,
    markdown: string,
    options: FileWriteOptions,
  ): Promise<FileWriteReceipt>;
  watch(
    file: FileProjectionRef,
    listener: (change: ExternalFileChange) => void,
  ): Promise<FileWatchLease>;
}

export interface ProjectionBase {
  /** Canonical LF Markdown agreed by both sides. */
  readonly markdown: string;
  readonly contentHash: string;
  readonly documentRevision: string;
  readonly fileVersion: string;
  readonly writeReceipt?: string;
}

export interface ProjectionMetadataRecord {
  readonly file: FileProjectionRef;
  readonly documentId: DocumentId;
  readonly base: ProjectionBase | null;
}

export interface ProjectionMetadataEntry {
  readonly record: ProjectionMetadataRecord;
  readonly revision: string;
}

/** Durable Host seam for FileId to DocumentId identity and Projection Base. */
export interface ProjectionMetadataStore {
  load(fileId: FileId): Promise<ProjectionMetadataEntry | null>;
  save(
    record: ProjectionMetadataRecord,
    expectedRevision: string | null,
  ): Promise<ProjectionMetadataEntry>;
  /**
   * Removes only the exact record/revision previously loaded by the caller.
   * Missing data is idempotent; any different live entry is a metadata conflict.
   */
  delete(record: ProjectionMetadataRecord, expectedRevision: string): Promise<boolean>;
}

export interface MarkdownFilePolicy {
  readonly lineEnding?: "lf" | "crlf" | "preserve";
  readonly finalNewline?: "preserve" | "always" | "never";
}

export type FileProjectionStatus =
  | "opening"
  | "clean"
  | "dirty"
  | "missing"
  | "conflicted"
  | "failed"
  | "closed";

export interface FileProjectionConflict {
  readonly id: string;
  readonly reason: "no-base" | "overlapping-edits" | "read-only" | "stale-version";
  readonly base: string | null;
  readonly live: CollaborativeMarkdownSnapshot;
  readonly incoming: FileSnapshot;
  readonly hunks: readonly MarkdownConflictHunk[];
}

export interface FileProjectionDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly documentId: DocumentId;
  readonly fileId: FileId;
  readonly cause?: unknown;
}

export interface FileProjectionSnapshot {
  readonly documentId: DocumentId;
  readonly file: FileProjectionRef;
  readonly projection: FileProjectionStatus;
  readonly base?: ProjectionBase;
  readonly conflict?: FileProjectionConflict;
  readonly diagnostic?: FileProjectionDiagnostic;
}

export type FileConflictResolution =
  | { readonly conflictId: string; readonly choice: "use-live" }
  | { readonly conflictId: string; readonly choice: "use-disk" }
  | { readonly conflictId: string; readonly choice: "manual"; readonly markdown: string };

export interface FileProjectionHandle {
  readonly closed: boolean;
  getState(): FileProjectionSnapshot;
  subscribe(listener: (snapshot: FileProjectionSnapshot) => void): Unsubscribe;
  flush(): Promise<void>;
  /** Waits for watcher work already queued without forcing the debounce timer. */
  settle(): Promise<void>;
  move(file: FileProjectionRef): Promise<void>;
  resolve(resolution: FileConflictResolution): Promise<void>;
  close(): Promise<void>;
}

export interface FileProjectionAttachOptions {
  readonly mode: "enroll" | "resume";
  readonly file: FileProjectionRef;
  readonly document: CollaborativeMarkdownPort;
  readonly policy?: MarkdownFilePolicy;
  /**
   * Whether disk/manual content may replace the collaborative document.
   * Evaluated for every operation so a Host can reflect authorization changes.
   * Defaults to true for direct controller use.
   */
  readonly canApplyToDocument?: () => boolean;
}

export interface FileProjectionControllerOptions {
  readonly files: FileProjectionAdapter;
  readonly metadata: ProjectionMetadataStore;
  readonly debounceMs?: number;
  readonly diagnostics?: (diagnostic: FileProjectionDiagnostic) => void;
  readonly createEchoToken?: () => string;
}

export interface FileProjectionController {
  attach(options: FileProjectionAttachOptions): Promise<FileProjectionHandle>;
  close(): Promise<void>;
}

export type FileProjectionErrorCode =
  | "controller-closed"
  | "projection-closed"
  | "projection-conflict"
  | "projection-already-attached"
  | "identity-not-enrolled"
  | "identity-collision"
  | "document-not-ready"
  | "stale-conflict"
  | "file-watch-failed"
  | "file-write-failed"
  | "metadata-write-failed";

export class FileProjectionError extends Error {
  constructor(
    readonly code: FileProjectionErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FileProjectionError";
  }
}

/** Result of reconciling a durable Markdown projection with the live document. */
export type MarkdownProjectionReconciliation =
  | {
      readonly kind: "clean";
      readonly reason: "unchanged" | "already-equal";
      readonly markdown: string;
    }
  | {
      readonly kind: "applied";
      readonly source: "live" | "incoming" | "merge";
      readonly applyTo: "file" | "live" | "both";
      readonly markdown: string;
    }
  | {
      readonly kind: "conflict";
      readonly base: string;
      readonly live: string;
      readonly incoming: string;
      readonly hunks: readonly MarkdownConflictHunk[];
    }
  | {
      readonly kind: "no-base";
      readonly live: string;
      readonly incoming: string;
    };

export interface MarkdownConflictHunk {
  /** Zero-based, half-open line range in `base`. */
  readonly baseStartLine: number;
  readonly baseEndLine: number;
  readonly base: string;
  readonly live: string;
  readonly incoming: string;
}

export interface MarkdownProjectionInputs {
  readonly base: string | null;
  readonly live: string;
  readonly incoming: string;
}

interface LineEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: readonly string[];
}

const MAX_LCS_CELLS = 4_000_000;
const MAX_METADATA_CONFLICT_RETRIES = 8;

function errorHasCode(cause: unknown, code: string): boolean {
  const seen = new Set<unknown>();
  let current = cause;
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (Reflect.get(current, "code") === code) return true;
    current = Reflect.get(current, "cause");
  }
  return false;
}

function lineEdits(base: readonly string[], variant: readonly string[]): LineEdit[] {
  const width = variant.length + 1;
  if ((base.length + 1) * width > MAX_LCS_CELLS) {
    let prefix = 0;
    while (prefix < base.length && prefix < variant.length && base[prefix] === variant[prefix]) prefix++;
    let baseSuffix = base.length;
    let variantSuffix = variant.length;
    while (
      baseSuffix > prefix &&
      variantSuffix > prefix &&
      base[baseSuffix - 1] === variant[variantSuffix - 1]
    ) {
      baseSuffix--;
      variantSuffix--;
    }
    return prefix === baseSuffix && prefix === variantSuffix
      ? []
      : [{ start: prefix, end: baseSuffix, replacement: variant.slice(prefix, variantSuffix) }];
  }

  const lcs = new Uint32Array((base.length + 1) * width);
  for (let left = base.length - 1; left >= 0; left--) {
    for (let right = variant.length - 1; right >= 0; right--) {
      const index = left * width + right;
      lcs[index] = base[left] === variant[right]
        ? 1 + lcs[(left + 1) * width + right + 1]!
        : Math.max(lcs[(left + 1) * width + right]!, lcs[index + 1]!);
    }
  }

  const edits: LineEdit[] = [];
  let left = 0;
  let right = 0;
  let start = -1;
  let replacement: string[] = [];
  const flush = () => {
    if (start < 0) return;
    edits.push({ start, end: left, replacement });
    start = -1;
    replacement = [];
  };
  while (left < base.length || right < variant.length) {
    if (left < base.length && right < variant.length && base[left] === variant[right]) {
      flush();
      left++;
      right++;
      continue;
    }
    if (start < 0) start = left;
    const deleteScore = left < base.length ? lcs[(left + 1) * width + right]! : -1;
    const insertScore = right < variant.length ? lcs[left * width + right + 1]! : -1;
    if (left < base.length && deleteScore >= insertScore) {
      left++;
    } else if (right < variant.length) {
      replacement.push(variant[right]!);
      right++;
    }
  }
  flush();
  return edits;
}

function sameEdit(left: LineEdit, right: LineEdit): boolean {
  return left.start === right.start &&
    left.end === right.end &&
    left.replacement.length === right.replacement.length &&
    left.replacement.every((line, index) => line === right.replacement[index]);
}

function editsConflict(left: LineEdit, right: LineEdit): boolean {
  if (sameEdit(left, right)) return false;
  const leftInsertion = left.start === left.end;
  const rightInsertion = right.start === right.end;
  if (leftInsertion && rightInsertion) return left.start === right.start;
  if (leftInsertion) return left.start > right.start && left.start < right.end;
  if (rightInsertion) return right.start > left.start && right.start < left.end;
  return Math.max(left.start, right.start) < Math.min(left.end, right.end);
}

function applyLineEdits(base: readonly string[], edits: readonly LineEdit[]): string[] {
  const result = [...base];
  const unique = edits.filter((edit, index) => edits.findIndex((candidate) => sameEdit(candidate, edit)) === index);
  unique.sort((left, right) => right.start - left.start || right.end - left.end);
  for (const edit of unique) result.splice(edit.start, edit.end - edit.start, ...edit.replacement);
  return result;
}

function renderConflictSide(
  base: readonly string[],
  start: number,
  end: number,
  edits: readonly LineEdit[],
): string {
  const relevant = edits.filter((edit) => {
    if (start === end) return edit.start === start && edit.end === end;
    if (edit.start === edit.end) return edit.start >= start && edit.start <= end;
    return edit.start < end && edit.end > start;
  });
  const region = base.slice(start, end);
  const relative = relevant.map((edit) => ({
    start: Math.max(0, edit.start - start),
    end: Math.max(0, edit.end - start),
    replacement: edit.replacement,
  }));
  return applyLineEdits(region, relative).join("\n");
}

function mergeLines(
  baseMarkdown: string,
  liveMarkdown: string,
  incomingMarkdown: string,
): { readonly markdown?: string; readonly conflicts: readonly MarkdownConflictHunk[] } {
  const base = baseMarkdown.split("\n");
  const liveEdits = lineEdits(base, liveMarkdown.split("\n"));
  const incomingEdits = lineEdits(base, incomingMarkdown.split("\n"));
  const ranges: Array<{ start: number; end: number }> = [];

  for (const liveEdit of liveEdits) {
    for (const incomingEdit of incomingEdits) {
      if (!editsConflict(liveEdit, incomingEdit)) continue;
      ranges.push({
        start: Math.min(liveEdit.start, incomingEdit.start),
        end: Math.max(liveEdit.end, incomingEdit.end),
      });
    }
  }

  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  const mergedRanges: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const previous = mergedRanges.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else mergedRanges.push({ ...range });
  }

  if (mergedRanges.length > 0) {
    return {
      conflicts: mergedRanges.map(({ start, end }) => ({
        baseStartLine: start,
        baseEndLine: end,
        base: base.slice(start, end).join("\n"),
        live: renderConflictSide(base, start, end, liveEdits),
        incoming: renderConflictSide(base, start, end, incomingEdits),
      })),
    };
  }

  return {
    markdown: applyLineEdits(base, [...liveEdits, ...incomingEdits]).join("\n"),
    conflicts: [],
  };
}

/**
 * Pure, direction-aware part of File Projection reconciliation.
 *
 * Text is canonicalised to LF before comparison because Collaborative Documents
 * store LF; the Host's line-ending policy is applied only when writing a file.
 */
export function reconcileMarkdownProjection(
  inputs: MarkdownProjectionInputs,
): MarkdownProjectionReconciliation {
  const live = normalizeMarkdown(inputs.live);
  const incoming = normalizeMarkdown(inputs.incoming);
  const base = inputs.base === null ? null : normalizeMarkdown(inputs.base);

  if (base === null) {
    return live === incoming
      ? { kind: "clean", reason: "already-equal", markdown: live }
      : { kind: "no-base", live, incoming };
  }
  if (live === incoming) {
    return {
      kind: "clean",
      reason: live === base ? "unchanged" : "already-equal",
      markdown: live,
    };
  }
  if (incoming === base) {
    return { kind: "applied", source: "live", applyTo: "file", markdown: live };
  }
  if (live === base) {
    return { kind: "applied", source: "incoming", applyTo: "live", markdown: incoming };
  }

  const merged = mergeLines(base, live, incoming);
  if (merged.markdown !== undefined) {
    return { kind: "applied", source: "merge", applyTo: "both", markdown: merged.markdown };
  }

  return {
    kind: "conflict",
    base,
    live,
    incoming,
    hunks: merged.conflicts,
  };
}

export function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

export function hashMarkdown(markdown: string): string {
  const canonical = normalizeMarkdown(markdown);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < canonical.length; index++) {
    const value = canonical.charCodeAt(index);
    first = Math.imul(first ^ value, 0x01000193) >>> 0;
    second = Math.imul(second ^ value, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function fileMarkdown(markdown: string, policy: MarkdownFilePolicy, preservedEnding: "lf" | "crlf"): string {
  let result = normalizeMarkdown(markdown);
  if (policy.finalNewline === "always" && !result.endsWith("\n")) result += "\n";
  if (policy.finalNewline === "never") result = result.replace(/\n+$/, "");
  const ending = policy.lineEnding === "crlf"
    ? "crlf"
    : policy.lineEnding === "lf"
      ? "lf"
      : preservedEnding;
  return ending === "crlf" ? result.replace(/\n/g, "\r\n") : result;
}

/**
 * Removes only the final-newline transformation owned by the projection policy.
 * A forcing policy makes that one bit of file syntax unable to express a
 * collaborative edit, so the last agreed collaborative value is the authority
 * for whether the policy-added/removed newline belongs in the document.
 */
function collaborativeMarkdownFromFile(
  markdown: string,
  base: string,
  policy: MarkdownFilePolicy,
): string {
  let result = normalizeMarkdown(markdown);
  const canonicalBase = normalizeMarkdown(base);
  if (policy.finalNewline === "always" && !canonicalBase.endsWith("\n") && result.endsWith("\n")) {
    result = result.slice(0, -1);
  }
  if (policy.finalNewline === "never" && !result.endsWith("\n")) {
    result += canonicalBase.match(/\n+$/)?.[0] ?? "";
  }
  return result;
}

function observedLineEnding(markdown: string): "lf" | "crlf" {
  return markdown.includes("\r\n") ? "crlf" : "lf";
}

interface ProjectionWatchRegistration {
  readonly file: FileProjectionRef;
  lease: FileWatchLease | null;
  status: "preparing" | "active" | "retired";
  readonly pending: ExternalFileChange[];
}

class FileProjection implements FileProjectionHandle {
  private state: FileProjectionSnapshot;
  private metadataEntry: ProjectionMetadataEntry | null = null;
  private watchRegistration: ProjectionWatchRegistration | null = null;
  private retiredWatchLeases = new Set<FileWatchLease>();
  private stopDocument: Unsubscribe | null = null;
  private listeners = new Set<(snapshot: FileProjectionSnapshot) => void>();
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isClosed = false;
  private closePromise: Promise<void> | null = null;
  private applyingFile = false;
  private conflictSequence = 0;
  private preservedEnding: "lf" | "crlf" = "lf";
  private echoLedger = new Map<string, { version: string; contentHash: string }>();
  private observedDocument: CollaborativeMarkdownSnapshot | null = null;

  constructor(
    private readonly owner: FileProjectionControllerImpl,
    private file: FileProjectionRef,
    private readonly document: CollaborativeMarkdownPort,
    private readonly mode: "enroll" | "resume",
    private readonly policy: MarkdownFilePolicy,
    private readonly canApplyToDocument: () => boolean,
  ) {
    this.state = { documentId: document.id, file, projection: "opening" };
  }

  get closed(): boolean {
    return this.isClosed;
  }

  async initialize(): Promise<void> {
    const loaded = await this.loadCurrentMetadata();
    if (!loaded) {
      if (this.mode === "resume") {
        throw new FileProjectionError(
          "identity-not-enrolled",
          `File ${this.file.id} has no persisted collaboration enrollment`,
        );
      }
      this.metadataEntry = await this.saveMetadata({
        file: this.file,
        documentId: this.document.id,
        base: null,
      }, null);
    } else {
      if (loaded.record.documentId !== this.document.id) {
        throw new FileProjectionError(
          "identity-collision",
          `File ${this.file.id} is enrolled with a different Collaborative Document`,
        );
      }
      this.metadataEntry = loaded;
      if (loaded.record.file.path !== this.file.path) {
        this.metadataEntry = await this.saveMetadata({ ...loaded.record, file: this.file }, loaded.revision);
      }
    }

    const initialLive = this.requireLive();
    this.observedDocument = initialLive;
    this.stopDocument = this.document.subscribeMarkdown((snapshot) => this.onDocumentChange(snapshot));
    const watchRegistration = await this.prepareWatch(this.file);
    // The watcher is already observing, but remains in `preparing` so changes
    // are buffered until the initial read/reconcile establishes one ordered
    // Projection Base. Activating it earlier would let a rename change
    // `this.file` while the old-path read is still in flight.
    this.watchRegistration = watchRegistration;
    await this.enqueue(async () => {
      const disk = await this.owner.options.files.read(this.file);
      if (!disk) {
        if (this.metadataEntry!.record.base === null && this.mode === "enroll") {
          const live = this.requireLive();
          await this.writeLive(live, null);
        } else {
          this.setState({ projection: "missing" });
        }
      } else {
        this.preservedEnding = observedLineEnding(disk.markdown);
        await this.reconcile(disk, MAX_METADATA_CONFLICT_RETRIES, initialLive);
      }
    }, true);
    this.activateWatch(watchRegistration);
  }

  getState(): FileProjectionSnapshot {
    return this.state;
  }

  subscribe(listener: (snapshot: FileProjectionSnapshot) => void): Unsubscribe {
    this.assertOpen();
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async flush(): Promise<void> {
    this.assertOpen();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.enqueue(async () => {
      if (this.getState().projection === "conflicted") {
        throw new FileProjectionError("projection-conflict", "Resolve the File Conflict before projecting");
      }
      const disk = await this.owner.options.files.read(this.file);
      if (!disk) {
        await this.writeLive(this.requireLive(), null);
        return;
      }
      await this.reconcile(disk);
      if (this.getState().projection === "conflicted") {
        throw new FileProjectionError("projection-conflict", "Resolve the File Conflict before projecting");
      }
    }, true);
  }

  async settle(): Promise<void> {
    await this.queue;
  }

  async move(file: FileProjectionRef): Promise<void> {
    this.assertOpen();
    if (file.id !== this.file.id) {
      throw new FileProjectionError("identity-collision", "A rename must preserve FileId");
    }
    await this.enqueue(() => this.applyRename(file), true);
  }

  async resolve(resolution: FileConflictResolution): Promise<void> {
    this.assertOpen();
    await this.enqueue(async () => {
      const conflict = this.state.conflict;
      if (!conflict || this.state.projection !== "conflicted") {
        throw new FileProjectionError("projection-conflict", "There is no active File Conflict");
      }
      if (conflict.id !== resolution.conflictId) {
        throw new FileProjectionError("stale-conflict", "The File Conflict changed before it was resolved");
      }
      const disk = await this.owner.options.files.read(this.file);
      if (!disk || disk.version !== conflict.incoming.version) {
        if (disk) this.enterConflict(this.requireLive(), disk);
        else this.setState({ projection: "missing", conflict: undefined });
        throw new FileProjectionError("stale-conflict", "The Markdown file changed before resolution");
      }
      const currentLive = this.requireLive();
      if (
        currentLive.revision !== conflict.live.revision ||
        currentLive.markdown !== normalizeMarkdown(conflict.live.markdown)
      ) {
        this.enterConflict(currentLive, disk);
        throw new FileProjectionError(
          "stale-conflict",
          "The Collaborative Document changed before resolution",
        );
      }

      if (resolution.choice === "use-live") {
        await this.writeLive(currentLive, disk.version);
        return;
      }
      if (!this.isDocumentReplacementAllowed()) {
        throw new FileProjectionError(
          "projection-conflict",
          "This participant cannot replace the collaborative document from a Markdown file",
        );
      }
      if (resolution.choice === "use-disk") {
        const markdown = conflict.base === null
          ? normalizeMarkdown(disk.markdown)
          : collaborativeMarkdownFromFile(disk.markdown, conflict.base, this.policy);
        await this.applyIncoming({ ...disk, markdown }, conflict.live.revision);
        return;
      }

      const markdown = normalizeMarkdown(resolution.markdown);
      this.applyingFile = true;
      try {
        const applied = await this.document.replaceMarkdown(markdown, {
          origin: "file-conflict-resolution",
          expectedRevision: conflict.live.revision,
        });
        await this.writeLive(applied, disk.version);
      } finally {
        this.applyingFile = false;
      }
    }, true);
  }

  close(): Promise<void> {
    this.closePromise ??= this.performClose();
    return this.closePromise;
  }

  private async performClose(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    const failures: unknown[] = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const stopDocument = this.stopDocument;
    this.stopDocument = null;
    if (stopDocument) {
      try {
        stopDocument();
      } catch (cause) {
        failures.push(cause);
      }
    }
    if (this.watchRegistration) this.deactivateWatch(this.watchRegistration);
    await this.queue.catch((cause) => { failures.push(cause); });
    const watchRegistration = this.watchRegistration;
    this.watchRegistration = null;
    if (watchRegistration) {
      this.deactivateWatch(watchRegistration);
      if (watchRegistration.lease) this.retiredWatchLeases.add(watchRegistration.lease);
    }
    const watchLeases = [...this.retiredWatchLeases];
    this.retiredWatchLeases.clear();
    const disposeResults = await Promise.allSettled(watchLeases.map((lease) => lease.dispose()));
    this.setState({ projection: "closed", conflict: undefined });
    this.listeners.clear();
    this.owner.release(this.file.id, this.document.id, this);
    failures.push(...disposeResults.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    ));
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, `File Projection cleanup failed for ${this.file.id}`);
    }
  }

  private requireLive(): CollaborativeMarkdownSnapshot {
    const live = this.document.getMarkdownSnapshot();
    if (!live) {
      throw new FileProjectionError("document-not-ready", "Collaborative Markdown is not ready for projection");
    }
    return { markdown: normalizeMarkdown(live.markdown), revision: live.revision };
  }

  private async onFileChange(change: ExternalFileChange): Promise<void> {
    if (this.isClosed) return;
    if (change.kind === "deleted") {
      this.setState({ projection: "missing", conflict: undefined, diagnostic: undefined });
      return;
    }
    if (change.kind === "renamed") {
      if (change.file.id !== this.file.id) {
        throw new FileProjectionError("identity-collision", "Watcher rename changed FileId");
      }
      await this.applyRename(change.file);
    }
    // Watcher payloads are observations, not an authority: a delayed payload
    // may describe an older version than the file currently on disk.
    const snapshot = await this.owner.options.files.read(this.file);
    if (!snapshot) {
      this.setState({ projection: "missing", conflict: undefined });
      return;
    }
    if (this.isSelfWrite(snapshot)) return;
    this.preservedEnding = observedLineEnding(snapshot.markdown);
    if (this.state.projection === "conflicted") {
      this.enterConflict(this.requireLive(), snapshot);
      return;
    }
    await this.reconcile(snapshot);
  }

  private onDocumentChange(snapshot: CollaborativeMarkdownSnapshot): void {
    if (this.isClosed) return;
    const live = { markdown: normalizeMarkdown(snapshot.markdown), revision: snapshot.revision };
    const previous = this.observedDocument;
    this.observedDocument = live;
    if (
      this.applyingFile ||
      (previous?.revision === live.revision && previous.markdown === live.markdown)
    ) return;
    if (this.state.projection === "missing") return;
    if (this.state.projection === "conflicted" && this.state.conflict) {
      this.enterConflict(live, this.state.conflict.incoming);
      return;
    }
    this.markDirty();
  }

  private markDirty(base?: ProjectionBase): void {
    if (this.isClosed) return;
    this.setState({ projection: "dirty", ...(base ? { base } : {}), diagnostic: undefined });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.enqueue(async () => {
        const disk = await this.owner.options.files.read(this.file);
        if (!disk) {
          this.setState({ projection: "missing", conflict: undefined });
          return;
        }
        await this.reconcile(disk);
      }, false);
    }, this.owner.debounceMs);
  }

  private async reconcile(
    disk: FileSnapshot,
    metadataConflictRetries = MAX_METADATA_CONFLICT_RETRIES,
    observedLive?: CollaborativeMarkdownSnapshot,
  ): Promise<void> {
    const live = observedLive ?? this.requireLive();
    const incoming = { ...disk, markdown: normalizeMarkdown(disk.markdown) };
    const outcome = this.reconcileDisk(live, incoming);
    if (outcome.kind === "clean") {
      await this.confirmBase(live, incoming, incoming.echoToken, metadataConflictRetries);
      return;
    }
    if (outcome.kind === "no-base" || outcome.kind === "conflict") {
      this.enterConflict(live, incoming, outcome);
      return;
    }
    if (outcome.applyTo === "file") {
      await this.writeLive(live, incoming.version, metadataConflictRetries);
      return;
    }
    if (!this.isDocumentReplacementAllowed()) {
      this.enterConflict(live, incoming, undefined, "read-only");
      return;
    }
    if (outcome.applyTo === "live") {
      await this.applyIncoming(
        { ...incoming, markdown: outcome.markdown },
        live.revision,
        metadataConflictRetries,
      );
      return;
    }

    this.applyingFile = true;
    try {
      const applied = await this.document.replaceMarkdown(outcome.markdown, {
        origin: "external-file",
        expectedRevision: live.revision,
      });
      await this.writeLive(applied, incoming.version, metadataConflictRetries);
    } finally {
      this.applyingFile = false;
    }
  }

  private async applyIncoming(
    incoming: FileSnapshot,
    expectedRevision: string,
    metadataConflictRetries = MAX_METADATA_CONFLICT_RETRIES,
  ): Promise<void> {
    this.applyingFile = true;
    try {
      const applied = await this.document.replaceMarkdown(normalizeMarkdown(incoming.markdown), {
        origin: "external-file",
        expectedRevision,
      });
      await this.confirmBase(applied, incoming, incoming.echoToken, metadataConflictRetries);
    } finally {
      this.applyingFile = false;
    }
  }

  private async writeLive(
    live: CollaborativeMarkdownSnapshot,
    expectedVersion: string | null,
    metadataConflictRetries = MAX_METADATA_CONFLICT_RETRIES,
  ): Promise<void> {
    const echoToken = this.owner.nextEchoToken();
    const projectedMarkdown = fileMarkdown(live.markdown, this.policy, this.preservedEnding);
    let receipt: FileWriteReceipt;
    try {
      receipt = await this.owner.options.files.writeAtomic(
        this.file,
        projectedMarkdown,
        { expectedVersion, echoToken },
      );
    } catch (cause) {
      let current: FileSnapshot | null | undefined;
      try {
        current = await this.owner.options.files.read(this.file);
      } catch {
        // Preserve the atomic-write failure when the follow-up observation also fails.
      }
      const currentVersion = current?.version ?? null;
      if (current !== undefined && currentVersion !== expectedVersion) {
        if (!current) {
          this.setState({ projection: "missing", conflict: undefined });
        } else if (normalizeMarkdown(current.markdown) === normalizeMarkdown(projectedMarkdown)) {
          await this.confirmBase(live, current, current.echoToken, metadataConflictRetries);
          return;
        } else {
          this.enterConflict(this.requireLive(), current, undefined, "stale-version");
        }
        throw new FileProjectionError(
          "projection-conflict",
          `The Markdown file changed during atomic projection for ${this.file.id}`,
          cause,
        );
      }
      throw new FileProjectionError("file-write-failed", `Atomic projection failed for ${this.file.id}`, cause);
    }
    const contentHash = hashMarkdown(projectedMarkdown);
    this.echoLedger.set(receipt.echoToken, { version: receipt.version, contentHash });
    while (this.echoLedger.size > 32) this.echoLedger.delete(this.echoLedger.keys().next().value as string);
    await this.confirmBase(live, {
      markdown: projectedMarkdown,
      version: receipt.version,
      echoToken: receipt.echoToken,
    }, receipt.echoToken, metadataConflictRetries);
  }

  private async confirmBase(
    live: CollaborativeMarkdownSnapshot,
    disk: FileSnapshot,
    writeReceipt?: string,
    metadataConflictRetries = MAX_METADATA_CONFLICT_RETRIES,
  ): Promise<void> {
    const markdown = normalizeMarkdown(live.markdown);
    const base: ProjectionBase = {
      markdown,
      contentHash: hashMarkdown(markdown),
      documentRevision: live.revision,
      fileVersion: disk.version,
      ...(writeReceipt ? { writeReceipt } : {}),
    };
    const current = this.metadataEntry;
    if (!current) throw new FileProjectionError("metadata-write-failed", "Projection metadata is unavailable");
    try {
      this.metadataEntry = await this.saveMetadata(
        { ...current.record, file: this.file, base },
        current.revision,
      );
    } catch (cause) {
      if (!errorHasCode(cause, "metadata-conflict")) throw cause;
      await this.reconcileAfterMetadataConflict(cause, metadataConflictRetries, {
        markdown,
        fileVersion: disk.version,
        echoToken: writeReceipt ?? disk.echoToken,
      });
      return;
    }
    const currentLive = this.requireLive();
    if (currentLive.revision !== live.revision || currentLive.markdown !== markdown) {
      this.markDirty(base);
      return;
    }
    this.setState({ projection: "clean", base, conflict: undefined, diagnostic: undefined });
  }

  private async reconcileAfterMetadataConflict(
    cause: unknown,
    retriesRemaining: number,
    confirmed: {
      readonly markdown: string;
      readonly fileVersion: string;
      readonly echoToken?: string;
    },
  ): Promise<void> {
    const latest = await this.loadCurrentMetadata();
    if (!latest) {
      throw new FileProjectionError(
        "identity-not-enrolled",
        `File ${this.file.id} lost its persisted collaboration enrollment`,
        cause,
      );
    }
    if (latest.record.file.path !== this.file.path) {
      throw new FileProjectionError(
        "identity-collision",
        `File ${this.file.id} was concurrently renamed to ${latest.record.file.path}`,
        cause,
      );
    }
    this.metadataEntry = latest;
    if (retriesRemaining <= 0) {
      throw new FileProjectionError(
        "metadata-write-failed",
        `Projection metadata kept changing for ${this.file.id}`,
        cause,
      );
    }
    const observedDisk = await this.owner.options.files.read(this.file);
    if (!observedDisk) {
      this.setState({ projection: "missing", conflict: undefined, diagnostic: undefined });
      throw new FileProjectionError(
        "projection-conflict",
        `The Markdown file disappeared while metadata changed for ${this.file.id}`,
        cause,
      );
    }
    const disk = confirmed.echoToken
      && observedDisk.version === confirmed.fileVersion
      && normalizeMarkdown(observedDisk.markdown) === normalizeMarkdown(fileMarkdown(
        confirmed.markdown,
        this.policy,
        this.preservedEnding,
      ))
      ? { ...observedDisk, echoToken: confirmed.echoToken }
      : observedDisk;
    this.preservedEnding = observedLineEnding(disk.markdown);
    await this.reconcile(disk, retriesRemaining - 1);
  }

  private enterConflict(
    live: CollaborativeMarkdownSnapshot,
    disk: FileSnapshot,
    outcome?: Extract<MarkdownProjectionReconciliation, { kind: "conflict" | "no-base" }>,
    reasonOverride?: FileProjectionConflict["reason"],
  ): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const reconciliation = outcome ?? this.reconcileDisk(live, disk);
    const previous = this.state.conflict;
    const reason = reasonOverride ?? (reconciliation.kind === "conflict"
      ? "overlapping-edits"
      : reconciliation.kind === "no-base"
        ? "no-base"
        : previous?.reason ?? "overlapping-edits");
    const conflict: FileProjectionConflict = {
      id: `file-conflict:${this.document.id}:${++this.conflictSequence}`,
      reason,
      base: reconciliation.kind === "conflict"
        ? reconciliation.base
        : this.metadataEntry?.record.base?.markdown ?? null,
      live,
      incoming: { ...disk, markdown: normalizeMarkdown(disk.markdown) },
      hunks: reconciliation.kind === "conflict" ? reconciliation.hunks : previous?.hunks ?? [],
    };
    this.observedDocument = live;
    this.setState({ projection: "conflicted", conflict, diagnostic: undefined });
  }

  private reconcileDisk(
    live: CollaborativeMarkdownSnapshot,
    disk: FileSnapshot,
  ): MarkdownProjectionReconciliation {
    const incoming = normalizeMarkdown(disk.markdown);
    const base = this.metadataEntry?.record.base?.markdown ?? null;
    if (
      base === null &&
      normalizeMarkdown(fileMarkdown(live.markdown, this.policy, this.preservedEnding)) === incoming
    ) {
      return { kind: "clean", reason: "already-equal", markdown: live.markdown };
    }
    return reconcileMarkdownProjection({
      base,
      live: live.markdown,
      incoming: base === null
        ? incoming
        : collaborativeMarkdownFromFile(incoming, base, this.policy),
    });
  }

  private isSelfWrite(snapshot: FileSnapshot): boolean {
    const contentHash = hashMarkdown(snapshot.markdown);
    if (snapshot.echoToken) {
      const exact = this.echoLedger.get(snapshot.echoToken);
      if (exact && exact.version === snapshot.version && exact.contentHash === contentHash) return true;
    }
    for (const entry of this.echoLedger.values()) {
      if (entry.version === snapshot.version && entry.contentHash === contentHash) return true;
    }
    return false;
  }

  private isDocumentReplacementAllowed(): boolean {
    try {
      return this.canApplyToDocument() === true;
    } catch {
      // Authorization callbacks are a Host boundary. Fail closed if that
      // boundary cannot establish current write permission.
      return false;
    }
  }

  private async applyRename(file: FileProjectionRef): Promise<void> {
    this.assertOpen();
    if (file.path === this.file.path) return;
    const current = this.metadataEntry;
    if (!current) throw new FileProjectionError("metadata-write-failed", "Projection metadata is unavailable");
    const previousProjection = this.state.projection;
    const candidateWatch = await this.prepareWatch(file);
    let renamedMetadata: ProjectionMetadataEntry;
    try {
      renamedMetadata = await this.saveRenamedMetadata(file, current);
    } catch (cause) {
      await this.retireWatch(candidateWatch);
      throw cause;
    }

    const previousWatch = this.watchRegistration;
    if (previousWatch) this.deactivateWatch(previousWatch);
    this.file = file;
    this.metadataEntry = renamedMetadata;
    this.state = { ...this.state, file };
    this.activateWatch(candidateWatch);
    this.emit();
    if (previousWatch) await this.retireWatch(previousWatch);

    if (previousProjection === "failed") {
      const disk = await this.owner.options.files.read(file);
      if (!disk) {
        this.setState({ projection: "missing", conflict: undefined, diagnostic: undefined });
      } else {
        this.preservedEnding = observedLineEnding(disk.markdown);
        await this.reconcile(disk);
      }
    }
  }

  private async saveRenamedMetadata(
    file: FileProjectionRef,
    initial: ProjectionMetadataEntry,
  ): Promise<ProjectionMetadataEntry> {
    let current = initial;
    for (let retriesRemaining = MAX_METADATA_CONFLICT_RETRIES; ; retriesRemaining--) {
      try {
        return await this.saveMetadata({ ...current.record, file }, current.revision);
      } catch (cause) {
        if (!errorHasCode(cause, "metadata-conflict")) throw cause;
        const latest = await this.loadCurrentMetadata();
        if (!latest) {
          throw new FileProjectionError(
            "identity-not-enrolled",
            `File ${this.file.id} lost its persisted collaboration enrollment during rename`,
            cause,
          );
        }
        if (latest.record.file.path === file.path) return latest;
        if (latest.record.file.path !== this.file.path) {
          throw new FileProjectionError(
            "identity-collision",
            `File ${this.file.id} was concurrently renamed to ${latest.record.file.path}`,
            cause,
          );
        }
        this.metadataEntry = latest;
        if (retriesRemaining <= 0) {
          throw new FileProjectionError(
            "metadata-write-failed",
            `Projection metadata kept changing while renaming ${this.file.id}`,
            cause,
          );
        }
        current = latest;
      }
    }
  }

  private async prepareWatch(file: FileProjectionRef): Promise<ProjectionWatchRegistration> {
    const registration: ProjectionWatchRegistration = {
      file,
      lease: null,
      status: "preparing",
      pending: [],
    };
    try {
      registration.lease = await this.owner.options.files.watch(file, (change) => {
        this.onWatchedFileChange(registration, change);
      });
    } catch (cause) {
      throw new FileProjectionError(
        "file-watch-failed",
        `Could not watch Markdown file ${file.path}`,
        cause,
      );
    }
    return registration;
  }

  private activateWatch(registration: ProjectionWatchRegistration): void {
    registration.status = "active";
    this.watchRegistration = registration;
    const pending = registration.pending.splice(0);
    for (const change of pending) this.onWatchedFileChange(registration, change);
  }

  private deactivateWatch(registration: ProjectionWatchRegistration): void {
    registration.status = "retired";
    registration.pending.length = 0;
  }

  private onWatchedFileChange(
    registration: ProjectionWatchRegistration,
    change: ExternalFileChange,
  ): void {
    if (registration.status === "preparing") {
      registration.pending.push(change);
      return;
    }
    if (registration.status === "retired") return;
    void this.enqueue(async () => {
      if (registration.status !== "active" || this.watchRegistration !== registration) return;
      await this.onFileChange(change);
    }, false);
  }

  private async retireWatch(registration: ProjectionWatchRegistration): Promise<void> {
    this.deactivateWatch(registration);
    if (!registration.lease) return;
    try {
      await registration.lease.dispose();
    } catch {
      this.retiredWatchLeases.add(registration.lease);
    }
  }

  private async saveMetadata(
    record: ProjectionMetadataRecord,
    expectedRevision: string | null,
  ): Promise<ProjectionMetadataEntry> {
    try {
      return await this.owner.options.metadata.save(record, expectedRevision);
    } catch (cause) {
      throw new FileProjectionError("metadata-write-failed", `Could not persist projection metadata for ${this.file.id}`, cause);
    }
  }

  private async loadCurrentMetadata(): Promise<ProjectionMetadataEntry | null> {
    let loaded: ProjectionMetadataEntry | null;
    try {
      loaded = await this.owner.options.metadata.load(this.file.id);
    } catch (cause) {
      throw new FileProjectionError(
        "metadata-write-failed",
        `Could not load projection metadata for ${this.file.id}`,
        cause,
      );
    }
    if (!loaded) return null;
    if (loaded.record.file.id !== this.file.id || loaded.record.documentId !== this.document.id) {
      throw new FileProjectionError(
        "identity-collision",
        `Projection metadata for ${this.file.id} belongs to another file or Collaborative Document`,
      );
    }
    return loaded;
  }

  private enqueue(operation: () => Promise<void>, surfaceError: boolean): Promise<void> {
    const result = this.queue.then(operation);
    this.queue = result.catch((cause) => {
      if (
        !(cause instanceof FileProjectionError) ||
        !["projection-conflict", "stale-conflict", "projection-closed"].includes(cause.code)
      ) {
        this.fail(cause);
      }
    });
    return surfaceError ? result : this.queue;
  }

  private fail(cause: unknown): void {
    if (this.isClosed) return;
    const error = cause instanceof FileProjectionError
      ? cause
      : new FileProjectionError("file-write-failed", `File Projection failed for ${this.file.id}`, cause);
    const diagnostic = {
      code: error.code,
      message: error.message,
      documentId: this.document.id,
      fileId: this.file.id,
      cause: error.cause ?? cause,
    } satisfies FileProjectionDiagnostic;
    this.setState({ projection: "failed", diagnostic });
    try {
      this.owner.options.diagnostics?.(diagnostic);
    } catch {
      // Diagnostics must not break projection cleanup or recovery.
    }
  }

  private setState(patch: Partial<FileProjectionSnapshot>): void {
    this.state = { ...this.state, ...patch, documentId: this.document.id, file: this.file };
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.state);
      } catch {
        // Host listeners are isolated from File Projection correctness.
      }
    }
  }

  private assertOpen(): void {
    if (this.isClosed) throw new FileProjectionError("projection-closed", "File Projection is closed");
  }
}

class FileProjectionControllerImpl implements FileProjectionController {
  readonly debounceMs: number;
  private projections = new Map<FileId, FileProjection>();
  private projectionsByDocument = new Map<DocumentId, FileProjection>();
  private closed = false;
  private closePromise: Promise<void> | null = null;
  private pendingInitializations = new Set<Promise<void>>();
  private echoSequence = 0;

  constructor(readonly options: FileProjectionControllerOptions) {
    this.debounceMs = Math.max(0, options.debounceMs ?? 150);
  }

  async attach(options: FileProjectionAttachOptions): Promise<FileProjectionHandle> {
    if (this.closed) throw new FileProjectionError("controller-closed", "File Projection controller is closed");
    if (this.projections.has(options.file.id) || this.projectionsByDocument.has(options.document.id)) {
      throw new FileProjectionError(
        "projection-already-attached",
        `File ${options.file.id} or document ${options.document.id} already has an active projection`,
      );
    }
    const projection = new FileProjection(
      this,
      options.file,
      options.document,
      options.mode,
      options.policy ?? {},
      options.canApplyToDocument ?? (() => true),
    );
    this.projections.set(options.file.id, projection);
    this.projectionsByDocument.set(options.document.id, projection);
    const initialization = projection.initialize();
    this.pendingInitializations.add(initialization);
    try {
      await initialization;
      if (this.closed) {
        throw new FileProjectionError(
          "controller-closed",
          "File Projection controller closed while attaching the document",
        );
      }
      return projection;
    } catch (cause) {
      try {
        await projection.close();
      } catch (cleanupCause) {
        throw new AggregateError(
          [cause, cleanupCause],
          `File Projection attachment cleanup failed for ${options.file.id}`,
        );
      }
      throw cause;
    } finally {
      this.pendingInitializations.delete(initialization);
    }
  }

  release(fileId: FileId, documentId: DocumentId, projection: FileProjection): void {
    if (this.projections.get(fileId) === projection) this.projections.delete(fileId);
    if (this.projectionsByDocument.get(documentId) === projection) this.projectionsByDocument.delete(documentId);
  }

  nextEchoToken(): string {
    return this.options.createEchoToken?.() ?? `projection-${Date.now()}-${++this.echoSequence}`;
  }

  close(): Promise<void> {
    this.closePromise ??= this.performClose();
    return this.closePromise;
  }

  private async performClose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([...this.pendingInitializations]);
    const projections = [...this.projections.values()];
    this.projections.clear();
    this.projectionsByDocument.clear();
    const results = await Promise.allSettled(projections.map((projection) => projection.close()));
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "File Projection controller cleanup failed");
    }
  }
}

export function createFileProjectionController(
  options: FileProjectionControllerOptions,
): FileProjectionController {
  return new FileProjectionControllerImpl(options);
}
