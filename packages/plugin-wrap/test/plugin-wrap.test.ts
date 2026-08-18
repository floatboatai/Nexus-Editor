import { createEditor } from "@floatboat/nexus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearAllWrapState, createWrapPlugin } from "../src";

const STORAGE_KEY = "nexus-plugin-wrap.test";

function makeEditor() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const handle = createWrapPlugin({
    defaultWrap: false,
    storageKey: STORAGE_KEY,
  });
  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [handle.plugin],
  });
  handle.attach(editor, container);
  return { container, handle, editor };
}

function cleanup() {
  clearAllWrapState();
  document.body.innerHTML = "";
}

function wrapClassOn(container: HTMLElement): boolean {
  const cm = container.querySelector(".cm-content");
  return !!cm && cm.classList.contains("cm-lineWrapping");
}

describe("test environment", () => {
  it("provides a DOM", () => {
    expect(typeof document).toBe("object");
    expect(typeof document.createElement).toBe("function");
  });
});

describe("@floatboat/nexus-plugin-wrap", () => {
  beforeEach(() => {
    cleanup();
  });

  it("defaults to no wrap when no per-file override exists", () => {
    const { container, handle } = makeEditor();
    handle.setActiveFilePath("/tmp/a.md");
    expect(handle.isEnabled()).toBe(false);
    expect(wrapClassOn(container)).toBe(false);
    handle.dispose();
  });

  it("toggleCurrentFile flips wrap state and persists the per-file override", () => {
    const { container, handle } = makeEditor();
    handle.setActiveFilePath("/tmp/a.md");
    expect(handle.isEnabled()).toBe(false);

    handle.toggleCurrentFile();
    expect(handle.isEnabled()).toBe(true);
    expect(wrapClassOn(container)).toBe(true);

    const handle2 = createWrapPlugin({ defaultWrap: false, storageKey: STORAGE_KEY });
    expect(handle2.isEnabled()).toBe(false);
    handle2.setActiveFilePath("/tmp/a.md");
    expect(handle2.isEnabled()).toBe(true);
    handle2.dispose();
    handle.dispose();
  });

  it("a newly opened file without override falls back to the global default", () => {
    const { handle } = makeEditor();
    handle.setActiveFilePath("/tmp/a.md");
    handle.toggleCurrentFile();
    expect(handle.isEnabled()).toBe(true);

    handle.setActiveFilePath("/tmp/b.md");
    expect(handle.isEnabled()).toBe(false);
    handle.dispose();
  });

  it("setDefaultWrap changes the default for untagged files but not overridden files", () => {
    const { handle } = makeEditor();
    handle.setActiveFilePath("/tmp/a.md");
    handle.toggleCurrentFile(); // a.md override = true

    handle.setDefaultWrap(true);
    // a.md keeps its explicit override
    handle.setActiveFilePath("/tmp/a.md");
    expect(handle.isEnabled()).toBe(true);
    // b.md has no override → uses new global default (true)
    handle.setActiveFilePath("/tmp/b.md");
    expect(handle.isEnabled()).toBe(true);

    handle.setDefaultWrap(false);
    handle.setActiveFilePath("/tmp/b.md");
    expect(handle.isEnabled()).toBe(false);
    handle.dispose();
  });

  it("onChange fires when wrap state flips", () => {
    const { handle } = makeEditor();
    handle.setActiveFilePath("/tmp/a.md");
    const cb = vi.fn();
    handle.onChange(cb);
    handle.toggleCurrentFile();
    expect(cb).toHaveBeenCalledWith(true);
    handle.toggleCurrentFile();
    expect(cb).toHaveBeenCalledWith(false);
    handle.dispose();
  });

  it("renamePath migrates overrides when a file is renamed", () => {
    const { handle } = makeEditor();
    handle.setActiveFilePath("/tmp/old.md");
    handle.toggleCurrentFile();
    expect(handle.isEnabled()).toBe(true);

    handle.renamePath("/tmp/old.md", "/tmp/new.md");

    // old path should no longer have an override
    handle.setActiveFilePath("/tmp/old.md");
    expect(handle.isEnabled()).toBe(false);
    // new path inherits the override
    handle.setActiveFilePath("/tmp/new.md");
    expect(handle.isEnabled()).toBe(true);
    handle.dispose();
  });

  it("carryStateToNewFile copies the current wrap state to a new path (Save-As)", () => {
    const { handle } = makeEditor();
    handle.setActiveFilePath("/tmp/draft.md");
    handle.toggleCurrentFile(); // enabled = true

    handle.carryStateToNewFile("/tmp/final.md");
    handle.setActiveFilePath("/tmp/final.md");
    expect(handle.isEnabled()).toBe(true);
    handle.dispose();
  });

  it("the hotkey command toggles wrap", () => {
    const { editor, handle, container } = makeEditor();
    handle.setActiveFilePath("/tmp/a.md");
    expect(editor.runCommand("nexus.wrap.toggle")).toBe(true);
    expect(wrapClassOn(container)).toBe(true);
    handle.dispose();
  });

  it("disabling the hotkey does not break the command", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = createWrapPlugin({
      defaultWrap: false,
      storageKey: STORAGE_KEY,
      hotkey: null,
    });
    const editor = createEditor({
      container,
      initialValue: "",
      plugins: [handle.plugin],
    });
    handle.attach(editor, container);
    handle.setActiveFilePath("/tmp/a.md");
    expect(editor.runCommand("nexus.wrap.toggle")).toBe(true);
    expect(wrapClassOn(container)).toBe(true);
    handle.dispose();
  });

  it("renamePath migrates every override under a renamed directory", () => {
    const { handle } = makeEditor();
    handle.setActiveFilePath("/tmp/docs/a.md");
    handle.toggleCurrentFile();
    handle.setActiveFilePath("/tmp/docs/sub/b.md");
    handle.toggleCurrentFile();

    handle.renamePath("/tmp/docs", "/tmp/notes");

    handle.setActiveFilePath("/tmp/notes/a.md");
    expect(handle.isEnabled()).toBe(true);
    handle.setActiveFilePath("/tmp/notes/sub/b.md");
    expect(handle.isEnabled()).toBe(true);
    handle.setActiveFilePath("/tmp/docs/a.md");
    expect(handle.isEnabled()).toBe(false);
    handle.dispose();
  });

  it("toggleCurrentFile and setActiveFilePath are no-ops before attach", () => {
    const handle = createWrapPlugin({ defaultWrap: false, storageKey: STORAGE_KEY });
    expect(() => handle.toggleCurrentFile()).not.toThrow();
    expect(() => handle.setActiveFilePath("/tmp/a.md")).not.toThrow();
    expect(handle.isEnabled()).toBe(false);
    handle.dispose();
  });

  it("detach then re-attach preserves the per-file override", () => {
    const { container, handle, editor } = makeEditor();
    handle.setActiveFilePath("/tmp/a.md");
    handle.toggleCurrentFile();
    expect(handle.isEnabled()).toBe(true);

    handle.detach();
    expect(() => handle.toggleCurrentFile()).not.toThrow();
    expect(handle.isEnabled()).toBe(true);

    handle.attach(editor, container);
    handle.setActiveFilePath("/tmp/a.md");
    expect(handle.isEnabled()).toBe(true);
    expect(wrapClassOn(container)).toBe(true);
    handle.dispose();
  });

  it("multiple onChange listeners each fire; unsubscribed ones do not", () => {
    const { handle } = makeEditor();
    handle.setActiveFilePath("/tmp/a.md");
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const off1 = handle.onChange(cb1);
    handle.onChange(cb2);

    handle.toggleCurrentFile();
    expect(cb1).toHaveBeenCalledWith(true);
    expect(cb2).toHaveBeenCalledWith(true);

    off1();
    cb1.mockClear();
    cb2.mockClear();

    handle.toggleCurrentFile();
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledWith(false);
    handle.dispose();
  });

  it("setCurrentFileWrap writes an explicit override without toggling", () => {
    const { handle } = makeEditor();
    handle.setActiveFilePath("/tmp/a.md");
    expect(handle.isEnabled()).toBe(false);

    handle.setCurrentFileWrap(true);
    expect(handle.isEnabled()).toBe(true);

    handle.setCurrentFileWrap(true);
    expect(handle.isEnabled()).toBe(true);

    handle.setActiveFilePath("/tmp/b.md");
    expect(handle.isEnabled()).toBe(false);
    handle.setActiveFilePath("/tmp/a.md");
    expect(handle.isEnabled()).toBe(true);
    handle.dispose();
  });
});
