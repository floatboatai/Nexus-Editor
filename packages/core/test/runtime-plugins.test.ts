import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import { createEditor } from "../src/index";
import type { EditorAPI, InstalledPluginInfo, NexusPlugin } from "../src/types";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

function createTestEditor(config: Partial<Parameters<typeof createEditor>[0]> = {}): EditorAPI {
  const container = document.createElement("div");
  return createEditor({ container, initialValue: "hello", ...config });
}

/** Plugin whose update listener counts doc changes — observable install proof. */
function createCountingPlugin(name = "counting"): { plugin: NexusPlugin; calls: () => number } {
  let count = 0;
  const plugin: NexusPlugin = {
    name,
    cmExtensions: [
      EditorView.updateListener.of((update) => {
        if (update.docChanged) count++;
      }),
    ],
  };
  return { plugin, calls: () => count };
}

describe("runtime plugin management", () => {
  describe("addPlugin", () => {
    it("installs a cmExtensions plugin that takes effect immediately", () => {
      const editor = createTestEditor();
      const { plugin, calls } = createCountingPlugin();

      editor.addPlugin(plugin);
      editor.replaceRange(0, 0, "x");

      expect(calls()).toBe(1);
      editor.destroy();
    });

    it("installs shortcuts usable via runShortcut, same as static ones", () => {
      const editor = createTestEditor();
      const run = vi.fn(() => true);

      editor.addPlugin({ name: "with-shortcut", shortcuts: [{ key: "Mod-e", run }] });

      expect(editor.runShortcut("Mod-e")).toBe(true);
      expect(run).toHaveBeenCalledOnce();
      expect(run).toHaveBeenCalledWith(editor);
      editor.destroy();
    });

    it("accepts plugins whose construction-time hooks are declared but empty", () => {
      const editor = createTestEditor();

      expect(() =>
        editor.addPlugin({ name: "empty-hooks", cmExtensions: [], widgets: [], handlers: {} })
      ).not.toThrow();
      editor.destroy();
    });

    it.each([
      ["widgets", { widgets: [{ nodeType: "code", render: () => document.createElement("div") }] }],
      ["remarkPlugins", { remarkPlugins: [() => (tree: unknown) => tree] }],
      ["slashCommands", { slashCommands: [{ id: "x", label: "X", run: () => {} }] }],
      ["commands", { commands: [{ id: "x", label: "X", run: () => {} }] }],
      ["handlers", { handlers: { paste: () => true } }],
    ] as const)("rejects construction-time hook %s with the hook named", (hook, extra) => {
      const editor = createTestEditor();

      expect(() =>
        editor.addPlugin({ name: `bad-${hook}`, ...(extra as Partial<NexusPlugin>) })
      ).toThrow(new RegExp(`${hook}[\\s\\S]*createEditor`));
      // Rejected plugin must not be retained.
      expect(editor.getPlugins().some((p) => p.name === `bad-${hook}`)).toBe(false);
      editor.destroy();
    });

    it("rejects a name colliding with a static plugin", () => {
      const editor = createTestEditor({ plugins: [{ name: "taken" }] });

      expect(() => editor.addPlugin({ name: "taken" })).toThrow(/already installed/);
      editor.destroy();
    });

    it("rejects a name colliding with a runtime plugin", () => {
      const editor = createTestEditor();
      editor.addPlugin({ name: "dup" });

      expect(() => editor.addPlugin({ name: "dup" })).toThrow(/already installed/);
      editor.destroy();
    });

    it("throws on a destroyed editor", () => {
      const editor = createTestEditor();
      editor.destroy();

      expect(() => editor.addPlugin({ name: "late" })).toThrow(/destroyed/);
    });

    it("rolls back the registry when the install dispatch fails", () => {
      const editor = createTestEditor();
      const broken: NexusPlugin = {
        name: "broken",
        // Not a valid CM extension — reconfigure dispatch will throw.
        cmExtensions: [{} as never],
      };

      expect(() => editor.addPlugin(broken)).toThrow();
      expect(editor.getPlugins().some((p) => p.name === "broken")).toBe(false);

      // Editor stays fully operational: a valid install still works.
      const { plugin, calls } = createCountingPlugin();
      editor.addPlugin(plugin);
      editor.replaceRange(0, 0, "x");
      expect(calls()).toBe(1);
      editor.destroy();
    });

    it("preserves undo history across install", () => {
      const editor = createTestEditor({ plugins: [createHistoryPlugin()] });
      editor.replaceRange(5, 5, " world");
      expect(editor.getDocument()).toBe("hello world");

      editor.addPlugin({ name: "noop" });

      expect(editor.undo()).toBe(true);
      expect(editor.getDocument()).toBe("hello");
      editor.destroy();
    });
  });

  describe("removePlugin", () => {
    it("uninstalls completely — extension stops firing, shortcut unregistered", () => {
      const editor = createTestEditor();
      const { plugin, calls } = createCountingPlugin();
      const run = vi.fn(() => true);
      editor.addPlugin(plugin);
      editor.addPlugin({ name: "with-shortcut", shortcuts: [{ key: "Mod-e", run }] });
      editor.replaceRange(0, 0, "x");
      expect(calls()).toBe(1);

      expect(editor.removePlugin("counting")).toBe(true);
      expect(editor.removePlugin("with-shortcut")).toBe(true);

      editor.replaceRange(0, 0, "y");
      expect(calls()).toBe(1); // unchanged — listener gone
      expect(editor.runShortcut("Mod-e")).toBe(false);
      expect(run).not.toHaveBeenCalled();
      editor.destroy();
    });

    it("returns false for unknown names", () => {
      const editor = createTestEditor();

      expect(editor.removePlugin("nope")).toBe(false);
      editor.destroy();
    });

    it("throws for construction-time plugins", () => {
      const editor = createTestEditor({ plugins: [{ name: "static-one" }] });

      expect(() => editor.removePlugin("static-one")).toThrow(/construction-time/);
      editor.destroy();
    });

    it("throws on a destroyed editor", () => {
      const editor = createTestEditor();
      editor.addPlugin({ name: "p" });
      editor.destroy();

      expect(() => editor.removePlugin("p")).toThrow(/destroyed/);
    });
  });

  describe("getPlugins / pluginsChange", () => {
    it("reports static and runtime origins", () => {
      const editor = createTestEditor({ plugins: [{ name: "static-one" }] });
      editor.addPlugin({ name: "runtime-one" });

      expect(editor.getPlugins()).toEqual([
        { name: "static-one", runtime: false },
        { name: "runtime-one", runtime: true },
      ]);
      editor.destroy();
    });

    it("emits pluginsChange with the full list after add and remove", () => {
      const editor = createTestEditor({ plugins: [{ name: "static-one" }] });
      const snapshots: InstalledPluginInfo[][] = [];
      editor.on("pluginsChange", (plugins) => snapshots.push(plugins));

      editor.addPlugin({ name: "a" });
      editor.addPlugin({ name: "b" });
      editor.removePlugin("a");

      expect(snapshots).toEqual([
        [
          { name: "static-one", runtime: false },
          { name: "a", runtime: true },
        ],
        [
          { name: "static-one", runtime: false },
          { name: "a", runtime: true },
          { name: "b", runtime: true },
        ],
        [
          { name: "static-one", runtime: false },
          { name: "b", runtime: true },
        ],
      ]);
      editor.destroy();
    });

    it("does not emit pluginsChange for rejected installs", () => {
      const editor = createTestEditor();
      const listener = vi.fn();
      editor.on("pluginsChange", listener);

      expect(() => editor.addPlugin({ name: "bad", handlers: { paste: () => true } })).toThrow();
      expect(listener).not.toHaveBeenCalled();
      editor.destroy();
    });
  });
});
