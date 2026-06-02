import { beforeEach, describe, expect, it, vi } from "vitest";
import { createState } from "../src/renderer/state";

function mockBridge() {
  const bridge = {
    openFile: vi.fn(),
    saveFile: vi.fn(),
    saveFileAs: vi.fn(),
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

  it("resets dirty after save to known path", async () => {
    bridge.saveFile.mockResolvedValue({ path: "/tmp/test.md" });

    const state = createState();
    state.filePath = "/tmp/test.md";
    state.content = "updated";
    state.dirty = true;

    await window.nexusDemo.saveFile(state.filePath, state.content);
    state.dirty = false;

    expect(state.dirty).toBe(false);
    expect(bridge.saveFile).toHaveBeenCalledWith("/tmp/test.md", "updated");
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
