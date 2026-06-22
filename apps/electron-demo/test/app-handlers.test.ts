import { describe, expect, it, vi, beforeEach } from "vitest";
import { createState } from "../src/renderer/state";

const exposeInMainWorld = vi.fn();
const ipcInvoke = vi.fn();
const ipcOn = vi.fn();
const ipcOff = vi.fn();

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: ipcInvoke,
    on: ipcOn,
    off: ipcOff,
  },
}));

function mockBridge() {
  const bridge = {
    openFile: vi.fn(),
    saveFile: vi.fn(),
    saveFileAs: vi.fn(),
    vault: {
      getVaultPath: vi.fn(),
      openVault: vi.fn(),
      refresh: vi.fn(),
      setActiveFile: vi.fn(),
    },
    llmWiki: {
      saveSource: vi.fn(),
      getStatus: vi.fn(),
      onStatus: vi.fn(),
    },
  };
  (globalThis as Record<string, unknown>).window = { nexusDemo: bridge };
  return bridge;
}

describe("open handler logic", () => {
  let bridge: ReturnType<typeof mockBridge>;

  beforeEach(() => {
    bridge = mockBridge();
  });

  it("sets filePath and content on successful open", async () => {
    bridge.openFile.mockResolvedValue({
      path: "/tmp/test.md",
      content: "# Hello",
    });

    const state = createState();
    const result = await window.nexusDemo.openFile();

    if (result) {
      state.filePath = result.path;
      state.content = result.content;
      state.dirty = false;
    }

    expect(state.filePath).toBe("/tmp/test.md");
    expect(state.content).toBe("# Hello");
    expect(state.dirty).toBe(false);
  });

  it("preserves state when open is cancelled", async () => {
    bridge.openFile.mockResolvedValue(null);

    const state = createState();
    state.filePath = "/existing.md";
    state.content = "existing";
    state.dirty = true;

    const result = await window.nexusDemo.openFile();
    if (result) {
      state.filePath = result.path;
    }

    expect(state.filePath).toBe("/existing.md");
    expect(state.dirty).toBe(true);
  });
});

describe("save handler logic", () => {
  let bridge: ReturnType<typeof mockBridge>;

  beforeEach(() => {
    bridge = mockBridge();
  });

  it("updates file and vault state after LLM Wiki source save", async () => {
    bridge.llmWiki.saveSource.mockResolvedValue({
      projectPath: "/vault",
      savedPath: "/vault/raw/test.md",
      pathKind: "raw",
      queued: true,
    });

    const state = createState();
    state.filePath = "/downloads/test.md";
    state.activeFile = "/downloads/test.md";
    state.content = "updated";
    state.dirty = true;

    const result = await window.nexusDemo.llmWiki.saveSource({
      content: state.content,
      currentPath: state.activeFile ?? state.filePath,
    });
    state.filePath = result.savedPath;
    state.activeFile = result.savedPath;
    state.vaultPath = result.projectPath;
    state.dirty = false;

    expect(bridge.llmWiki.saveSource).toHaveBeenCalledWith({
      content: "updated",
      currentPath: "/downloads/test.md",
    });
    expect(state.filePath).toBe("/vault/raw/test.md");
    expect(state.activeFile).toBe("/vault/raw/test.md");
    expect(state.vaultPath).toBe("/vault");
    expect(state.dirty).toBe(false);
  });

  it("uses saveFileAs when no filePath exists", async () => {
    bridge.saveFileAs.mockResolvedValue({ path: "/tmp/new.md" });

    const state = createState();
    state.content = "new content";
    state.dirty = true;

    const result = await window.nexusDemo.saveFileAs(state.content);
    if (result) {
      state.filePath = result.path;
      state.dirty = false;
    }

    expect(state.filePath).toBe("/tmp/new.md");
    expect(state.dirty).toBe(false);
  });

  it("preserves dirty state when saveFileAs is cancelled", async () => {
    bridge.saveFileAs.mockResolvedValue(null);

    const state = createState();
    state.content = "content";
    state.dirty = true;

    const result = await window.nexusDemo.saveFileAs(state.content);
    if (!result) {
      // no-op on cancel
    }

    expect(state.dirty).toBe(true);
    expect(state.filePath).toBeNull();
  });
});

describe("LLM Wiki preload bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockClear();
    ipcInvoke.mockReset();
    ipcOn.mockReset();
    ipcOff.mockReset();
  });

  it("exposes save, status read, and status subscription over IPC", async () => {
    ipcInvoke.mockResolvedValueOnce({
      projectPath: "/vault",
      savedPath: "/vault/raw/Seed.md",
      pathKind: "external",
      queued: true,
    });
    await import("../electron/preload");

    const bridge = exposeInMainWorld.mock.calls[0][1];
    const input = { content: "# Seed", currentPath: null };
    const result = await bridge.llmWiki.saveSource(input);

    expect(exposeInMainWorld).toHaveBeenCalledWith("nexusDemo", expect.objectContaining({ llmWiki: expect.any(Object) }));
    expect(result.savedPath).toBe("/vault/raw/Seed.md");
    expect(ipcInvoke).toHaveBeenCalledWith("llm-wiki:save-source", input);

    await bridge.llmWiki.getStatus();
    expect(ipcInvoke).toHaveBeenCalledWith("llm-wiki:get-status");

    await bridge.llmWiki.getDocStatuses();
    expect(ipcInvoke).toHaveBeenCalledWith("llm-wiki:get-doc-statuses");

    await bridge.llmWiki.submitDoc({ rawPath: "raw/note.md" });
    expect(ipcInvoke).toHaveBeenCalledWith("llm-wiki:submit-doc", { rawPath: "raw/note.md" });

    await bridge.llmWiki.submitAllDirty();
    expect(ipcInvoke).toHaveBeenCalledWith("llm-wiki:submit-all-dirty");

    await bridge.llmWiki.retryFailed();
    expect(ipcInvoke).toHaveBeenCalledWith("llm-wiki:retry-failed");

    await bridge.llmWiki.getSubmitMode();
    expect(ipcInvoke).toHaveBeenCalledWith("llm-wiki:get-submit-mode");

    await bridge.llmWiki.setSubmitMode("auto");
    expect(ipcInvoke).toHaveBeenCalledWith("llm-wiki:set-submit-mode", "auto");

    const cb = vi.fn();
    const unsubscribe = bridge.llmWiki.onStatus(cb);
    const listener = ipcOn.mock.calls[0][1];
    listener({}, { state: "running", projectPath: "/vault" });
    expect(ipcOn).toHaveBeenCalledWith("llm-wiki:status", expect.any(Function));
    expect(cb).toHaveBeenCalledWith({ state: "running", projectPath: "/vault" });

    unsubscribe();
    expect(ipcOff).toHaveBeenCalledWith("llm-wiki:status", listener);

    const docCb = vi.fn();
    const unsubscribeDoc = bridge.llmWiki.onDocStatus(docCb);
    const docListener = ipcOn.mock.calls.find((call) => call[0] === "llm-wiki:doc-status")?.[1];
    expect(docListener).toBeTruthy();
    docListener(
      {},
      {
        projectPath: "/vault",
        rawPath: "raw/note.md",
        status: {
          status: "queued",
          contentHash: "h",
          updatedAt: "t",
          submittedAt: null,
          completedAt: null,
          error: null,
          generated: [],
          events: [],
        },
      },
    );
    expect(docCb).toHaveBeenCalledWith(expect.objectContaining({ rawPath: "raw/note.md" }));
    unsubscribeDoc();
    expect(ipcOff).toHaveBeenCalledWith("llm-wiki:doc-status", docListener);
  });
});
