import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  LLMWikiCompileQueue,
  LLMWikiDocumentQueue,
  LLMWikiDocumentStatus,
  LLMWikiIngestFileResult,
  LLMWikiStateStore,
  classifyProjectPath,
  computeContentHash,
  deriveRawFileName,
  normalizeProjectIssues,
  prepareSaveSource,
  rawTargetPath,
  parsePositiveInteger,
  readLLMWikiEnv,
  resolveLLMWikiProjectRoot,
  runPythonJson,
  runSidecarIngestFile,
  runSidecarQuery,
  saveLLMWikiSource,
  runSidecarCompile,
  sanitizeRawFileName,
  writeLLMWikiConfig,
  getLLMWikiConfigStatus,
} from "../electron/llm-wiki";

describe("LLM Wiki project helpers", () => {
  it("uses the active vault as the project root when one is open", () => {
    expect(resolveLLMWikiProjectRoot("C:\\vault", "C:\\Users\\me\\Documents")).toBe(
      path.resolve("C:\\vault")
    );
  });

  it("falls back to Documents/Nexus LLM Wiki when no vault is open", () => {
    expect(resolveLLMWikiProjectRoot(null, "C:\\Users\\me\\Documents")).toBe(
      path.resolve("C:\\Users\\me\\Documents", "Nexus LLM Wiki")
    );
  });

  it("classifies raw, wiki, and external paths inside a project", () => {
    const project = path.resolve("C:\\vault");

    expect(classifyProjectPath(path.join(project, "raw", "a.md"), project)).toBe("raw");
    expect(classifyProjectPath(path.join(project, "wiki", "a.md"), project)).toBe("wiki");
    expect(classifyProjectPath(path.join(project, "notes", "a.md"), project)).toBe("external");
    expect(classifyProjectPath("C:\\outside\\a.md", project)).toBe("external");
  });

  it("sanitizes unsafe raw file names without allowing path escapes", () => {
    expect(sanitizeRawFileName("../Bad\\Name.txt")).toBe("Bad-Name.md");
    expect(sanitizeRawFileName("")).toBe("untitled.md");
  });

  it("derives a raw file name from heading before falling back to source path", () => {
    expect(deriveRawFileName("C:\\downloads\\source.txt", "# My Wiki Seed\n\nbody")).toBe(
      "My Wiki Seed.md"
    );
  });

  it("places external source content under project raw with a safe heading-derived markdown name", () => {
    const project = path.resolve("C:\\vault");

    expect(rawTargetPath(project, null, "# Untitled Import\n\nbody")).toBe(
      path.join(project, "raw", "Untitled Import.md")
    );
    expect(rawTargetPath(project, null, "body without heading")).toBe(
      path.join(project, "raw", "untitled.md")
    );
  });
});

describe("LLM Wiki document state store", () => {
  it("resets generated metadata when changed raw content becomes dirty again", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      const store = new LLMWikiStateStore(tmp);
      await store.markDirty("raw/note.md", "# v1", new Date("2026-06-22T00:00:00.000Z"));
      await store.complete(
        "raw/note.md",
        computeContentHash("# v1"),
        {
          written: ["wiki/note.md"],
          pages: ["note"],
          events: ["note-event"],
        },
        new Date("2026-06-22T00:10:00.000Z")
      );

      const changed = await store.markDirty("raw/note.md", "# v2", new Date("2026-06-22T01:00:00.000Z"));
      const state = await store.read();

      expect(changed).toBe(true);
      expect(state.documents["raw/note.md"].status).toBe("dirty");
      expect(state.documents["raw/note.md"].submittedAt).toBeNull();
      expect(state.documents["raw/note.md"].completedAt).toBeNull();
      expect(state.documents["raw/note.md"].generated).toEqual([]);
      expect(state.documents["raw/note.md"].events).toEqual([]);
      expect(state.documents["raw/note.md"].error).toBeNull();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("keeps parsed status when raw content hash is unchanged", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      const store = new LLMWikiStateStore(tmp);
      await store.markDirty("raw/note.md", "# v1", new Date("2026-06-22T00:00:00.000Z"));
      await store.complete(
        "raw/note.md",
        computeContentHash("# v1"),
        {
          written: ["wiki/note.md"],
          pages: ["note"],
          events: [],
        },
        new Date("2026-06-22T00:00:00.000Z")
      );

      const changed = await store.markDirty("raw/note.md", "# v1", new Date("2026-06-22T02:00:00.000Z"));
      const state = await store.read();

      expect(changed).toBe(false);
      expect(state.documents["raw/note.md"].status).toBe("parsed");
      expect(state.documents["raw/note.md"].completedAt).toBe("2026-06-22T00:00:00.000Z");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects non-raw and escaping document paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      const store = new LLMWikiStateStore(tmp);

      await expect(store.markDirty("../escape.md", "bad")).rejects.toThrow(/raw document path/);
      await expect(store.markDirty("wiki/note.md", "bad")).rejects.toThrow(/raw document path/);
      await expect(store.markDirty("C:/absolute.md", "bad")).rejects.toThrow(/raw document path/);
      await expect(store.markDirty("raw\\backslash.md", "bad")).rejects.toThrow(/raw document path/);
      await expect(store.markDirty("raw//note.md", "bad")).rejects.toThrow(/raw document path/);
      await expect(store.markDirty("raw/./note.md", "bad")).rejects.toThrow(/raw document path/);
      await expect(store.markDirty("raw/bad\u0001name.md", "bad")).rejects.toThrow(/raw document path/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("persists submit mode in the state file", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      const store = new LLMWikiStateStore(tmp);
      expect((await store.read()).mode).toBe("manual");

      await store.setMode("auto");

      const reloaded = new LLMWikiStateStore(tmp);
      expect((await reloaded.read()).mode).toBe("auto");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns default state when the persisted state file is malformed JSON", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      await mkdir(path.join(tmp, ".nexus"), { recursive: true });
      await writeFile(path.join(tmp, ".nexus", "llm-wiki-state.json"), "{not-json", "utf-8");

      const store = new LLMWikiStateStore(tmp);

      expect(await store.read()).toEqual({
        version: 1,
        mode: "manual",
        documents: {},
        projectIssues: [],
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("propagates non-JSON read errors instead of returning default state", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      await mkdir(path.join(tmp, ".nexus", "llm-wiki-state.json"), { recursive: true });

      const store = new LLMWikiStateStore(tmp);

      await expect(store.read()).rejects.toThrow();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("normalizes partial state files by filtering invalid documents and issues", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    const validDoc = {
      status: "parsed",
      contentHash: computeContentHash("# ok"),
      updatedAt: "2026-06-22T00:00:00.000Z",
      submittedAt: "2026-06-22T00:01:00.000Z",
      completedAt: "2026-06-22T00:02:00.000Z",
      error: null,
      generated: ["wiki/valid.md"],
      events: ["valid-event"],
    };
    try {
      await mkdir(path.join(tmp, ".nexus"), { recursive: true });
      await writeFile(
        path.join(tmp, ".nexus", "llm-wiki-state.json"),
        JSON.stringify({
          mode: "auto",
          documents: {
            "raw/valid.md": validDoc,
            "raw/array-value.md": [],
            "raw/missing-status.md": { ...validDoc, status: undefined },
            "raw/invalid-status.md": { ...validDoc, status: "unknown" },
            "raw/bad-hash.md": { ...validDoc, contentHash: "not-sha256" },
            "raw\\backslash.md": validDoc,
            "wiki/not-raw.md": validDoc,
          },
          projectIssues: [
            { code: "lint", path: "wiki/valid.md", message: "valid issue" },
            { code: "bad-path", path: 123, message: "invalid issue" },
            "not-an-issue",
          ],
        }),
        "utf-8"
      );

      const store = new LLMWikiStateStore(tmp);
      const state = await store.read();

      expect(state.mode).toBe("auto");
      expect(state.documents).toEqual({ "raw/valid.md": validDoc });
      expect(state.projectIssues).toEqual([{ code: "lint", path: "wiki/valid.md", message: "valid issue" }]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("serializes concurrent updates across store instances", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      const first = new LLMWikiStateStore(tmp);
      const second = new LLMWikiStateStore(tmp);

      await Promise.all([first.markDirty("raw/a.md", "# a"), second.markDirty("raw/b.md", "# b")]);

      const state = await first.read();
      expect(Object.keys(state.documents).sort()).toEqual(["raw/a.md", "raw/b.md"]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects unsafe generated paths without changing document state", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      const store = new LLMWikiStateStore(tmp);
      await store.markDirty("raw/note.md", "# note", new Date("2026-06-22T00:00:00.000Z"));
      await store.enqueue("raw/note.md", new Date("2026-06-22T00:01:00.000Z"));
      const before = await store.read();

      await expect(
        store.complete(
          "raw/note.md",
          computeContentHash("# note"),
          { written: ["../escape.md"], pages: [], events: [] },
          new Date("2026-06-22T00:02:00.000Z")
        )
      ).rejects.toThrow(/generated/);

      expect(await store.read()).toEqual(before);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects unsafe ingest event slugs without changing document state", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      const store = new LLMWikiStateStore(tmp);
      await store.markDirty("raw/note.md", "# note", new Date("2026-06-22T00:00:00.000Z"));
      const before = await store.read();

      await expect(
        store.complete(
          "raw/note.md",
          computeContentHash("# note"),
          { written: ["wiki/note.md"], pages: [], events: ["Bad Event"] },
          new Date("2026-06-22T00:02:00.000Z")
        )
      ).rejects.toThrow(/event/);

      expect(await store.read()).toEqual(before);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("cleans control characters from failed status errors and truncates them", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      const store = new LLMWikiStateStore(tmp);
      await store.markDirty("raw/note.md", "# note");

      await store.fail("raw/note.md", computeContentHash("# note"), `bad\u0000error ${"x".repeat(1200)}`);

      const error = (await store.read()).documents["raw/note.md"].error;
      expect(error).not.toBeNull();
      expect(error).not.toMatch(/[\u0000-\u001f\u007f]/);
      expect(error?.length).toBeLessThanOrEqual(1000);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("cleans multiple control characters from failed status errors", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      const store = new LLMWikiStateStore(tmp);
      await store.markDirty("raw/note.md", "# note");

      await store.fail("raw/note.md", computeContentHash("# note"), "a\u0000b\u0008c\u001fd");

      expect((await store.read()).documents["raw/note.md"].error).toBe("a b c d");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects missing ingest events without changing document state", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      const store = new LLMWikiStateStore(tmp);
      await store.markDirty("raw/note.md", "# note", new Date("2026-06-22T00:00:00.000Z"));
      const before = await store.read();

      await expect(
        store.complete(
          "raw/note.md",
          computeContentHash("# note"),
          { written: ["wiki/note.md"], pages: [] } as unknown as Parameters<LLMWikiStateStore["complete"]>[2],
          new Date("2026-06-22T00:02:00.000Z")
        )
      ).rejects.toThrow(/events/);

      expect(await store.read()).toEqual(before);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects missing generated paths without changing document state", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      const store = new LLMWikiStateStore(tmp);
      await store.markDirty("raw/note.md", "# note", new Date("2026-06-22T00:00:00.000Z"));
      const before = await store.read();

      await expect(
        store.complete(
          "raw/note.md",
          computeContentHash("# note"),
          { pages: [], events: [] } as unknown as Parameters<LLMWikiStateStore["complete"]>[2],
          new Date("2026-06-22T00:02:00.000Z")
        )
      ).rejects.toThrow(/generated/);

      expect(await store.read()).toEqual(before);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("continues processing mutations after a failed mutation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      const store = new LLMWikiStateStore(tmp);
      await store.markDirty("raw/note.md", "# note");
      await expect(
        store.complete(
          "raw/note.md",
          computeContentHash("# note"),
          { pages: [], events: [] } as unknown as Parameters<LLMWikiStateStore["complete"]>[2]
        )
      ).rejects.toThrow(/generated/);

      await store.setMode("auto");

      expect((await store.read()).mode).toBe("auto");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("persists project issues without extra fields", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      const store = new LLMWikiStateStore(tmp);

      await store.setProjectIssues([{ code: "lint", path: "wiki/note.md", message: "bad link", extra: "x" } as any]);

      expect((await store.read()).projectIssues).toEqual([{ code: "lint", path: "wiki/note.md", message: "bad link" }]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("leaves document state unchanged when complete receives a stale hash", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      const store = new LLMWikiStateStore(tmp);
      await store.markDirty("raw/note.md", "# note");
      const before = await store.read();

      await expect(
        store.complete("raw/note.md", computeContentHash("# stale"), { written: ["wiki/note.md"], pages: [], events: [] })
      ).resolves.toBeNull();

      expect(await store.read()).toEqual(before);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("leaves document state unchanged when fail receives a stale hash", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-state-"));
    try {
      const store = new LLMWikiStateStore(tmp);
      await store.markDirty("raw/note.md", "# note");
      const before = await store.read();

      await expect(store.fail("raw/note.md", computeContentHash("# stale"), "failed")).resolves.toBeNull();

      expect(await store.read()).toEqual(before);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("LLM Wiki document queue", () => {
  it("runs at most four document tasks concurrently", async () => {
    const running = new Set<string>();
    const maxRunning: number[] = [];
    const releases = new Map<
      string,
      {
        promise: Promise<LLMWikiIngestFileResult>;
        resolve(value: LLMWikiIngestFileResult): void;
        reject(error: unknown): void;
      }
    >();
    const emitted: Array<{ rawPath: string; status: LLMWikiDocumentStatus }> = [];

    const queue = new LLMWikiDocumentQueue({
      concurrency: 4,
      loadTask: async (rawPath) => ({ rawPath, contentHash: `hash-${rawPath}` }),
      runner: async ({ rawPath }) => {
        running.add(rawPath);
        maxRunning.push(running.size);
        const release = deferred<LLMWikiIngestFileResult>();
        releases.set(rawPath, release);
        const result = await release.promise;
        running.delete(rawPath);
        return result;
      },
      complete: async (rawPath, hash, result) => ({
        status: "parsed",
        contentHash: hash,
        updatedAt: "2026-06-22T00:00:00.000Z",
        submittedAt: "2026-06-22T00:00:00.000Z",
        completedAt: "2026-06-22T00:00:01.000Z",
        error: null,
        generated: result.written ?? [],
        events: result.events,
      }),
      fail: async () => null,
      emit: (rawPath, status) => emitted.push({ rawPath, status }),
    });

    for (let i = 0; i < 6; i += 1) queue.enqueue(`raw/${i}.md`);
    await flushTimers();

    expect(Math.max(...maxRunning)).toBe(4);
    expect(releases.size).toBe(4);

    releases.get("raw/0.md")?.resolve(createIngestFileResult("raw/0.md"));
    await flushTimers();

    expect(releases.has("raw/4.md")).toBe(true);
    expect(Math.max(...maxRunning)).toBe(4);
    expect(emitted.some((entry) => entry.rawPath === "raw/0.md" && entry.status.status === "parsed")).toBe(true);

    releases.get("raw/1.md")?.resolve(createIngestFileResult("raw/1.md"));
    await flushTimers();

    expect(releases.has("raw/5.md")).toBe(true);

    for (let i = 2; i < 6; i += 1) {
      releases.get(`raw/${i}.md`)?.resolve(createIngestFileResult(`raw/${i}.md`));
    }
    await queue.waitForIdle();
  });

  it("deduplicates queued raw paths and ignores stale task completion", async () => {
    let currentHash = "old-hash";
    const runCalls: string[] = [];
    const emit = vi.fn();
    const queue = new LLMWikiDocumentQueue({
      concurrency: 4,
      loadTask: async (rawPath) => ({ rawPath, contentHash: currentHash }),
      runner: async ({ rawPath }) => {
        runCalls.push(rawPath);
        currentHash = "new-hash";
        return { ok: true, operation: "ingest-file", raw: rawPath, written: ["wiki/note.md"], pages: ["note"], events: [] };
      },
      complete: async (_rawPath, expectedHash) => {
        expect(expectedHash).toBe("old-hash");
        expect(currentHash).toBe("new-hash");
        return null;
      },
      fail: async () => null,
      emit,
    });

    queue.enqueue("raw/note.md");
    queue.enqueue("raw/note.md");
    await queue.waitForIdle();

    expect(runCalls).toEqual(["raw/note.md"]);
    expect(emit).not.toHaveBeenCalled();
  });

  it("queues one rerun for a raw path enqueued while it is running", async () => {
    let currentHash = "hash-1";
    const releaseFirst = deferred<LLMWikiIngestFileResult>();
    const runCalls: string[] = [];
    const taskHashes: string[] = [];
    const completedHashes: string[] = [];
    let active = 0;
    const maxActive: number[] = [];
    const queue = new LLMWikiDocumentQueue({
      concurrency: 4,
      loadTask: async (rawPath) => ({ rawPath, contentHash: currentHash }),
      runner: async (task) => {
        runCalls.push(task.rawPath);
        taskHashes.push(task.contentHash);
        active += 1;
        maxActive.push(active);
        try {
          if (runCalls.length === 1) return await releaseFirst.promise;
          return createIngestFileResult(task.rawPath);
        } finally {
          active -= 1;
        }
      },
      complete: async (_rawPath, hash, result) => {
        completedHashes.push(hash);
        return createParsedDocumentStatus(hash, result);
      },
      fail: async () => null,
      emit: vi.fn(),
    });

    queue.enqueue("raw/note.md");
    await flushTimers();

    expect(runCalls).toEqual(["raw/note.md"]);

    currentHash = "hash-2";
    queue.enqueue("raw/note.md");
    queue.enqueue("raw/note.md");
    await flushTimers();

    expect(runCalls).toEqual(["raw/note.md"]);

    releaseFirst.resolve(createIngestFileResult("raw/note.md"));
    await queue.waitForIdle();

    expect(runCalls).toEqual(["raw/note.md", "raw/note.md"]);
    expect(taskHashes).toEqual(["hash-1", "hash-2"]);
    expect(completedHashes).toEqual(["hash-1", "hash-2"]);
    expect(Math.max(...maxActive)).toBe(1);
  });

  it("does not fail a successful task when emit throws", async () => {
    const fail = vi.fn(async () => null);
    const queue = new LLMWikiDocumentQueue({
      concurrency: 4,
      loadTask: async (rawPath) => ({ rawPath, contentHash: "hash-note" }),
      runner: async ({ rawPath }) => createIngestFileResult(rawPath),
      complete: async (_rawPath, hash, result) => createParsedDocumentStatus(hash, result),
      fail,
      emit: () => {
        throw new Error("renderer listener failed");
      },
    });

    queue.enqueue("raw/note.md");
    await queue.waitForIdle();

    expect(fail).not.toHaveBeenCalled();
  });

  it("continues after both runner and fail handlers throw", async () => {
    const runCalls: string[] = [];
    const completed: string[] = [];
    const emitted: Array<{ rawPath: string; status: string }> = [];
    const queue = new LLMWikiDocumentQueue({
      concurrency: 1,
      loadTask: async (rawPath) => ({ rawPath, contentHash: `hash-${rawPath}` }),
      runner: async ({ rawPath }) => {
        runCalls.push(rawPath);
        if (rawPath === "raw/a.md") throw new Error("provider failed");
        return createIngestFileResult(rawPath);
      },
      complete: async (rawPath, hash, result) => {
        completed.push(rawPath);
        return createParsedDocumentStatus(hash, result);
      },
      fail: async () => {
        throw new Error("state write failed");
      },
      emit: (rawPath, status) => emitted.push({ rawPath, status: status.status }),
    });

    queue.enqueue("raw/a.md");
    queue.enqueue("raw/b.md");
    await queue.waitForIdle();

    expect(runCalls).toEqual(["raw/a.md", "raw/b.md"]);
    expect(completed).toEqual(["raw/b.md"]);
    expect(emitted).toEqual([{ rawPath: "raw/b.md", status: "parsed" }]);
  });

  it("continues without fail when loadTask throws before a task hash exists", async () => {
    const runCalls: string[] = [];
    const fail = vi.fn(async () => null);
    const queue = new LLMWikiDocumentQueue({
      concurrency: 1,
      loadTask: async (rawPath) => {
        if (rawPath === "raw/a.md") throw new Error("missing raw state");
        return { rawPath, contentHash: `hash-${rawPath}` };
      },
      runner: async ({ rawPath }) => {
        runCalls.push(rawPath);
        return createIngestFileResult(rawPath);
      },
      complete: async (_rawPath, hash, result) => createParsedDocumentStatus(hash, result),
      fail,
      emit: vi.fn(),
    });

    queue.enqueue("raw/a.md");
    queue.enqueue("raw/b.md");
    await queue.waitForIdle();

    expect(runCalls).toEqual(["raw/b.md"]);
    expect(fail).not.toHaveBeenCalled();
  });

  it("marks a task failed when complete throws", async () => {
    const failures: Array<{ rawPath: string; hash: string; error: string }> = [];
    const emitted: Array<{ rawPath: string; status: string }> = [];
    const queue = new LLMWikiDocumentQueue({
      concurrency: 4,
      loadTask: async (rawPath) => ({ rawPath, contentHash: "hash-note" }),
      runner: async ({ rawPath }) => createIngestFileResult(rawPath),
      complete: async () => {
        throw new Error("stale generated path");
      },
      fail: async (rawPath, hash, error) => {
        failures.push({ rawPath, hash, error });
        return createFailedDocumentStatus(hash, error);
      },
      emit: (rawPath, status) => emitted.push({ rawPath, status: status.status }),
    });

    queue.enqueue("raw/note.md");
    await queue.waitForIdle();

    expect(failures).toEqual([{ rawPath: "raw/note.md", hash: "hash-note", error: "stale generated path" }]);
    expect(emitted).toEqual([{ rawPath: "raw/note.md", status: "failed" }]);
  });

  it("marks failed document tasks and continues starting queued raw paths", async () => {
    const runCalls: string[] = [];
    const failures: Array<{ rawPath: string; hash: string; error: string }> = [];
    const emitted: Array<{ rawPath: string; status: LLMWikiDocumentStatus }> = [];
    const queue = new LLMWikiDocumentQueue({
      concurrency: 1,
      loadTask: async (rawPath) => ({ rawPath, contentHash: `hash-${rawPath}` }),
      runner: async ({ rawPath }) => {
        runCalls.push(rawPath);
        if (rawPath === "raw/a.md") throw new Error("provider failed");
        return { ok: true, operation: "ingest-file", raw: rawPath, written: ["wiki/b.md"], pages: ["b"], events: [] };
      },
      complete: async (rawPath, hash, result) => ({
        status: "parsed",
        contentHash: hash,
        updatedAt: "2026-06-22T00:00:00.000Z",
        submittedAt: "2026-06-22T00:00:00.000Z",
        completedAt: "2026-06-22T00:00:01.000Z",
        error: null,
        generated: result.written ?? [],
        events: result.events,
      }),
      fail: async (rawPath, hash, error) => {
        failures.push({ rawPath, hash, error });
        return {
          status: "failed",
          contentHash: hash,
          updatedAt: "2026-06-22T00:00:00.000Z",
          submittedAt: "2026-06-22T00:00:00.000Z",
          completedAt: "2026-06-22T00:00:01.000Z",
          error,
          generated: [],
          events: [],
        };
      },
      emit: (rawPath, status) => emitted.push({ rawPath, status }),
    });

    queue.enqueue("raw/a.md");
    queue.enqueue("raw/b.md");
    await queue.waitForIdle();

    expect(runCalls).toEqual(["raw/a.md", "raw/b.md"]);
    expect(failures).toEqual([{ rawPath: "raw/a.md", hash: "hash-raw/a.md", error: "provider failed" }]);
    expect(emitted.map((entry) => [entry.rawPath, entry.status.status])).toEqual([
      ["raw/a.md", "failed"],
      ["raw/b.md", "parsed"],
    ]);
  });

  it("persists and emits the save-submit-parse status sequence", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-status-sequence-"));
    try {
      const rawPath = "raw/iran-president.md";
      const store = new LLMWikiStateStore(tmp);
      const emitted: Array<{ rawPath: string; status: LLMWikiDocumentStatus }> = [];

      await store.markDirty(rawPath, "# Iran president", new Date("2026-06-23T00:00:00.000Z"));
      const dirty = (await store.read()).documents[rawPath];
      expect(dirty.status).toBe("dirty");
      expect(dirty.submittedAt).toBeNull();
      expect(dirty.completedAt).toBeNull();
      expect(dirty.generated).toEqual([]);
      expect(dirty.events).toEqual([]);

      const queued = await store.enqueue(rawPath, new Date("2026-06-23T00:01:00.000Z"));
      emitted.push({ rawPath, status: queued });

      const queue = new LLMWikiDocumentQueue({
        concurrency: 4,
        loadTask: async (nextRawPath) => {
          const submitting = await store.start(nextRawPath, new Date("2026-06-23T00:02:00.000Z"));
          emitted.push({ rawPath: nextRawPath, status: submitting });
          return { rawPath: nextRawPath, contentHash: submitting.contentHash };
        },
        runner: async ({ rawPath: nextRawPath }) => ({
          ok: false,
          operation: "ingest-file",
          raw: nextRawPath,
          written: ["wiki/iranian-president-crash.md", "wiki/index.md", "wiki/log.md"],
          pages: ["iranian-president-crash"],
          events: ["iranian-president-helicopter-crash"],
          issues: [{ code: "broken-link", path: "wiki/log.md", message: "missing target" }],
        }),
        complete: async (nextRawPath, hash, result) => {
          const parsed = await store.complete(nextRawPath, hash, result, new Date("2026-06-23T00:03:00.000Z"));
          await store.setProjectIssues(normalizeProjectIssues(result.issues));
          return parsed;
        },
        fail: async (nextRawPath, hash, error) => store.fail(nextRawPath, hash, error),
        emit: (nextRawPath, status) => emitted.push({ rawPath: nextRawPath, status }),
      });

      queue.enqueue(rawPath);
      await queue.waitForIdle();

      const finalState = await store.read();
      expect(emitted.map((entry) => entry.status.status)).toEqual(["queued", "submitting", "parsed"]);
      expect(finalState.documents[rawPath]).toMatchObject({
        status: "parsed",
        submittedAt: "2026-06-23T00:01:00.000Z",
        completedAt: "2026-06-23T00:03:00.000Z",
        error: null,
        generated: ["wiki/iranian-president-crash.md", "wiki/index.md", "wiki/log.md"],
        events: ["iranian-president-helicopter-crash"],
      });
      expect(finalState.projectIssues).toEqual([{ code: "broken-link", path: "wiki/log.md", message: "missing target" }]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("persists and emits failed when DeepSeek parsing fails after submission starts", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-status-sequence-"));
    try {
      const rawPath = "raw/iran-president.md";
      const store = new LLMWikiStateStore(tmp);
      const emitted: Array<{ rawPath: string; status: LLMWikiDocumentStatus }> = [];

      await store.markDirty(rawPath, "# Iran president", new Date("2026-06-23T00:00:00.000Z"));
      const queued = await store.enqueue(rawPath, new Date("2026-06-23T00:01:00.000Z"));
      emitted.push({ rawPath, status: queued });

      const queue = new LLMWikiDocumentQueue({
        concurrency: 4,
        loadTask: async (nextRawPath) => {
          const submitting = await store.start(nextRawPath, new Date("2026-06-23T00:02:00.000Z"));
          emitted.push({ rawPath: nextRawPath, status: submitting });
          return { rawPath: nextRawPath, contentHash: submitting.contentHash };
        },
        runner: async () => {
          throw new Error("DeepSeek HTTP error 400: model not found");
        },
        complete: async (nextRawPath, hash, result) => store.complete(nextRawPath, hash, result),
        fail: async (nextRawPath, hash, error) => {
          const failed = await store.fail(nextRawPath, hash, error, new Date("2026-06-23T00:03:00.000Z"));
          return failed;
        },
        emit: (nextRawPath, status) => emitted.push({ rawPath: nextRawPath, status }),
      });

      queue.enqueue(rawPath);
      await queue.waitForIdle();

      const finalState = await store.read();
      expect(emitted.map((entry) => entry.status.status)).toEqual(["queued", "submitting", "failed"]);
      expect(finalState.documents[rawPath]).toMatchObject({
        status: "failed",
        submittedAt: "2026-06-23T00:01:00.000Z",
        completedAt: "2026-06-23T00:03:00.000Z",
        generated: [],
        events: [],
      });
      expect(finalState.documents[rawPath].error).toContain("DeepSeek HTTP error 400");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("LLM Wiki save preparation", () => {
  it("keeps wiki saves in place without queueing compile", () => {
    const project = path.resolve("C:\\vault");
    const currentPath = path.join(project, "wiki", "Topic.md");

    expect(prepareSaveSource({ projectPath: project, currentPath, content: "# Topic" })).toEqual({
      targetPath: currentPath,
      pathKind: "wiki",
      queued: false,
    });
  });

  it("keeps raw saves in place and queues compile", () => {
    const project = path.resolve("C:\\vault");
    const currentPath = path.join(project, "raw", "Seed.md");

    expect(prepareSaveSource({ projectPath: project, currentPath, content: "# Seed" })).toEqual({
      targetPath: currentPath,
      pathKind: "raw",
      queued: true,
    });
  });

  it("imports external saves to project raw using a safe markdown name", () => {
    const project = path.resolve("C:\\vault");
    const currentPath = path.resolve("C:\\downloads\\Source.txt");

    expect(prepareSaveSource({ projectPath: project, currentPath, content: "# Imported/Seed" })).toEqual({
      targetPath: path.join(project, "raw", "Imported-Seed.md"),
      pathKind: "external",
      queued: true,
    });
  });

  it("rejects raw paths with lexical escape segments", () => {
    const project = path.resolve("C:\\vault");
    const currentPath = `${path.join(project, "raw")}\\..\\Escaped.md`;

    expect(() => prepareSaveSource({ projectPath: project, currentPath, content: "# Bad" })).toThrow(
      /Path escapes raw directory/
    );
  });
});

describe("LLM Wiki save source side effects", () => {
  it("writes wiki saves in place without enqueueing compile", async () => {
    const project = path.resolve("C:\\vault");
    const currentPath = path.join(project, "wiki", "Topic.md");
    const deps = createSaveDeps();

    const result = await saveLLMWikiSource({ projectPath: project, currentPath, content: "# Topic" }, deps);

    expect(result).toEqual({ projectPath: project, savedPath: currentPath, pathKind: "wiki", queued: false });
    expect(deps.mkdir).toHaveBeenCalledWith(path.join(project, ".nexus"), { recursive: true });
    expect(deps.mkdir).toHaveBeenCalledWith(path.join(project, "raw"), { recursive: true });
    expect(deps.mkdir).toHaveBeenCalledWith(path.join(project, "wiki"), { recursive: true });
    expect(deps.activateVault).toHaveBeenCalledWith(project);
    expect(deps.writeFile).toHaveBeenCalledWith(currentPath, "# Topic", "utf-8");
    expect(deps.markDirty).not.toHaveBeenCalled();
    expect(deps.enqueueDocument).not.toHaveBeenCalled();
    expect(deps.enqueueCompile).not.toHaveBeenCalled();
  });

  it("writes raw saves in place and marks the raw document dirty", async () => {
    const project = path.resolve("C:\\vault");
    const currentPath = path.join(project, "raw", "Seed.md");
    const deps = createSaveDeps();

    const result = await saveLLMWikiSource({ projectPath: project, currentPath, content: "# Seed" }, deps);

    expect(result).toEqual({ projectPath: project, savedPath: currentPath, pathKind: "raw", queued: true });
    expect(deps.writeFile).toHaveBeenCalledWith(currentPath, "# Seed", "utf-8");
    expect(deps.markDirty).toHaveBeenCalledWith(project, "raw/Seed.md", "# Seed");
    expect(deps.enqueueDocument).not.toHaveBeenCalled();
    expect(deps.enqueueCompile).not.toHaveBeenCalled();
  });

  it("imports untitled external saves under raw and marks the raw document dirty", async () => {
    const project = path.resolve("C:\\vault");
    const targetPath = path.join(project, "raw", "untitled.md");
    const deps = createSaveDeps();

    const result = await saveLLMWikiSource(
      { projectPath: project, currentPath: null, content: "body without heading" },
      deps
    );

    expect(result).toEqual({ projectPath: project, savedPath: targetPath, pathKind: "external", queued: true });
    expect(deps.writeFile).toHaveBeenCalledWith(targetPath, "body without heading", "utf-8");
    expect(deps.markDirty).toHaveBeenCalledWith(project, "raw/untitled.md", "body without heading");
    expect(deps.enqueueDocument).not.toHaveBeenCalled();
    expect(deps.enqueueCompile).not.toHaveBeenCalled();
  });

  it("allocates a non-conflicting raw name for external imports", async () => {
    const project = path.resolve("C:\\vault");
    const existingPath = path.join(project, "raw", "untitled.md");
    const targetPath = path.join(project, "raw", "untitled-1.md");
    const deps = createSaveDeps();
    deps.pathExists.mockImplementation(async (candidate: string) => candidate === existingPath);

    const result = await saveLLMWikiSource(
      { projectPath: project, currentPath: null, content: "body without heading" },
      deps
    );

    expect(result).toEqual({ projectPath: project, savedPath: targetPath, pathKind: "external", queued: true });
    expect(deps.writeFile).toHaveBeenCalledWith(targetPath, "body without heading", "utf-8");
    expect(deps.markDirty).toHaveBeenCalledWith(project, "raw/untitled-1.md", "body without heading");
    expect(deps.enqueueCompile).not.toHaveBeenCalled();
  });

  it("keeps raw saves as explicit overwrites", async () => {
    const project = path.resolve("C:\\vault");
    const currentPath = path.join(project, "raw", "Seed.md");
    const deps = createSaveDeps();
    deps.pathExists.mockResolvedValue(true);

    const result = await saveLLMWikiSource({ projectPath: project, currentPath, content: "# Seed" }, deps);

    expect(result).toEqual({ projectPath: project, savedPath: currentPath, pathKind: "raw", queued: true });
    expect(deps.writeFile).toHaveBeenCalledWith(currentPath, "# Seed", "utf-8");
    expect(deps.markDirty).toHaveBeenCalledWith(project, "raw/Seed.md", "# Seed");
    expect(deps.enqueueCompile).not.toHaveBeenCalled();
  });

  it("auto mode enqueues a dirty raw document after save", async () => {
    const project = path.resolve("C:\\vault");
    const currentPath = path.join(project, "raw", "Seed.md");
    const deps = createSaveDeps();
    deps.shouldAutoSubmit.mockResolvedValue(true);

    await saveLLMWikiSource({ projectPath: project, currentPath, content: "# Seed" }, deps);

    expect(deps.markDirty).toHaveBeenCalledWith(project, "raw/Seed.md", "# Seed");
    expect(deps.enqueueDocument).toHaveBeenCalledWith(project, "raw/Seed.md");
  });

  it("auto mode does not enqueue when the raw document hash is unchanged", async () => {
    const project = path.resolve("C:\\vault");
    const currentPath = path.join(project, "raw", "Seed.md");
    const deps = createSaveDeps();
    deps.markDirty.mockResolvedValue(false);
    deps.shouldAutoSubmit.mockResolvedValue(true);

    await saveLLMWikiSource({ projectPath: project, currentPath, content: "# Seed" }, deps);

    expect(deps.markDirty).toHaveBeenCalledWith(project, "raw/Seed.md", "# Seed");
    expect(deps.enqueueDocument).not.toHaveBeenCalled();
  });

  it("rejects malicious raw paths before writing or enqueueing", async () => {
    const project = path.resolve("C:\\vault");
    const deps = createSaveDeps();
    const currentPath = `${path.join(project, "raw")}\\..\\Escaped.md`;

    await expect(saveLLMWikiSource({ projectPath: project, currentPath, content: "# Bad" }, deps)).rejects.toThrow(
      /Path escapes raw directory/
    );
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.markDirty).not.toHaveBeenCalled();
    expect(deps.enqueueDocument).not.toHaveBeenCalled();
    expect(deps.enqueueCompile).not.toHaveBeenCalled();
  });
});

describe("LLM Wiki package config", () => {
  it("ships the sidecar as extra resources without local env or caches", async () => {
    const packagePath = path.resolve("apps/electron-demo/package.json");
    const pkg = JSON.parse(await readFile(packagePath, "utf-8"));
    const sidecarResource = pkg.build.extraResources.find(
      (entry: { from?: string; to?: string }) => entry.from === "llm-wiki" && entry.to === "llm-wiki"
    );

    expect(sidecarResource).toBeTruthy();
    expect(sidecarResource.filter).toEqual(
      expect.arrayContaining(["llm_wiki.py", "schema.md", "requirements.txt", "README.md", ".env.example"])
    );
    expect(sidecarResource.filter).not.toContain(".env");
    expect(sidecarResource.filter).not.toContain("__pycache__");
  });
});

describe("LLM Wiki Python JSON protocol", () => {
  it("rejects malformed JSON output", async () => {
    await expect(runTempNodeScript("process.stdout.write('not json');")).rejects.toThrow(/malformed JSON/);
  });

  it("rejects structurally invalid JSON output", async () => {
    await expect(runTempNodeScript("process.stdout.write(JSON.stringify({ ok: true }));")).rejects.toThrow(
      /malformed protocol payload/
    );
  });

  it("rejects ok false output with the sidecar error message", async () => {
    await expect(
      runTempNodeScript("process.stdout.write(JSON.stringify({ ok: false, operation: 'lint', error: 'bad links' }));")
    ).rejects.toThrow(/bad links/);
  });

  it("includes lint issues when sidecar fails without an error message", async () => {
    let message = "";
    try {
      await runTempNodeScript(
        `process.stdout.write(JSON.stringify({
          ok: false,
          operation: 'lint',
          issues: [{ code: 'bad-link', path: 'wiki/note.md', message: 'Missing [[Target]]' }]
        }));`
      );
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toContain("bad-link");
    expect(message).toContain("wiki/note.md");
    expect(message).toContain("Missing [[Target]]");
  });

  it("redacts secrets from sidecar JSON error payloads", async () => {
    const token = "sk-1234567890abcdef";
    let message = "";
    try {
      await runTempNodeScript(
        `process.stdout.write(JSON.stringify({ ok: false, operation: 'query', error: 'DEEPSEEK_API_KEY=secret ${token}' }));`
      );
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toContain("LLM Wiki query failed");
    expect(message).not.toContain("secret");
    expect(message).not.toContain(token);
    expect(message).toMatch(/\[redacted\]|\[redacted-key\]/);
  });

  it("forces UTF-8 stdout settings for Python-compatible child processes", async () => {
    const result = (await runTempNodeScript(
      "process.stdout.write(JSON.stringify({ ok: true, operation: 'env', pyio: process.env.PYTHONIOENCODING, pyutf8: process.env.PYTHONUTF8 }));"
    )) as LLMWikiCommandResult & { pyio?: string; pyutf8?: string };

    expect(result.pyio).toBe("utf-8");
    expect(result.pyutf8).toBe("1");
  });

  it("rejects nonzero exit with exit code and stderr", async () => {
    await expect(
      runTempNodeScript(
        "process.stderr.write('dependency missing'); process.stdout.write(JSON.stringify({ ok: true, operation: 'ensure' })); process.exit(3);"
      )
    ).rejects.toThrow(/exit code 3.*dependency missing/);
  });

  it("rejects when stdout exceeds the configured limit", async () => {
    await expect(runTempNodeScript("process.stdout.write('x'.repeat(128));", { maxStdoutBytes: 16 })).rejects.toThrow(
      /stdout limit/
    );
  });

  it("rejects when stderr exceeds the configured limit", async () => {
    await expect(runTempNodeScript("process.stderr.write('x'.repeat(128));", { maxStdoutBytes: 16 })).rejects.toThrow(
      /stderr limit/
    );
  });

  it("rejects when the command times out", async () => {
    await expect(
      runTempNodeScript("setTimeout(() => process.stdout.write(JSON.stringify({ ok: true, operation: 'slow' })), 100);", {
        timeoutMs: 10,
      })
    ).rejects.toThrow(/timed out/);
  });
});

describe("LLM Wiki numeric config parsing", () => {
  it("uses positive integer values when valid", () => {
    expect(parsePositiveInteger("2500", 800)).toBe(2500);
  });

  it("falls back for invalid, zero, negative, and fractional values", () => {
    expect(parsePositiveInteger("abc", 800)).toBe(800);
    expect(parsePositiveInteger("0", 800)).toBe(800);
    expect(parsePositiveInteger("-1", 800)).toBe(800);
    expect(parsePositiveInteger("1.5", 800)).toBe(800);
    expect(parsePositiveInteger(undefined, 800)).toBe(800);
  });
});

describe("LLM Wiki DeepSeek config", () => {
  it("writes known config keys and redacts the api key from status", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-config-"));
    try {
      await writeLLMWikiConfig(tmp, {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com",
        apiKey: "secret-value",
      });

      const env = await readLLMWikiEnv(tmp);
      const status = await getLLMWikiConfigStatus(tmp);

      expect(env.DEEPSEEK_API_KEY).toBe("secret-value");
      expect(status).toEqual({
        provider: "deepseek",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com",
        apiKeyConfigured: true,
        envPath: path.join(tmp, ".env"),
      });
      expect(JSON.stringify(status)).not.toContain("secret-value");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("preserves existing api key when saving model without a new key", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-config-"));
    try {
      await writeLLMWikiConfig(tmp, {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com",
        apiKey: "secret-value",
      });
      await writeLLMWikiConfig(tmp, {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com",
      });

      const env = await readLLMWikiEnv(tmp);
      expect(env.DEEPSEEK_API_KEY).toBe("secret-value");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("ignores unknown env keys while reading config", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-config-"));
    try {
      await writeFile(
        path.join(tmp, ".env"),
        "LLM_WIKI_PROVIDER=deepseek\nDEEPSEEK_API_KEY=secret-value\nUNRELATED_SECRET=ignore-me\n",
        "utf-8"
      );
      const env = await readLLMWikiEnv(tmp);
      expect(env.DEEPSEEK_API_KEY).toBe("secret-value");
      expect((env as Record<string, string | undefined>).UNRELATED_SECRET).toBeUndefined();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("writes single-line env values without allowing dotenv injection", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-config-"));
    try {
      await writeLLMWikiConfig(tmp, {
        provider: "deepseek",
        model: "deepseek-v4-pro\nDEEPSEEK_API_KEY=injected",
        baseUrl: "https://api.deepseek.com\nLLM_WIKI_PROVIDER=fixture",
        apiKey: "intended-key\nDEEPSEEK_API_KEY=injected",
      });

      const env = await readLLMWikiEnv(tmp);
      const raw = await readFile(path.join(tmp, ".env"), "utf-8");

      expect(raw).not.toContain("DEEPSEEK_API_KEY=injected");
      expect(env.LLM_WIKI_DEEPSEEK_MODEL).toBe("deepseek-v4-pro");
      expect(env.LLM_WIKI_DEEPSEEK_BASE_URL).toBe("https://api.deepseek.com");
      expect(env.DEEPSEEK_API_KEY).toBe("intended-key");
      expect(env.LLM_WIKI_DEEPSEEK_MODEL).not.toMatch(/[\r\n]/);
      expect(env.LLM_WIKI_DEEPSEEK_BASE_URL).not.toMatch(/[\r\n]/);
      expect(env.DEEPSEEK_API_KEY).not.toMatch(/[\r\n]/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("LLM Wiki sidecar runner", () => {
  it("runs sidecar ingest-file with project and raw arguments", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-ingest-file-"));
    try {
      const scriptPath = path.join(tmp, "llm_wiki.py");
      await writeFile(
        scriptPath,
        `
const argv = process.argv.slice(2);
const raw = argv[argv.indexOf("--raw") + 1];
const payload = {
  ok: true,
  operation: "ingest-file",
  argv,
  raw,
  written: ["wiki/note.md"],
  pages: ["note"],
  events: []
};
process.stdout.write(JSON.stringify(payload));
`,
        "utf-8"
      );

      const result = await runSidecarIngestFile(tmp, "C:\\vault", "raw/note.md", {
        pythonCommand: process.execPath,
        timeoutMs: 1000,
        maxStdoutBytes: 1024,
        provider: "deepseek",
      });

      const payload = result as LLMWikiIngestFileResult & { argv: string[] };
      expect(payload.argv[0]).toBe("ingest-file");
      expect(payload.argv).toEqual([
        "ingest-file",
        "--project",
        "C:\\vault",
        "--raw",
        "raw/note.md",
        "--provider",
        "deepseek",
      ]);
      expect(result.raw).toBe("raw/note.md");
      expect(result.pages).toEqual(["note"]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("defaults sidecar ingest-file provider to fixture", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-ingest-file-"));
    try {
      await writeFile(
        path.join(tmp, "llm_wiki.py"),
        `
const argv = process.argv.slice(2);
const raw = argv[argv.indexOf("--raw") + 1];
process.stdout.write(JSON.stringify({
  ok: true,
  operation: "ingest-file",
  argv,
  raw,
  written: ["wiki/note.md"],
  pages: ["note"],
  events: []
}));
`,
        "utf-8"
      );

      const result = (await runSidecarIngestFile(tmp, "C:\\vault", "raw/note.md", {
        pythonCommand: process.execPath,
        timeoutMs: 1000,
        maxStdoutBytes: 1024,
      })) as LLMWikiIngestFileResult & { argv: string[] };

      expect(result.argv).toEqual([
        "ingest-file",
        "--project",
        "C:\\vault",
        "--raw",
        "raw/note.md",
        "--provider",
        "fixture",
      ]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("accepts document ingest output with lint issues after pages were written", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-ingest-file-"));
    try {
      await writeFile(
        path.join(tmp, "llm_wiki.py"),
        `
process.stdout.write(JSON.stringify({
  ok: false,
  operation: "ingest-file",
  raw: "raw/note.md",
  written: ["wiki/note.md", "wiki/index.md", "wiki/log.md"],
  pages: ["note"],
  events: ["note-event"],
  issues: [{ code: "broken-link", path: "wiki/log.md", message: "missing target" }]
}));
process.exitCode = 1;
`,
        "utf-8"
      );

      const result = await runSidecarIngestFile(tmp, "C:\\vault", "raw/note.md", {
        pythonCommand: process.execPath,
        timeoutMs: 1000,
        maxStdoutBytes: 1024,
      });

      expect(result.ok).toBe(false);
      expect(result.written).toEqual(["wiki/note.md", "wiki/index.md", "wiki/log.md"]);
      expect(result.pages).toEqual(["note"]);
      expect(result.events).toEqual(["note-event"]);
      expect(result.issues).toEqual([{ code: "broken-link", path: "wiki/log.md", message: "missing target" }]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("keeps provider failure messages when ingest-file returns no safe pages", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-ingest-file-"));
    try {
      await writeFile(
        path.join(tmp, "llm_wiki.py"),
        `
process.stdout.write(JSON.stringify({
  ok: false,
  operation: "ingest-file",
  error: "DeepSeek HTTP error 400: model not found"
}));
process.exitCode = 1;
`,
        "utf-8"
      );

      await expect(
        runSidecarIngestFile(tmp, "C:\\vault", "raw/note.md", {
          pythonCommand: process.execPath,
          timeoutMs: 1000,
          maxStdoutBytes: 1024,
        })
      ).rejects.toThrow(/DeepSeek HTTP error 400/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects sidecar ingest-file results without generated paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-ingest-file-"));
    try {
      await writeFile(
        path.join(tmp, "llm_wiki.py"),
        `
process.stdout.write(JSON.stringify({
  ok: true,
  operation: "ingest-file",
  raw: "raw/note.md",
  written: "wiki/note.md",
  pages: ["note"],
  events: []
}));
`,
        "utf-8"
      );

      await expect(
        runSidecarIngestFile(tmp, "C:\\vault", "raw/note.md", {
          pythonCommand: process.execPath,
          timeoutMs: 1000,
          maxStdoutBytes: 1024,
        })
      ).rejects.toThrow(/malformed payload/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects sidecar ingest-file results whose raw path does not match the request", async () => {
    await expect(runTempIngestFilePayload({ raw: "raw/other.md" })).rejects.toThrow(/malformed payload/);
  });

  it("rejects sidecar ingest-file results with unsafe generated paths", async () => {
    for (const written of [["../escape.md"], ["C:/escape.md"], ["wiki\\escape.md"], ["raw/note.md"], ["wiki/../escape.md"]]) {
      await expect(runTempIngestFilePayload({ written })).rejects.toThrow(/malformed payload/);
    }
  });

  it("rejects sidecar ingest-file results with unsafe page or event slugs", async () => {
    await expect(runTempIngestFilePayload({ pages: ["Bad Page"] })).rejects.toThrow(/malformed payload/);
    await expect(runTempIngestFilePayload({ events: [""] })).rejects.toThrow(/malformed payload/);
  });

  it("accepts long valid sidecar ingest page and event slugs", async () => {
    const longSlug = `note-${"a".repeat(160)}`;

    await expect(runTempIngestFilePayload({ pages: [longSlug], events: [longSlug] })).resolves.toMatchObject({
      pages: [longSlug],
      events: [longSlug],
    });
  });

  it("runs ensure before fixture ingest and lint during compile", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-sidecar-"));
    const logPath = path.join(tmp, "calls.json");
    await writeFile(
      path.join(tmp, "llm_wiki.py"),
      `
const fs = require("node:fs");
const command = process.argv[2];
const calls = fs.existsSync(${JSON.stringify(logPath)})
  ? JSON.parse(fs.readFileSync(${JSON.stringify(logPath)}, "utf-8"))
  : [];
calls.push(process.argv.slice(2));
fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify(calls));
const payload = command === "ingest"
  ? { ok: true, operation: "ingest", written: ["wiki/index.md"] }
  : command === "lint"
    ? { ok: true, operation: "lint", issues: [] }
    : { ok: true, operation: "ensure" };
process.stdout.write(JSON.stringify(payload));
`,
      "utf-8"
    );

    try {
      const result = await runSidecarCompile(tmp, "C:\\vault", {
        pythonCommand: process.execPath,
        provider: "fixture",
        timeoutMs: 5000,
        maxStdoutBytes: 1024,
      });
      const calls = JSON.parse(await readFile(logPath, "utf-8"));

      expect(result).toEqual({
        ok: true,
        operation: "compile",
        written: ["wiki/index.md"],
        issues: [],
      });
      expect(calls).toEqual([
        ["ensure", "--project", "C:\\vault"],
        ["ingest", "--project", "C:\\vault", "--provider", "fixture"],
        ["lint", "--project", "C:\\vault"],
      ]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("LLM Wiki sidecar query runner", () => {
  it("does not run the query sidecar unless provider is deepseek", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-query-"));
    const calledPath = path.join(tmp, "called.txt");
    await writeFile(
      path.join(tmp, "llm_wiki.py"),
      `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(calledPath)}, "called");
process.stdout.write(JSON.stringify({ ok: true, operation: "query", answer: "answer", citations: [], read: [] }));
`,
      "utf-8"
    );
    try {
      await expect(
        runSidecarQuery(tmp, "C:\\vault", "question?", {
          pythonCommand: process.execPath,
          timeoutMs: 5000,
          maxStdoutBytes: 2048,
          provider: "fixture",
        })
      ).rejects.toThrow(/requires DeepSeek provider/);
      await expect(
        runSidecarQuery(tmp, "C:\\vault", "question?", {
          pythonCommand: process.execPath,
          timeoutMs: 5000,
          maxStdoutBytes: 2048,
        })
      ).rejects.toThrow(/requires DeepSeek provider/);
      await expect(readFile(calledPath, "utf-8")).rejects.toThrow();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("runs the query command with argv and parses answer payload", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-query-"));
    const logPath = path.join(tmp, "calls.json");
    await writeFile(
      path.join(tmp, "llm_wiki.py"),
      `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({
  ok: true,
  operation: "query",
  answer: "compiled answer",
  citations: [{ path: "wiki/a.md", quote: "fact" }],
  read: ["wiki/index.md", "wiki/a.md"]
}));
`,
      "utf-8"
    );
    try {
      const result = await runSidecarQuery(tmp, "C:\\vault", "question?", {
        pythonCommand: process.execPath,
        timeoutMs: 5000,
        maxStdoutBytes: 2048,
        provider: "deepseek",
      });
      const calls = JSON.parse(await readFile(logPath, "utf-8"));
      expect(calls).toEqual(["query", "--project", "C:\\vault", "--question", "question?"]);
      expect(result.answer).toBe("compiled answer");
      expect(result.citations[0].path).toBe("wiki/a.md");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("LLM Wiki compile queue", () => {
  it("runs one compile at a time and collapses repeated saves into one rerun", async () => {
    const releaseFirst = createDeferred<void>();
    const runs: string[] = [];
    const statuses: string[] = [];
    const runner = vi.fn(async (projectPath: string) => {
      runs.push(projectPath);
      if (runs.length === 1) await releaseFirst.promise;
      return { ok: true, operation: "compile", written: [], issues: [] };
    });
    const queue = new LLMWikiCompileQueue({
      debounceMs: 0,
      runner,
      emit: (status) => statuses.push(status.state),
    });

    queue.enqueue("project-a");
    await queue.waitForIdleTick();
    queue.enqueue("project-a");
    queue.enqueue("project-a");

    expect(runner).toHaveBeenCalledTimes(1);
    releaseFirst.resolve();
    await queue.waitForIdle();

    expect(runner).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(["queued", "running", "queued", "queued", "running", "succeeded"]);
  });

  it("emits a failed status when the runner rejects", async () => {
    const statuses: string[] = [];
    const queue = new LLMWikiCompileQueue({
      debounceMs: 0,
      runner: async () => {
        throw new Error("python missing");
      },
      emit: (status) => statuses.push(status.state),
    });

    queue.enqueue("project-a");
    await queue.waitForIdle();

    expect(statuses).toEqual(["queued", "running", "failed"]);
  });

  it("continues to idle when status emit throws", async () => {
    const runner = vi.fn(async (projectPath: string) => ({ ok: true, operation: "compile", written: [projectPath] }));
    const queue = new LLMWikiCompileQueue({
      debounceMs: 0,
      runner,
      emit: () => {
        throw new Error("renderer unavailable");
      },
    });

    expect(() => queue.enqueue("project-a")).not.toThrow();
    await queue.waitForIdle();
    expect(runner).toHaveBeenCalledWith("project-a");

    expect(() => queue.enqueue("project-b")).not.toThrow();
    await queue.waitForIdle();
    expect(runner).toHaveBeenCalledWith("project-b");
  });
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function deferred<T>() {
  return createDeferred<T>();
}

function flushTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createIngestFileResult(rawPath: string): LLMWikiIngestFileResult {
  const slug = rawPath.replace(/^raw\//, "").replace(/\.md$/, "");
  return {
    ok: true,
    operation: "ingest-file",
    raw: rawPath,
    written: [`wiki/${slug}.md`],
    pages: [slug],
    events: [],
  };
}

function createParsedDocumentStatus(
  hash: string,
  result: Pick<LLMWikiIngestFileResult, "written" | "events">
): LLMWikiDocumentStatus {
  return {
    status: "parsed",
    contentHash: hash,
    updatedAt: "2026-06-22T00:00:00.000Z",
    submittedAt: "2026-06-22T00:00:00.000Z",
    completedAt: "2026-06-22T00:00:01.000Z",
    error: null,
    generated: result.written ?? [],
    events: result.events,
  };
}

function createFailedDocumentStatus(hash: string, error: string): LLMWikiDocumentStatus {
  return {
    status: "failed",
    contentHash: hash,
    updatedAt: "2026-06-22T00:00:00.000Z",
    submittedAt: "2026-06-22T00:00:00.000Z",
    completedAt: "2026-06-22T00:00:01.000Z",
    error,
    generated: [],
    events: [],
  };
}

function createSaveDeps() {
  return {
    mkdir: vi.fn(async () => undefined),
    activateVault: vi.fn(async (vaultPath: string) => path.resolve(vaultPath)),
    writeFile: vi.fn(async () => undefined),
    pathExists: vi.fn(async (_candidate: string) => false),
    enqueueCompile: vi.fn(),
    markDirty: vi.fn(async () => true),
    enqueueDocument: vi.fn(),
    shouldAutoSubmit: vi.fn(async () => false),
  };
}

async function runTempIngestFilePayload(overrides: Partial<LLMWikiIngestFileResult>) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-ingest-file-"));
  const payload = {
    ok: true,
    operation: "ingest-file",
    raw: "raw/note.md",
    written: ["wiki/note.md"],
    pages: ["note"],
    events: ["note-event"],
    ...overrides,
  };
  try {
    await writeFile(
      path.join(tmp, "llm_wiki.py"),
      `process.stdout.write(JSON.stringify(${JSON.stringify(payload)}));`,
      "utf-8"
    );
    return await runSidecarIngestFile(tmp, "C:\\vault", "raw/note.md", {
      pythonCommand: process.execPath,
      timeoutMs: 1000,
      maxStdoutBytes: 1024,
    });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function runTempNodeScript(
  script: string,
  options: Partial<{ timeoutMs: number; maxStdoutBytes: number }> = {}
) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-runner-"));
  const scriptPath = path.join(tmp, "script.js");
  await writeFile(scriptPath, script, "utf-8");
  try {
    return await runPythonJson({
      pythonCommand: process.execPath,
      scriptPath,
      args: [],
      timeoutMs: options.timeoutMs ?? 1000,
      maxStdoutBytes: options.maxStdoutBytes ?? 1024,
      cwd: tmp,
    });
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}
