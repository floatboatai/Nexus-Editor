import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor } from "../src/index";
import type { EditorAPI, KeybindingEntry, NexusPlugin } from "../src/index";

function makePlugin(name: string, opts: Partial<NexusPlugin> = {}): NexusPlugin {
  return { name, ...opts };
}

/** Wait one microtask tick for the async hydration emit to land. */
function waitMicrotask(): Promise<void> {
  return Promise.resolve();
}

describe("EditorAPI keybindings", () => {
  let container: HTMLElement;
  let editor: EditorAPI;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    editor?.destroy();
    container.remove();
  });

  describe("getKeybindings — enumeration", () => {
    it("lists every plugin shortcut and command with a hotkey", () => {
      const shortcutRun = vi.fn(() => true);
      const cmdWithHotkey = vi.fn(() => true);
      const cmdNoHotkey = vi.fn(() => true);

      editor = createEditor({
        container,
        plugins: [
          makePlugin("test", {
            shortcuts: [{ key: "Mod-j", run: shortcutRun }],
            commands: [
              { id: "heading", label: "H1", hotkey: "Mod-1", run: cmdWithHotkey },
              { id: "silent", label: "No key", run: cmdNoHotkey }, // no hotkey → excluded
            ],
          }),
        ],
      });

      const entries = editor.getKeybindings();
      expect(entries).toHaveLength(2);
      const ids = entries.map((e) => e.id).sort();
      expect(ids).toEqual([
        "plugin:test/command:heading",
        "plugin:test/shortcut:0",
      ]);
    });

    it("tags each entry with source, pluginName, defaultKey and label", () => {
      editor = createEditor({
        container,
        plugins: [
          makePlugin("kit", {
            shortcuts: [{ key: "Mod-k", run: () => true }],
            commands: [{ id: "bold", label: "Bold", hotkey: "Mod-b", run: () => true }],
          }),
        ],
      });

      const entries = editor.getKeybindings();
      const shortcut = entries.find((e) => e.id === "plugin:kit/shortcut:0")!;
      const command = entries.find((e) => e.id === "plugin:kit/command:bold")!;

      expect(shortcut.source).toBe("plugin-shortcut");
      expect(shortcut.pluginName).toBe("kit");
      expect(shortcut.defaultKey).toBe("Mod-k");
      expect(shortcut.key).toBe("Mod-k");
      expect(shortcut.conflicts).toEqual([]);

      expect(command.source).toBe("plugin-command");
      expect(command.pluginName).toBe("kit");
      expect(command.defaultKey).toBe("Mod-b");
      expect(command.label).toBe("Bold");
    });

    it("returns a fresh array each call — mutations don't leak", () => {
      editor = createEditor({
        container,
        plugins: [makePlugin("test", { shortcuts: [{ key: "Mod-j", run: () => true }] })],
      });

      const a = editor.getKeybindings();
      a[0].conflicts.push("bogus");
      a[0].key = "Mod-z";

      const b = editor.getKeybindings();
      expect(b[0].conflicts).toEqual([]);
      expect(b[0].key).toBe("Mod-j");
    });
  });

  describe("setUserKeybindings — rebinding", () => {
    it("rebinds a command hotkey (defaultKey preserved, key updated)", () => {
      editor = createEditor({
        container,
        plugins: [
          makePlugin("test", {
            commands: [{ id: "h1", hotkey: "Mod-1", run: () => true }],
          }),
        ],
      });

      editor.setUserKeybindings([{ id: "plugin:test/command:h1", key: "Mod-h" }]);

      const [entry] = editor.getKeybindings();
      expect(entry.key).toBe("Mod-h");
      expect(entry.defaultKey).toBe("Mod-1");
    });

    it("unbinds with key: null (key becomes null, defaultKey preserved)", () => {
      editor = createEditor({
        container,
        plugins: [
          makePlugin("test", {
            commands: [{ id: "h1", hotkey: "Mod-1", run: () => true }],
          }),
        ],
      });

      editor.setUserKeybindings([{ id: "plugin:test/command:h1", key: null }]);

      const [entry] = editor.getKeybindings();
      expect(entry.key).toBeNull();
      expect(entry.defaultKey).toBe("Mod-1");
    });

    it("restores defaults when called with an empty array", () => {
      editor = createEditor({
        container,
        plugins: [
          makePlugin("test", {
            commands: [
              { id: "h1", hotkey: "Mod-1", run: () => true },
              { id: "h2", hotkey: "Mod-2", run: () => true },
            ],
          }),
        ],
      });

      editor.setUserKeybindings([
        { id: "plugin:test/command:h1", key: "Mod-a" },
        { id: "plugin:test/command:h2", key: null },
      ]);
      // Sanity: overrides applied.
      const overridden = editor.getKeybindings();
      expect(overridden.find((e) => e.id.endsWith(":h1"))!.key).toBe("Mod-a");
      expect(overridden.find((e) => e.id.endsWith(":h2"))!.key).toBeNull();

      editor.setUserKeybindings([]);
      const restored = editor.getKeybindings();
      expect(restored.find((e) => e.id.endsWith(":h1"))!.key).toBe("Mod-1");
      expect(restored.find((e) => e.id.endsWith(":h2"))!.key).toBe("Mod-2");
    });

    it("ignores unknown ids without throwing", () => {
      editor = createEditor({
        container,
        plugins: [
          makePlugin("test", {
            commands: [{ id: "h1", hotkey: "Mod-1", run: () => true }],
          }),
        ],
      });

      expect(() => {
        editor.setUserKeybindings([
          { id: "plugin:missing/command:x", key: "Mod-k" },
          { id: "plugin:test/command:h1", key: "Mod-h" }, // still valid
        ]);
      }).not.toThrow();

      const entries = editor.getKeybindings();
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe("plugin:test/command:h1");
      expect(entries[0].key).toBe("Mod-h");
    });
  });

  describe("conflict detection", () => {
    it("surfaces conflicts on both sides when two entries share the same key", () => {
      editor = createEditor({
        container,
        plugins: [
          makePlugin("a", { commands: [{ id: "cmd", hotkey: "Mod-k", run: () => true }] }),
          makePlugin("b", { shortcuts: [{ key: "Mod-k", run: () => true }] }),
        ],
      });

      const entries = editor.getKeybindings();
      const cmd = entries.find((e) => e.id === "plugin:a/command:cmd")!;
      const sc = entries.find((e) => e.id === "plugin:b/shortcut:0")!;

      expect(cmd.conflicts).toContain("plugin:b/shortcut:0");
      expect(sc.conflicts).toContain("plugin:a/command:cmd");
    });

    it("empty conflicts when every entry has a unique key", () => {
      editor = createEditor({
        container,
        plugins: [
          makePlugin("a", { commands: [{ id: "cmd", hotkey: "Mod-1", run: () => true }] }),
          makePlugin("b", { shortcuts: [{ key: "Mod-2", run: () => true }] }),
        ],
      });

      for (const entry of editor.getKeybindings()) {
        expect(entry.conflicts).toEqual([]);
      }
    });

    it("re-computes conflicts after an override changes bindings", () => {
      editor = createEditor({
        container,
        plugins: [
          makePlugin("a", { commands: [{ id: "cmd1", hotkey: "Mod-1", run: () => true }] }),
          makePlugin("b", { commands: [{ id: "cmd2", hotkey: "Mod-2", run: () => true }] }),
        ],
      });

      // Baseline: no conflict.
      for (const e of editor.getKeybindings()) expect(e.conflicts).toEqual([]);

      // Force a collision by rebinding cmd2 onto cmd1's key.
      editor.setUserKeybindings([{ id: "plugin:b/command:cmd2", key: "Mod-1" }]);

      const entries = editor.getKeybindings();
      const c1 = entries.find((e) => e.id.endsWith(":cmd1"))!;
      const c2 = entries.find((e) => e.id.endsWith(":cmd2"))!;
      expect(c1.conflicts).toContain(c2.id);
      expect(c2.conflicts).toContain(c1.id);
    });
  });

  describe("keybindingsChange event", () => {
    it("fires once for initial hydration", async () => {
      const handler = vi.fn<(entries: KeybindingEntry[]) => void>();
      editor = createEditor({
        container,
        plugins: [
          makePlugin("test", {
            commands: [{ id: "h1", hotkey: "Mod-1", run: () => true }],
          }),
        ],
      });
      editor.on("keybindingsChange", handler);

      // Hydration is queueMicrotask-deferred — wait a tick.
      await waitMicrotask();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toHaveLength(1);
    });

    it("fires exactly once per setUserKeybindings call, regardless of override count", async () => {
      const handler = vi.fn();
      editor = createEditor({
        container,
        plugins: [
          makePlugin("test", {
            commands: [
              { id: "h1", hotkey: "Mod-1", run: () => true },
              { id: "h2", hotkey: "Mod-2", run: () => true },
              { id: "h3", hotkey: "Mod-3", run: () => true },
            ],
          }),
        ],
      });
      await waitMicrotask(); // let hydration fire first
      editor.on("keybindingsChange", handler);

      editor.setUserKeybindings([
        { id: "plugin:test/command:h1", key: "Mod-a" },
        { id: "plugin:test/command:h2", key: "Mod-b" },
        { id: "plugin:test/command:h3", key: "Mod-c" },
      ]);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("still fires when overrides contain only unknown ids (snapshot semantics)", async () => {
      const handler = vi.fn();
      editor = createEditor({
        container,
        plugins: [makePlugin("test", { shortcuts: [{ key: "Mod-j", run: () => true }] })],
      });
      await waitMicrotask();
      editor.on("keybindingsChange", handler);

      editor.setUserKeybindings([{ id: "plugin:nope/command:x", key: "Mod-k" }]);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("no fire after destroy", async () => {
      const handler = vi.fn();
      editor = createEditor({
        container,
        plugins: [makePlugin("test", { shortcuts: [{ key: "Mod-j", run: () => true }] })],
      });
      editor.on("keybindingsChange", handler);
      editor.destroy();

      await waitMicrotask();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("integration — CM6 keymap reconfigure", () => {
    it("dispatches the new binding when a rebound key is pressed", () => {
      const cmdRun = vi.fn(() => true);
      editor = createEditor({
        container,
        plugins: [
          makePlugin("test", {
            commands: [{ id: "boom", hotkey: "F1", run: cmdRun }],
          }),
        ],
      });

      editor.setUserKeybindings([{ id: "plugin:test/command:boom", key: "F2" }]);

      // Simulate the user pressing F2 in the editor content DOM. CM6 attaches
      // its keymap listener to the content editable; a KeyboardEvent
      // dispatched here flows through the same handler chain a real key
      // would. jsdom emits synthetic events without native key semantics, so
      // we use the `key` string CM6 matches on.
      const contentDOM = container.querySelector<HTMLElement>(".cm-content")!;
      const ev = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
      contentDOM.dispatchEvent(ev);

      expect(cmdRun).toHaveBeenCalled();
    });
  });
});
