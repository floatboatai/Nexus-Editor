import { describe, expect, it } from "vitest";

import { asDocumentId, type DocumentId, type Unsubscribe } from "../src/types";
import {
  asFileId,
  createFileProjectionController,
  reconcileMarkdownProjection,
  type CollaborativeMarkdownPort,
  type CollaborativeMarkdownSnapshot,
  type ExternalFileChange,
  type FileProjectionAdapter,
  type FileProjectionRef,
  type FileSnapshot,
  type FileWriteOptions,
  type ProjectionMetadataEntry,
  type ProjectionMetadataRecord,
  type ProjectionMetadataStore,
} from "../src/file-projection";

class MemoryDocument implements CollaborativeMarkdownPort {
  private revision = 1;
  private listeners = new Set<(snapshot: CollaborativeMarkdownSnapshot) => void>();
  readonly applied: Array<{ markdown: string; origin: string; expectedRevision: string }> = [];
  unsubscribeError: Error | null = null;

  constructor(
    readonly id: DocumentId,
    private markdown: string,
  ) {}

  getMarkdownSnapshot(): CollaborativeMarkdownSnapshot {
    return { markdown: this.markdown, revision: String(this.revision) };
  }

  async replaceMarkdown(
    markdown: string,
    options: { readonly origin: string; readonly expectedRevision: string },
  ): Promise<CollaborativeMarkdownSnapshot> {
    if (options.expectedRevision !== String(this.revision)) throw new Error("stale document revision");
    this.applied.push({ markdown, ...options });
    this.markdown = markdown;
    this.revision++;
    const snapshot = this.getMarkdownSnapshot();
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  subscribeMarkdown(listener: (snapshot: CollaborativeMarkdownSnapshot) => void): Unsubscribe {
    this.listeners.add(listener);
    listener(this.getMarkdownSnapshot());
    return () => {
      this.listeners.delete(listener);
      if (this.unsubscribeError) throw this.unsubscribeError;
    };
  }

  edit(markdown: string): void {
    this.markdown = markdown;
    this.revision++;
    const snapshot = this.getMarkdownSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  editBeforeNotification(markdown: string): void {
    this.markdown = markdown;
    this.revision++;
  }
}

class MemoryMetadata implements ProjectionMetadataStore {
  private entries = new Map<string, ProjectionMetadataEntry>();
  private sequence = 0;
  readonly conflicts: string[] = [];

  async load(fileId: ReturnType<typeof asFileId>): Promise<ProjectionMetadataEntry | null> {
    return this.entries.get(fileId) ?? null;
  }

  async save(
    record: ProjectionMetadataRecord,
    expectedRevision: string | null,
  ): Promise<ProjectionMetadataEntry> {
    const current = this.entries.get(record.file.id);
    if ((current?.revision ?? null) !== expectedRevision) {
      this.conflicts.push(record.file.id);
      throw Object.assign(new Error("stale metadata revision"), { code: "metadata-conflict" });
    }
    const entry = { record, revision: String(++this.sequence) };
    this.entries.set(record.file.id, entry);
    return entry;
  }

  async delete(record: ProjectionMetadataRecord, expectedRevision: string): Promise<boolean> {
    const current = this.entries.get(record.file.id);
    if (!current) return false;
    if (
      current.revision !== expectedRevision ||
      JSON.stringify(current.record) !== JSON.stringify(record)
    ) {
      throw Object.assign(new Error("stale metadata revision"), { code: "metadata-conflict" });
    }
    this.entries.delete(record.file.id);
    return true;
  }
}

class MemoryFiles implements FileProjectionAdapter {
  private snapshots = new Map<string, FileSnapshot>();
  private listeners = new Map<string, Set<(change: ExternalFileChange) => void>>();
  private versionSequence = 0;
  readonly writes: Array<{ file: FileProjectionRef; markdown: string; options: FileWriteOptions }> = [];
  writeError: Error | null = null;
  watchError: Error | null = null;
  beforeWrite: (() => Promise<void>) | null = null;
  beforeWatch: ((file: FileProjectionRef) => Promise<void>) | null = null;
  beforeDispose: ((file: FileProjectionRef) => Promise<void>) | null = null;
  disposeError: ((file: FileProjectionRef) => unknown) | null = null;
  readonly disposals: FileProjectionRef[] = [];

  seed(file: FileProjectionRef, markdown: string, version = "v1"): void {
    this.versionSequence = Math.max(this.versionSequence, Number(version.slice(1)) || 0);
    this.snapshots.set(file.id, { markdown, version });
  }

  external(file: FileProjectionRef, markdown: string, version: string): FileSnapshot {
    this.versionSequence = Math.max(this.versionSequence, Number(version.slice(1)) || 0);
    const snapshot = { markdown, version };
    this.snapshots.set(file.id, snapshot);
    return snapshot;
  }

  async read(file: FileProjectionRef): Promise<FileSnapshot | null> {
    return this.snapshots.get(file.id) ?? null;
  }

  async writeAtomic(
    file: FileProjectionRef,
    markdown: string,
    options: FileWriteOptions,
  ): Promise<{ version: string; echoToken: string }> {
    if (this.writeError) throw this.writeError;
    await this.beforeWrite?.();
    const current = this.snapshots.get(file.id);
    if ((current?.version ?? null) !== options.expectedVersion) throw new Error("stale file version");
    const version = `v${++this.versionSequence}`;
    this.writes.push({ file, markdown, options });
    this.snapshots.set(file.id, { markdown, version, echoToken: options.echoToken });
    return { version, echoToken: options.echoToken };
  }

  async watch(
    file: FileProjectionRef,
    listener: (change: ExternalFileChange) => void,
  ): Promise<{ dispose(): Promise<void> }> {
    if (this.watchError) throw this.watchError;
    await this.beforeWatch?.(file);
    const listeners = this.listeners.get(file.id) ?? new Set();
    listeners.add(listener);
    this.listeners.set(file.id, listeners);
    return {
      dispose: async () => {
        await this.beforeDispose?.(file);
        listeners.delete(listener);
        this.disposals.push(file);
        const failure = this.disposeError?.(file);
        if (failure !== null && failure !== undefined) throw failure;
      },
    };
  }

  emit(file: FileProjectionRef, change: ExternalFileChange): void {
    if (change.kind === "deleted") this.snapshots.delete(file.id);
    for (const listener of this.listeners.get(file.id) ?? []) listener(change);
  }

  activeWatcherCount(file: FileProjectionRef): number {
    return this.listeners.get(file.id)?.size ?? 0;
  }
}

describe("Markdown File Projection", () => {
  it("projects the current collaborative Markdown when disk still matches the Projection Base", () => {
    expect(reconcileMarkdownProjection({
      base: "# Note\n",
      live: "# Note\n\nCollaborative edit\n",
      incoming: "# Note\n",
    })).toEqual({
      kind: "applied",
      source: "live",
      applyTo: "file",
      markdown: "# Note\n\nCollaborative edit\n",
    });
  });

  it("merges non-overlapping collaborative and external edits", () => {
    expect(reconcileMarkdownProjection({
      base: "title\nalpha\nbeta\nomega\n",
      live: "title\nALPHA\nbeta\nomega\n",
      incoming: "title\nalpha\nbeta\nOMEGA\n",
    })).toEqual({
      kind: "applied",
      source: "merge",
      applyTo: "both",
      markdown: "title\nALPHA\nbeta\nOMEGA\n",
    });
  });

  it("returns structured conflict material without choosing an overlapping edit", () => {
    expect(reconcileMarkdownProjection({
      base: "title\nalpha\nomega\n",
      live: "title\nALPHA live\nomega\n",
      incoming: "title\nALPHA disk\nomega\n",
    })).toEqual({
      kind: "conflict",
      base: "title\nalpha\nomega\n",
      live: "title\nALPHA live\nomega\n",
      incoming: "title\nALPHA disk\nomega\n",
      hunks: [{
        baseStartLine: 1,
        baseEndLine: 2,
        base: "alpha",
        live: "ALPHA live",
        incoming: "ALPHA disk",
      }],
    });
  });

  it("combines an insertion at an edit boundary without manufacturing a conflict", () => {
    expect(reconcileMarkdownProjection({
      base: "a\nb\nc\n",
      live: "a\nx\nb\nc\n",
      incoming: "a\nB\nc\n",
    })).toEqual({
      kind: "applied",
      source: "merge",
      applyTo: "both",
      markdown: "a\nx\nB\nc\n",
    });
  });

  it("persists identity and base, projects live edits atomically, and suppresses its watcher echo", async () => {
    const file = { id: asFileId("file-1"), path: "notes/one.md" };
    const document = new MemoryDocument(asDocumentId("document-1"), "hello\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "hello\n");
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document });

    document.edit("hello\nworld\n");
    expect(projection.getState().projection).toBe("dirty");
    await projection.flush();

    expect(files.writes).toHaveLength(1);
    expect(files.writes[0]).toMatchObject({
      file,
      markdown: "hello\nworld\n",
      options: { expectedVersion: "v1" },
    });
    expect((await metadata.load(file.id))?.record).toMatchObject({
      file,
      documentId: document.id,
      base: { markdown: "hello\nworld\n", documentRevision: "2", fileVersion: "v2" },
    });

    files.emit(file, { kind: "changed", snapshot: await files.read(file) as FileSnapshot });
    await projection.settle();
    expect(document.applied).toHaveLength(0);
    expect(files.writes).toHaveLength(1);
    expect(projection.getState().projection).toBe("clean");

    await projection.close();
    await controller.close();
  });

  it("does not treat the subscription's initial Markdown snapshot as a new edit", async () => {
    const file = { id: asFileId("file-initial-snapshot"), path: "notes/initial.md" };
    const document = new MemoryDocument(asDocumentId("document-initial-snapshot"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata, debounceMs: 0 });
    const projection = await controller.attach({ mode: "enroll", file, document });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await projection.settle();

    expect((await metadata.load(file.id))?.revision).toBe("2");
    expect(files.writes).toHaveLength(0);
    expect(projection.getState().projection).toBe("clean");
    await controller.close();
  });

  it("serializes a rename observed during initial read before confirming the Projection Base", async () => {
    const file = { id: asFileId("file-initial-read-rename"), path: "notes/before.md" };
    const renamed = { id: file.id, path: "archive/after.md" };
    const document = new MemoryDocument(asDocumentId("document-initial-read-rename"), "before\n");
    const metadata = new MemoryMetadata();
    const watcher: { notify?: (change: ExternalFileChange) => void } = {};
    let markOldReadStarted!: () => void;
    let releaseOldRead!: () => void;
    let markNewReadStarted!: () => void;
    const oldReadStarted = new Promise<void>((resolve) => { markOldReadStarted = resolve; });
    const oldReadReleased = new Promise<void>((resolve) => { releaseOldRead = resolve; });
    const newReadStarted = new Promise<void>((resolve) => { markNewReadStarted = resolve; });
    const files: FileProjectionAdapter = {
      async read(current) {
        if (current.path === file.path) {
          markOldReadStarted();
          await oldReadReleased;
          return { markdown: "before\n", version: "before-v1" };
        }
        markNewReadStarted();
        return { markdown: "after\n", version: "after-v1" };
      },
      async writeAtomic() {
        throw new Error("No write is expected while importing the rename");
      },
      async watch(current, listener) {
        if (current.path === file.path) watcher.notify = listener;
        return { dispose: async () => undefined };
      },
    };
    const controller = createFileProjectionController({ files, metadata });

    const attaching = controller.attach({ mode: "enroll", file, document });
    await oldReadStarted;
    watcher.notify?.({ kind: "renamed", file: renamed });
    await Promise.race([
      newReadStarted,
      new Promise<void>((resolve) => setTimeout(resolve, 0)),
    ]);
    releaseOldRead();
    const projection = await attaching;
    await projection.settle();

    expect(document.getMarkdownSnapshot().markdown).toBe("after\n");
    expect(projection.getState()).toMatchObject({
      file: renamed,
      projection: "clean",
      base: { markdown: "after\n", fileVersion: "after-v1" },
    });
    expect((await metadata.load(file.id))?.record).toMatchObject({
      file: renamed,
      base: { markdown: "after\n", fileVersion: "after-v1" },
    });

    await controller.close();
  });

  it("serializes a document update observed during the initial file read", async () => {
    const file = { id: asFileId("file-initial-read-document-update"), path: "notes/initial.md" };
    const document = new MemoryDocument(
      asDocumentId("document-initial-read-document-update"),
      "before\n",
    );
    const metadata = new MemoryMetadata();
    let disk: FileSnapshot = { markdown: "before\n", version: "v1" };
    let readCount = 0;
    let writeCount = 0;
    let markInitialReadStarted!: () => void;
    let releaseInitialRead!: () => void;
    const initialReadStarted = new Promise<void>((resolve) => { markInitialReadStarted = resolve; });
    const initialReadReleased = new Promise<void>((resolve) => { releaseInitialRead = resolve; });
    let laterReadStartedBeforeRelease = false;
    let initialReadPending = true;
    const files: FileProjectionAdapter = {
      async read() {
        readCount++;
        if (readCount === 1) {
          markInitialReadStarted();
          await initialReadReleased;
          initialReadPending = false;
          return { markdown: "before\n", version: "v1" };
        }
        if (initialReadPending) laterReadStartedBeforeRelease = true;
        return { ...disk };
      },
      async writeAtomic(_file, markdown, options) {
        if (disk.version !== options.expectedVersion) throw new Error("stale file version");
        disk = {
          markdown,
          version: `v${++writeCount + 1}`,
          echoToken: options.echoToken,
        };
        return { version: disk.version, echoToken: options.echoToken };
      },
      async watch() {
        return { dispose: async () => undefined };
      },
    };
    const controller = createFileProjectionController({ files, metadata, debounceMs: 0 });

    const attaching = controller.attach({ mode: "enroll", file, document });
    await initialReadStarted;
    document.edit("after\n");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    releaseInitialRead();
    const projection = await attaching;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await projection.settle();

    expect(laterReadStartedBeforeRelease).toBe(false);
    expect(document.getMarkdownSnapshot().markdown).toBe("after\n");
    expect(disk.markdown).toBe("after\n");
    expect(projection.getState()).toMatchObject({
      projection: "clean",
      base: { markdown: "after\n", fileVersion: disk.version },
    });
    expect((await metadata.load(file.id))?.record.base).toMatchObject({
      markdown: "after\n",
      fileVersion: disk.version,
    });

    await controller.close();
  });

  it("shares one in-flight projection close and waits for watcher disposal", async () => {
    const file = { id: asFileId("file-shared-close"), path: "notes/shared-close.md" };
    const document = new MemoryDocument(asDocumentId("document-shared-close"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata });
    const projection = await controller.attach({ mode: "enroll", file, document });
    let releaseDispose!: () => void;
    const disposeBarrier = new Promise<void>((resolve) => { releaseDispose = resolve; });
    files.beforeDispose = async () => disposeBarrier;

    const firstClose = projection.close();
    const concurrentClose = projection.close();
    expect(concurrentClose).toBe(firstClose);
    let concurrentSettled = false;
    void concurrentClose.finally(() => { concurrentSettled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(concurrentSettled).toBe(false);

    releaseDispose();
    await firstClose;
    expect(concurrentSettled).toBe(true);
    expect(files.disposals).toEqual([file]);
    await controller.close();
  });

  it("does not create a replacement watcher when a queued move loses the close race", async () => {
    const file = { id: asFileId("file-close-move-race"), path: "notes/before-close.md" };
    const renamed = { ...file, path: "archive/after-close.md" };
    const document = new MemoryDocument(asDocumentId("document-close-move-race"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    let releaseWrite!: () => void;
    const writeBarrier = new Promise<void>((resolve) => { releaseWrite = resolve; });
    let signalWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => { signalWriteStarted = resolve; });
    files.beforeWrite = async () => {
      signalWriteStarted();
      await writeBarrier;
    };
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document });
    document.edit("live\n");
    const flush = projection.flush();
    await writeStarted;
    const move = projection.move(renamed);
    const close = projection.close();

    releaseWrite();
    await flush;
    await expect(move).rejects.toMatchObject({ code: "projection-closed" });
    await close;

    expect(files.activeWatcherCount(file)).toBe(0);
    expect((await metadata.load(file.id))?.record.file).toEqual(file);
    await controller.close();
  });

  it("waits for an in-flight attachment and leaves no watcher when the controller closes", async () => {
    const file = { id: asFileId("file-attach-close-race"), path: "notes/attach-close.md" };
    const document = new MemoryDocument(asDocumentId("document-attach-close-race"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    let releaseWatch!: () => void;
    const watchBarrier = new Promise<void>((resolve) => { releaseWatch = resolve; });
    let signalWatchStarted!: () => void;
    const watchStarted = new Promise<void>((resolve) => { signalWatchStarted = resolve; });
    files.beforeWatch = async () => {
      signalWatchStarted();
      await watchBarrier;
    };
    const controller = createFileProjectionController({ files, metadata });
    const attaching = controller.attach({ mode: "enroll", file, document });
    await watchStarted;

    const firstClose = controller.close();
    const concurrentClose = controller.close();
    expect(concurrentClose).toBe(firstClose);
    let closeSettled = false;
    void firstClose.finally(() => { closeSettled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(closeSettled).toBe(false);

    releaseWatch();
    await expect(attaching).rejects.toMatchObject({ code: "controller-closed" });
    await firstClose;
    expect(files.activeWatcherCount(file)).toBe(0);
  });

  it("closes every projection before reporting aggregated watcher cleanup failures", async () => {
    const firstFile = { id: asFileId("file-close-failure-a"), path: "notes/close-a.md" };
    const secondFile = { id: asFileId("file-close-failure-b"), path: "notes/close-b.md" };
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(firstFile, "first\n");
    files.seed(secondFile, "second\n");
    const controller = createFileProjectionController({ files, metadata });
    const first = await controller.attach({
      mode: "enroll",
      file: firstFile,
      document: new MemoryDocument(asDocumentId("document-close-failure-a"), "first\n"),
    });
    const second = await controller.attach({
      mode: "enroll",
      file: secondFile,
      document: new MemoryDocument(asDocumentId("document-close-failure-b"), "second\n"),
    });
    const firstFailure = new Error("first watcher dispose failed");
    const secondFailure = new Error("second watcher dispose failed");
    files.disposeError = (file) => file.id === firstFile.id ? firstFailure : secondFailure;

    const close = controller.close();
    const concurrentClose = controller.close();
    const [firstResult, secondResult] = await Promise.allSettled([close, concurrentClose]);

    expect(concurrentClose).toBe(close);
    expect(firstResult.status).toBe("rejected");
    expect(secondResult.status).toBe("rejected");
    if (firstResult.status === "rejected") {
      expect(firstResult.reason).toBeInstanceOf(AggregateError);
      expect((firstResult.reason as AggregateError).errors).toEqual([firstFailure, secondFailure]);
    }
    if (secondResult.status === "rejected" && firstResult.status === "rejected") {
      expect(secondResult.reason).toBe(firstResult.reason);
    }
    expect(files.disposals.map((file) => file.id)).toEqual([firstFile.id, secondFile.id]);
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(true);
  });

  it("releases its watcher and registry entry when document unsubscribe also fails", async () => {
    const file = { id: asFileId("file-close-callback-failure"), path: "notes/close-callback.md" };
    const document = new MemoryDocument(
      asDocumentId("document-close-callback-failure"),
      "base\n",
    );
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata });
    const projection = await controller.attach({ mode: "enroll", file, document });
    const unsubscribeFailure = new Error("document unsubscribe failed");
    const watcherFailure = new Error("watcher dispose failed");
    document.unsubscribeError = unsubscribeFailure;
    files.disposeError = () => watcherFailure;

    const result = await Promise.allSettled([projection.close()]);

    expect(result[0]?.status).toBe("rejected");
    if (result[0]?.status === "rejected") {
      expect(result[0].reason).toBeInstanceOf(AggregateError);
      expect((result[0].reason as AggregateError).errors).toEqual([
        unsubscribeFailure,
        watcherFailure,
      ]);
    }
    expect(projection.closed).toBe(true);
    expect(files.activeWatcherCount(file)).toBe(0);
    await expect(controller.close()).resolves.toBeUndefined();
  });

  it("reloads metadata advanced by another window before confirming a new Projection Base", async () => {
    const file = { id: asFileId("file-multi-window"), path: "notes/shared.md" };
    const documentId = asDocumentId("document-multi-window");
    const firstDocument = new MemoryDocument(documentId, "base\n");
    const secondDocument = new MemoryDocument(documentId, "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    const firstController = createFileProjectionController({
      files,
      metadata,
      debounceMs: 60_000,
      createEchoToken: () => "first-window-write",
    });
    const secondController = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const first = await firstController.attach({ mode: "enroll", file, document: firstDocument });
    const second = await secondController.attach({ mode: "resume", file, document: secondDocument });

    firstDocument.edit("edited in first window\n");
    await expect(first.flush()).resolves.toBeUndefined();

    expect(metadata.conflicts).toEqual([file.id]);
    expect(await files.read(file)).toMatchObject({ markdown: "edited in first window\n" });
    expect((await metadata.load(file.id))?.record).toMatchObject({
      file,
      documentId,
      base: {
        markdown: "edited in first window\n",
        fileVersion: "v2",
        writeReceipt: "first-window-write",
      },
    });
    expect(first.getState()).toMatchObject({
      projection: "clean",
      base: {
        markdown: "edited in first window\n",
        fileVersion: "v2",
        writeReceipt: "first-window-write",
      },
    });
    await expect(first.flush()).resolves.toBeUndefined();

    await firstController.close();
    await secondController.close();
    expect(second.closed).toBe(true);
  });

  it("bounds repeated metadata contention and retries later from the last reloaded revision", async () => {
    const file = { id: asFileId("file-metadata-contention"), path: "notes/contention.md" };
    const document = new MemoryDocument(asDocumentId("document-metadata-contention"), "base\n");
    const files = new MemoryFiles();
    const backing = new MemoryMetadata();
    let contend = false;
    let contentionAttempts = 0;
    const metadata: ProjectionMetadataStore = {
      load: (fileId) => backing.load(fileId),
      delete: (record, expectedRevision) => backing.delete(record, expectedRevision),
      async save(record, expectedRevision) {
        if (contend && record.base?.markdown === "local\n") {
          contentionAttempts++;
          const latest = await backing.load(record.file.id);
          await backing.save(latest!.record, latest!.revision);
        }
        return backing.save(record, expectedRevision);
      },
    };
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document });
    contend = true;
    document.edit("local\n");

    await expect(projection.flush()).rejects.toMatchObject({ code: "metadata-write-failed" });
    expect(contentionAttempts).toBeGreaterThan(1);
    expect(projection.getState()).toMatchObject({
      projection: "failed",
      diagnostic: { code: "metadata-write-failed" },
    });

    contend = false;
    await expect(projection.flush()).resolves.toBeUndefined();
    expect(projection.getState()).toMatchObject({
      projection: "clean",
      base: { markdown: "local\n", fileVersion: "v2" },
    });
    expect((await backing.load(file.id))?.record.base).toMatchObject({
      markdown: "local\n",
      fileVersion: "v2",
    });
    await controller.close();
  });

  it("retains exact null-base identity when the file write succeeds before base metadata save fails", async () => {
    const file = { id: asFileId("file-write-before-base"), path: "notes/write-before-base.md" };
    const document = new MemoryDocument(
      asDocumentId("document-write-before-base"),
      "shared content\n",
    );
    const files = new MemoryFiles();
    const backing = new MemoryMetadata();
    const metadata: ProjectionMetadataStore = {
      load: (fileId) => backing.load(fileId),
      delete: (record, expectedRevision) => backing.delete(record, expectedRevision),
      save(record, expectedRevision) {
        if (record.base !== null) {
          return Promise.reject(Object.assign(new Error("renderer stopped before base save"), {
            code: "simulated-renderer-crash",
          }));
        }
        return backing.save(record, expectedRevision);
      },
    };
    const controller = createFileProjectionController({
      files,
      metadata,
      createEchoToken: () => "write-before-base-receipt",
    });

    await expect(controller.attach({ mode: "enroll", file, document }))
      .rejects.toMatchObject({ code: "metadata-write-failed" });

    expect(files.writes).toEqual([expect.objectContaining({
      file,
      markdown: "shared content\n",
      options: { expectedVersion: null, echoToken: "write-before-base-receipt" },
    })]);
    await expect(files.read(file)).resolves.toMatchObject({
      markdown: "shared content\n",
      echoToken: "write-before-base-receipt",
    });
    await expect(backing.load(file.id)).resolves.toMatchObject({
      record: { file, documentId: document.id, base: null },
    });
    await controller.close();
  });

  it.each([
    {
      identity: "FileId",
      corrupt(record: ProjectionMetadataRecord): ProjectionMetadataRecord {
        return { ...record, file: { ...record.file, id: asFileId("another-file") } };
      },
    },
    {
      identity: "DocumentId",
      corrupt(record: ProjectionMetadataRecord): ProjectionMetadataRecord {
        return { ...record, documentId: asDocumentId("another-document") };
      },
    },
  ])("fails closed when metadata-conflict reload returns another $identity", async ({ corrupt }) => {
    const file = { id: asFileId("file-identity-reload"), path: "notes/identity.md" };
    const document = new MemoryDocument(asDocumentId("document-identity-reload"), "base\n");
    const files = new MemoryFiles();
    const backing = new MemoryMetadata();
    let corruptReload = false;
    const metadata: ProjectionMetadataStore = {
      async load(fileId) {
        const entry = await backing.load(fileId);
        return corruptReload && entry
          ? { ...entry, record: corrupt(entry.record) }
          : entry;
      },
      save: (record, expectedRevision) => backing.save(record, expectedRevision),
      delete: (record, expectedRevision) => backing.delete(record, expectedRevision),
    };
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document });
    const current = await backing.load(file.id);
    await backing.save(current!.record, current!.revision);
    corruptReload = true;
    document.edit("next\n");

    await expect(projection.flush()).rejects.toMatchObject({ code: "identity-collision" });

    expect(projection.getState()).toMatchObject({
      projection: "failed",
      diagnostic: { code: "identity-collision" },
    });
    await controller.close();
  });

  it("reconciles against the reloaded base and enters File Conflict when disk also changed", async () => {
    const file = { id: asFileId("file-metadata-race-conflict"), path: "notes/race.md" };
    const document = new MemoryDocument(asDocumentId("document-metadata-race-conflict"), "base\n");
    const files = new MemoryFiles();
    const backing = new MemoryMetadata();
    let raceNextBaseConfirmation = false;
    const metadata: ProjectionMetadataStore = {
      load: (fileId) => backing.load(fileId),
      delete: (record, expectedRevision) => backing.delete(record, expectedRevision),
      async save(record, expectedRevision) {
        if (raceNextBaseConfirmation && record.base?.markdown === "local\n") {
          raceNextBaseConfirmation = false;
          const latest = await backing.load(record.file.id);
          await backing.save(latest!.record, latest!.revision);
          files.external(file, "disk\n", "v3");
        }
        return backing.save(record, expectedRevision);
      },
    };
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document });
    raceNextBaseConfirmation = true;
    document.edit("local\n");

    await expect(projection.flush()).rejects.toMatchObject({ code: "projection-conflict" });

    expect(projection.getState()).toMatchObject({
      projection: "conflicted",
      conflict: {
        reason: "overlapping-edits",
        base: "base\n",
        live: { markdown: "local\n" },
        incoming: { markdown: "disk\n", version: "v3" },
      },
    });
    expect(files.writes).toHaveLength(1);
    expect(await files.read(file)).toMatchObject({ markdown: "disk\n", version: "v3" });
    await controller.close();
  });

  it("never rolls back a concurrently persisted rename while confirming a Projection Base", async () => {
    const file = { id: asFileId("file-concurrent-rename"), path: "notes/before.md" };
    const renamed = { ...file, path: "archive/after.md" };
    const document = new MemoryDocument(asDocumentId("document-concurrent-rename"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document });
    const current = await metadata.load(file.id);
    await metadata.save({ ...current!.record, file: renamed }, current!.revision);
    document.edit("local\n");

    await expect(projection.flush()).rejects.toMatchObject({ code: "identity-collision" });

    expect((await metadata.load(file.id))?.record.file).toEqual(renamed);
    expect(projection.getState()).toMatchObject({
      file,
      projection: "failed",
      diagnostic: { code: "identity-collision" },
    });
    await controller.close();
  });

  it("allows only one active File Projection for a Collaborative Document", async () => {
    const firstFile = { id: asFileId("file-primary"), path: "notes/primary.md" };
    const secondFile = { id: asFileId("file-secondary"), path: "notes/secondary.md" };
    const document = new MemoryDocument(asDocumentId("document-single-projection"), "shared\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(firstFile, "shared\n");
    files.seed(secondFile, "shared\n");
    const controller = createFileProjectionController({ files, metadata });
    const firstProjection = await controller.attach({ mode: "enroll", file: firstFile, document });

    await expect(controller.attach({ mode: "enroll", file: secondFile, document })).rejects.toMatchObject({
      code: "projection-already-attached",
    });

    await firstProjection.close();
    const secondProjection = await controller.attach({ mode: "enroll", file: secondFile, document });
    expect(secondProjection.getState()).toMatchObject({
      projection: "clean",
      documentId: document.id,
      file: secondFile,
    });

    await controller.close();
  });

  it("imports an external-only file edit through the collaborative Markdown port", async () => {
    const file = { id: asFileId("file-import"), path: "notes/import.md" };
    const document = new MemoryDocument(asDocumentId("document-import"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata });
    const projection = await controller.attach({ mode: "enroll", file, document });

    const incoming = files.external(file, "from disk\r\n", "v2");
    files.emit(file, { kind: "replaced", snapshot: incoming });
    await projection.settle();

    expect(document.applied).toEqual([{
      markdown: "from disk\n",
      origin: "external-file",
      expectedRevision: "1",
    }]);
    expect(projection.getState()).toMatchObject({
      projection: "clean",
      base: { markdown: "from disk\n", documentRevision: "2", fileVersion: "v2" },
    });
    expect(files.writes).toHaveLength(0);

    await controller.close();
  });

  it("does not roll the document or Projection Base back for a delayed older watcher snapshot", async () => {
    const file = { id: asFileId("file-stale-watch"), path: "notes/stale-watch.md" };
    const document = new MemoryDocument(asDocumentId("document-stale-watch"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata });
    const projection = await controller.attach({ mode: "enroll", file, document });

    const newest = files.external(file, "newest\n", "v3");
    files.emit(file, { kind: "replaced", snapshot: newest });
    await projection.settle();
    files.emit(file, {
      kind: "replaced",
      snapshot: { markdown: "older\n", version: "v2" },
    });
    await projection.settle();

    expect(document.applied).toEqual([{
      markdown: "newest\n",
      origin: "external-file",
      expectedRevision: "1",
    }]);
    expect(document.getMarkdownSnapshot()).toEqual({
      markdown: "newest\n",
      revision: "2",
    });
    expect((await metadata.load(file.id))?.record.base).toMatchObject({
      markdown: "newest\n",
      documentRevision: "2",
      fileVersion: "v3",
    });
    expect(await files.read(file)).toEqual(newest);

    await controller.close();
  });

  it("treats a changed event as deleted when its snapshot is stale and the current file is missing", async () => {
    const file = { id: asFileId("file-stale-watch-delete"), path: "notes/stale-delete.md" };
    const document = new MemoryDocument(asDocumentId("document-stale-watch-delete"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata });
    const projection = await controller.attach({ mode: "enroll", file, document });

    files.emit(file, { kind: "deleted" });
    files.emit(file, {
      kind: "changed",
      snapshot: { markdown: "stale before delete\n", version: "v2" },
    });
    await projection.settle();

    expect(document.applied).toHaveLength(0);
    expect(document.getMarkdownSnapshot().markdown).toBe("base\n");
    expect(projection.getState()).toMatchObject({
      projection: "missing",
      base: { markdown: "base\n", fileVersion: "v1" },
    });
    expect(await files.read(file)).toBeNull();

    await controller.close();
  });

  it("turns a reader's external file edit into a conflict and permits only keeping shared content", async () => {
    const file = { id: asFileId("file-reader-external"), path: "notes/reader.md" };
    const document = new MemoryDocument(asDocumentId("document-reader-external"), "shared\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "shared\n");
    const controller = createFileProjectionController({ files, metadata });
    const projection = await controller.attach({
      mode: "enroll",
      file,
      document,
      canApplyToDocument: () => false,
    });

    const incoming = files.external(file, "disk-only\n", "v2");
    files.emit(file, { kind: "replaced", snapshot: incoming });
    await projection.settle();

    expect(projection.getState()).toMatchObject({
      projection: "conflicted",
      conflict: {
        reason: "read-only",
        live: { markdown: "shared\n" },
        incoming: { markdown: "disk-only\n", version: "v2" },
      },
    });
    expect(document.applied).toHaveLength(0);
    const conflictId = projection.getState().conflict!.id;
    await expect(projection.resolve({ conflictId, choice: "use-disk" }))
      .rejects.toMatchObject({ code: "projection-conflict" });
    await expect(projection.resolve({ conflictId, choice: "manual", markdown: "manual\n" }))
      .rejects.toMatchObject({ code: "projection-conflict" });
    expect(projection.getState().projection).toBe("conflicted");

    await projection.resolve({ conflictId, choice: "use-live" });
    expect(document.applied).toHaveLength(0);
    expect(await files.read(file)).toMatchObject({ markdown: "shared\n", version: "v3" });
    expect(projection.getState().projection).toBe("clean");
    await controller.close();
  });

  it("reevaluates file-to-document authorization after access is upgraded", async () => {
    const file = { id: asFileId("file-reader-upgrade"), path: "notes/reader-upgrade.md" };
    const document = new MemoryDocument(asDocumentId("document-reader-upgrade"), "shared\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    let canApplyToDocument = false;
    files.seed(file, "shared\n");
    const controller = createFileProjectionController({ files, metadata });
    const projection = await controller.attach({
      mode: "enroll",
      file,
      document,
      canApplyToDocument: () => canApplyToDocument,
    });
    const incoming = files.external(file, "disk after upgrade\n", "v2");
    files.emit(file, { kind: "replaced", snapshot: incoming });
    await projection.settle();
    const conflictId = projection.getState().conflict!.id;

    canApplyToDocument = true;
    await projection.resolve({ conflictId, choice: "use-disk" });

    expect(document.applied).toEqual([{
      markdown: "disk after upgrade\n",
      origin: "external-file",
      expectedRevision: "1",
    }]);
    expect(projection.getState().projection).toBe("clean");
    await controller.close();
  });

  it("stops automatic writes on overlap and resolves only an explicit use-live choice", async () => {
    const file = { id: asFileId("file-conflict"), path: "notes/conflict.md" };
    const document = new MemoryDocument(asDocumentId("document-conflict"), "title\nbase\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "title\nbase\n");
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document });

    document.edit("title\nlive\n");
    const incoming = files.external(file, "title\ndisk\n", "v2");
    files.emit(file, { kind: "changed", snapshot: incoming });
    await projection.settle();

    expect(projection.getState()).toMatchObject({
      projection: "conflicted",
      conflict: {
        reason: "overlapping-edits",
        base: "title\nbase\n",
        live: { markdown: "title\nlive\n", revision: "2" },
        incoming: { markdown: "title\ndisk\n", version: "v2" },
      },
    });
    expect(files.writes).toHaveLength(0);
    expect(document.applied).toHaveLength(0);

    const conflictId = projection.getState().conflict!.id;
    await projection.resolve({ conflictId, choice: "use-live" });
    expect(files.writes).toHaveLength(1);
    expect(files.writes[0]).toMatchObject({
      markdown: "title\nlive\n",
      options: { expectedVersion: "v2" },
    });
    expect(projection.getState()).toMatchObject({
      projection: "clean",
      conflict: undefined,
      base: { markdown: "title\nlive\n", documentRevision: "2", fileVersion: "v3" },
    });

    await controller.close();
  });

  it("keeps a deleted file missing while collaboration continues", async () => {
    const file = { id: asFileId("file-delete"), path: "notes/deleted.md" };
    const document = new MemoryDocument(asDocumentId("document-delete"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata, debounceMs: 0 });
    const projection = await controller.attach({ mode: "enroll", file, document });

    files.emit(file, { kind: "deleted" });
    await projection.settle();
    document.edit("collaboration continues\n");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await projection.settle();

    expect(projection.getState().projection).toBe("missing");
    expect(document.getMarkdownSnapshot().markdown).toBe("collaboration continues\n");
    expect(files.writes).toHaveLength(0);

    await controller.close();
  });

  it("persists a rename without changing FileId or DocumentId", async () => {
    const file = { id: asFileId("file-rename"), path: "notes/before.md" };
    const renamed = { id: file.id, path: "archive/after.md" };
    const document = new MemoryDocument(asDocumentId("document-rename"), "content\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "content\n");
    const controller = createFileProjectionController({ files, metadata });
    const projection = await controller.attach({ mode: "enroll", file, document });

    files.emit(file, { kind: "renamed", file: renamed, snapshot: await files.read(file) as FileSnapshot });
    await projection.settle();

    expect(projection.getState()).toMatchObject({
      documentId: document.id,
      file: renamed,
      projection: "clean",
    });
    expect((await metadata.load(file.id))?.record).toMatchObject({
      file: renamed,
      documentId: document.id,
    });

    await controller.close();
  });

  it("reloads a newer Projection Base before persisting a rename from another window", async () => {
    const file = { id: asFileId("file-rename-window"), path: "notes/before.md" };
    const renamed = { id: file.id, path: "archive/after.md" };
    const documentId = asDocumentId("document-rename-window");
    const firstDocument = new MemoryDocument(documentId, "content\n");
    const secondDocument = new MemoryDocument(documentId, "content\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "content\n");
    const firstController = createFileProjectionController({ files, metadata });
    const secondController = createFileProjectionController({ files, metadata });
    const first = await firstController.attach({ mode: "enroll", file, document: firstDocument });
    await secondController.attach({ mode: "resume", file, document: secondDocument });

    await expect(first.move(renamed)).resolves.toBeUndefined();

    expect(metadata.conflicts).toEqual([file.id]);
    expect(first.getState()).toMatchObject({ file: renamed, projection: "clean" });
    expect((await metadata.load(file.id))?.record).toMatchObject({
      file: renamed,
      documentId,
      base: { markdown: "content\n", fileVersion: "v1" },
    });
    expect(files.activeWatcherCount(file)).toBe(2);
    await firstController.close();
    await secondController.close();
  });

  it("keeps the old path and watcher when rename metadata fails, then retries cleanly", async () => {
    const file = { id: asFileId("file-rename-metadata-failure"), path: "notes/before.md" };
    const renamed = { id: file.id, path: "archive/after.md" };
    const document = new MemoryDocument(asDocumentId("document-rename-metadata-failure"), "content\n");
    const files = new MemoryFiles();
    const backing = new MemoryMetadata();
    let failRename = true;
    const metadata: ProjectionMetadataStore = {
      load: (fileId) => backing.load(fileId),
      delete: (record, expectedRevision) => backing.delete(record, expectedRevision),
      save(record, expectedRevision) {
        if (failRename && record.file.path === renamed.path) throw new Error("metadata unavailable");
        return backing.save(record, expectedRevision);
      },
    };
    files.seed(file, "content\n");
    const controller = createFileProjectionController({ files, metadata });
    const projection = await controller.attach({ mode: "enroll", file, document });

    await expect(projection.move(renamed)).rejects.toMatchObject({ code: "metadata-write-failed" });
    expect(projection.getState()).toMatchObject({
      file,
      projection: "failed",
      diagnostic: { code: "metadata-write-failed" },
    });
    expect((await backing.load(file.id))?.record.file).toEqual(file);
    expect(files.activeWatcherCount(file)).toBe(1);

    failRename = false;
    await projection.move(renamed);
    expect(projection.getState()).toMatchObject({ file: renamed, projection: "clean" });
    expect((await backing.load(file.id))?.record.file).toEqual(renamed);
    expect(files.activeWatcherCount(file)).toBe(1);
    await controller.close();
  });

  it("keeps rename metadata and state unchanged when the replacement watcher cannot start", async () => {
    const file = { id: asFileId("file-rename-watch-failure"), path: "notes/before.md" };
    const renamed = { id: file.id, path: "archive/after.md" };
    const document = new MemoryDocument(asDocumentId("document-rename-watch-failure"), "content\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "content\n");
    const controller = createFileProjectionController({ files, metadata });
    const projection = await controller.attach({ mode: "enroll", file, document });
    files.watchError = new Error("watch unavailable");

    await expect(projection.move(renamed)).rejects.toMatchObject({ code: "file-watch-failed" });
    expect(projection.getState()).toMatchObject({
      file,
      projection: "failed",
      diagnostic: { code: "file-watch-failed" },
    });
    expect((await metadata.load(file.id))?.record.file).toEqual(file);
    expect(files.activeWatcherCount(file)).toBe(1);

    files.watchError = null;
    await projection.move(renamed);
    expect(projection.getState()).toMatchObject({ file: renamed, projection: "clean" });
    expect((await metadata.load(file.id))?.record.file).toEqual(renamed);
    expect(files.activeWatcherCount(file)).toBe(1);
    await controller.close();
  });

  it("never overwrites mismatched content without a base and imports disk only after explicit resolution", async () => {
    const file = { id: asFileId("file-no-base"), path: "notes/unrelated.md" };
    const document = new MemoryDocument(asDocumentId("document-no-base"), "remote content\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "local unrelated content\n");
    const controller = createFileProjectionController({ files, metadata });
    const projection = await controller.attach({ mode: "enroll", file, document });

    expect(projection.getState()).toMatchObject({
      projection: "conflicted",
      conflict: {
        reason: "no-base",
        base: null,
        live: { markdown: "remote content\n", revision: "1" },
        incoming: { markdown: "local unrelated content\n", version: "v1" },
      },
    });
    expect(files.writes).toHaveLength(0);
    expect(document.applied).toHaveLength(0);

    await projection.resolve({ conflictId: projection.getState().conflict!.id, choice: "use-disk" });
    expect(document.applied).toEqual([{
      markdown: "local unrelated content\n",
      origin: "external-file",
      expectedRevision: "1",
    }]);
    expect(projection.getState()).toMatchObject({
      projection: "clean",
      base: {
        markdown: "local unrelated content\n",
        documentRevision: "2",
        fileVersion: "v1",
      },
    });

    await controller.close();
  });

  it("reports an atomic write failure without rolling back the collaborative document or advancing the base", async () => {
    const file = { id: asFileId("file-write-failure"), path: "notes/failure.md" };
    const document = new MemoryDocument(asDocumentId("document-write-failure"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document });
    document.edit("live survives\n");
    files.writeError = new Error("disk full");

    await expect(projection.flush()).rejects.toMatchObject({ code: "file-write-failed" });

    expect(document.getMarkdownSnapshot()).toEqual({ markdown: "live survives\n", revision: "2" });
    expect((await files.read(file))?.markdown).toBe("base\n");
    expect((await metadata.load(file.id))?.record.base).toMatchObject({
      markdown: "base\n",
      documentRevision: "1",
      fileVersion: "v1",
    });
    expect(projection.getState()).toMatchObject({
      projection: "failed",
      diagnostic: { code: "file-write-failed" },
    });

    await controller.close();
  });

  it("applies an explicit manual conflict resolution to collaboration and disk", async () => {
    const file = { id: asFileId("file-manual"), path: "notes/manual.md" };
    const document = new MemoryDocument(asDocumentId("document-manual"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document });
    document.edit("live\n");
    const incoming = files.external(file, "disk\n", "v2");
    files.emit(file, { kind: "changed", snapshot: incoming });
    await projection.settle();

    await projection.resolve({
      conflictId: projection.getState().conflict!.id,
      choice: "manual",
      markdown: "manually merged\r\n",
    });

    expect(document.applied).toEqual([{
      markdown: "manually merged\n",
      origin: "file-conflict-resolution",
      expectedRevision: "2",
    }]);
    expect(files.writes[0]).toMatchObject({
      markdown: "manually merged\n",
      options: { expectedVersion: "v2" },
    });
    expect(projection.getState()).toMatchObject({
      projection: "clean",
      base: { markdown: "manually merged\n", documentRevision: "3", fileVersion: "v3" },
    });

    await controller.close();
  });

  it("keeps canonical LF in collaboration while honoring the Host file line-ending policy", async () => {
    const file = { id: asFileId("file-crlf"), path: "notes/windows.md" };
    const document = new MemoryDocument(asDocumentId("document-crlf"), "first\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "first\r\n");
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({
      mode: "enroll",
      file,
      document,
      policy: { lineEnding: "preserve", finalNewline: "always" },
    });
    document.edit("first\nsecond\n");

    await projection.flush();

    expect(files.writes[0]?.markdown).toBe("first\r\nsecond\r\n");
    expect(projection.getState().base?.markdown).toBe("first\nsecond\n");

    await controller.close();
  });

  it("keeps a forced final newline at the file boundary across enrollment, watcher echo, and resume", async () => {
    const file = { id: asFileId("file-final-newline-boundary"), path: "notes/final-newline.md" };
    const documentId = asDocumentId("document-final-newline-boundary");
    const document = new MemoryDocument(documentId, "first");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "first\n");
    const policy = { lineEnding: "preserve", finalNewline: "always" } as const;
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document, policy });

    expect(projection.getState()).toMatchObject({
      projection: "clean",
      base: { markdown: "first", fileVersion: "v1" },
    });
    expect(document.applied).toHaveLength(0);

    document.edit("second");
    await projection.flush();
    expect(files.writes).toHaveLength(1);
    expect(files.writes[0]?.markdown).toBe("second\n");
    expect(document.getMarkdownSnapshot().markdown).toBe("second");

    files.emit(file, { kind: "changed", snapshot: await files.read(file) as FileSnapshot });
    await projection.settle();
    expect(document.applied).toHaveLength(0);
    expect((await metadata.load(file.id))?.revision).toBe("3");

    await controller.close();

    const resumedDocument = new MemoryDocument(documentId, "second");
    const resumedController = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const resumed = await resumedController.attach({
      mode: "resume",
      file,
      document: resumedDocument,
      policy,
    });
    expect(resumed.getState()).toMatchObject({
      projection: "clean",
      base: { markdown: "second", fileVersion: "v2" },
    });
    expect(resumedDocument.applied).toHaveLength(0);
    expect(files.writes).toHaveLength(1);

    await resumedController.close();
  });

  it.each([
    {
      name: "always",
      policy: { finalNewline: "always" } as const,
      collaborativeBase: "base",
      fileBase: "base\n",
      externalFile: "changed\n",
      expectedCollaborative: "changed",
    },
    {
      name: "never",
      policy: { finalNewline: "never" } as const,
      collaborativeBase: "base\n",
      fileBase: "base",
      externalFile: "changed",
      expectedCollaborative: "changed\n",
    },
  ])("keeps the $name final-newline policy out of external collaborative edits", async ({
    name,
    policy,
    collaborativeBase,
    fileBase,
    externalFile,
    expectedCollaborative,
  }) => {
    const file = { id: asFileId(`file-external-final-newline-${name}`), path: `notes/${name}.md` };
    const document = new MemoryDocument(
      asDocumentId(`document-external-final-newline-${name}`),
      collaborativeBase,
    );
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, fileBase);
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document, policy });

    files.emit(file, {
      kind: "changed",
      snapshot: files.external(file, externalFile, "v2"),
    });
    await projection.settle();

    expect(document.applied).toEqual([{
      markdown: expectedCollaborative,
      origin: "external-file",
      expectedRevision: "1",
    }]);
    expect(projection.getState()).toMatchObject({
      projection: "clean",
      base: { markdown: expectedCollaborative, fileVersion: "v2" },
    });

    await controller.close();
  });

  it("rejects a stale conflict choice when disk changed again", async () => {
    const file = { id: asFileId("file-stale-conflict"), path: "notes/stale.md" };
    const document = new MemoryDocument(asDocumentId("document-stale-conflict"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document });
    document.edit("live\n");
    files.emit(file, {
      kind: "changed",
      snapshot: files.external(file, "disk one\n", "v2"),
    });
    await projection.settle();
    const staleId = projection.getState().conflict!.id;
    files.external(file, "disk two\n", "v3");

    await expect(projection.resolve({ conflictId: staleId, choice: "use-live" }))
      .rejects.toMatchObject({ code: "stale-conflict" });

    expect(projection.getState()).toMatchObject({
      projection: "conflicted",
      conflict: { incoming: { markdown: "disk two\n", version: "v3" } },
    });
    expect(projection.getState().conflict?.id).not.toBe(staleId);
    expect(files.writes).toHaveLength(0);

    await controller.close();
  });

  it("rejects a stale conflict choice when the collaborative revision advanced before notification", async () => {
    const file = { id: asFileId("file-stale-live-conflict"), path: "notes/stale-live.md" };
    const document = new MemoryDocument(asDocumentId("document-stale-live-conflict"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document });
    document.edit("first live\n");
    files.emit(file, {
      kind: "changed",
      snapshot: files.external(file, "disk\n", "v2"),
    });
    await projection.settle();
    const staleId = projection.getState().conflict!.id;

    // A port may make its new revision observable before its subscription
    // callback is delivered. Resolution still has to validate both sides.
    document.editBeforeNotification("newer live\n");
    await expect(projection.resolve({ conflictId: staleId, choice: "use-live" }))
      .rejects.toMatchObject({ code: "stale-conflict" });

    expect(files.writes).toHaveLength(0);
    expect(projection.getState()).toMatchObject({
      projection: "conflicted",
      conflict: {
        live: { markdown: "newer live\n", revision: "3" },
        incoming: { markdown: "disk\n", version: "v2" },
      },
    });
    expect(projection.getState().conflict?.id).not.toBe(staleId);
    await controller.close();
  });

  it("reconciles the current file before flush instead of overwriting a delayed watcher event", async () => {
    const file = { id: asFileId("file-delayed-watch"), path: "notes/delayed.md" };
    const document = new MemoryDocument(asDocumentId("document-delayed-watch"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document });
    document.edit("live\n");
    files.external(file, "disk\n", "v2");

    await expect(projection.flush()).rejects.toMatchObject({ code: "projection-conflict" });

    expect(files.writes).toHaveLength(0);
    expect(document.applied).toHaveLength(0);
    expect(projection.getState()).toMatchObject({
      projection: "conflicted",
      conflict: { live: { markdown: "live\n" }, incoming: { markdown: "disk\n" } },
    });

    await controller.close();
  });

  it("stays dirty when collaboration changes while an atomic file write is in flight", async () => {
    const file = { id: asFileId("file-write-race"), path: "notes/write-race.md" };
    const document = new MemoryDocument(asDocumentId("document-write-race"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    let releaseWrite!: () => void;
    const writeBarrier = new Promise<void>((resolve) => { releaseWrite = resolve; });
    let signalWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => { signalWriteStarted = resolve; });
    files.beforeWrite = async () => {
      signalWriteStarted();
      await writeBarrier;
    };
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document });
    document.edit("first live revision\n");

    const firstFlush = projection.flush();
    await writeStarted;
    document.edit("newer live revision\n");
    releaseWrite();
    await firstFlush;

    expect((await files.read(file))?.markdown).toBe("first live revision\n");
    expect(projection.getState()).toMatchObject({
      projection: "dirty",
      base: { markdown: "first live revision\n", documentRevision: "2", fileVersion: "v2" },
    });

    files.beforeWrite = null;
    await projection.flush();
    expect((await files.read(file))?.markdown).toBe("newer live revision\n");
    expect(projection.getState()).toMatchObject({
      projection: "clean",
      base: { markdown: "newer live revision\n", documentRevision: "3", fileVersion: "v3" },
    });

    await controller.close();
  });

  it("turns an optimistic-version race into an explicit conflict", async () => {
    const file = { id: asFileId("file-version-race"), path: "notes/version-race.md" };
    const document = new MemoryDocument(asDocumentId("document-version-race"), "base\n");
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, "base\n");
    let releaseWrite!: () => void;
    const writeBarrier = new Promise<void>((resolve) => { releaseWrite = resolve; });
    let signalWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => { signalWriteStarted = resolve; });
    files.beforeWrite = async () => {
      signalWriteStarted();
      await writeBarrier;
    };
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document });
    document.edit("live\n");

    const flush = projection.flush();
    await writeStarted;
    files.external(file, "disk\n", "v2");
    releaseWrite();

    await expect(flush).rejects.toMatchObject({ code: "projection-conflict" });
    expect(files.writes).toHaveLength(0);
    expect(projection.getState()).toMatchObject({
      projection: "conflicted",
      conflict: {
        reason: "stale-version",
        base: "base\n",
        live: { markdown: "live\n" },
        incoming: { markdown: "disk\n", version: "v2" },
      },
    });

    await controller.close();
  });

  it("applies a clean three-way merge to both the Collaborative Document and file", async () => {
    const base = "title\nalpha\nbeta\nomega\n";
    const file = { id: asFileId("file-clean-merge"), path: "notes/merge.md" };
    const document = new MemoryDocument(asDocumentId("document-clean-merge"), base);
    const files = new MemoryFiles();
    const metadata = new MemoryMetadata();
    files.seed(file, base);
    const controller = createFileProjectionController({ files, metadata, debounceMs: 60_000 });
    const projection = await controller.attach({ mode: "enroll", file, document });
    document.edit("title\nALPHA\nbeta\nomega\n");
    files.emit(file, {
      kind: "changed",
      snapshot: files.external(file, "title\nalpha\nbeta\nOMEGA\n", "v2"),
    });

    await projection.settle();

    const merged = "title\nALPHA\nbeta\nOMEGA\n";
    expect(document.applied).toEqual([{
      markdown: merged,
      origin: "external-file",
      expectedRevision: "2",
    }]);
    expect(files.writes[0]).toMatchObject({ markdown: merged, options: { expectedVersion: "v2" } });
    expect(projection.getState()).toMatchObject({
      projection: "clean",
      base: { markdown: merged, documentRevision: "3", fileVersion: "v3" },
    });

    await controller.close();
  });
});
