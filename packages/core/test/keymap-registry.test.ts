import { describe, expect, it } from "vitest";

import { createEditor } from "../src/index";
import type { KeybindingInfo, NexusPlugin } from "../src/types";

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function press(container: HTMLElement, key: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}): void {
  const content = container.querySelector<HTMLElement>(".cm-content");
  if (!content) throw new Error("Expected content DOM");
  content.dispatchEvent(new KeyboardEvent("keydown", {
    key,
    ctrlKey: mods.ctrl === true,
    metaKey: mods.meta === true,
    shiftKey: mods.shift === true,
    bubbles: true,
    cancelable: true,
  }));
}

/** jsdom reports a non-Mac platform, so CM6 normalizes "Mod-*" to "Ctrl-*". */
function pressMod(container: HTMLElement, key: string): void {
  press(container, key, { ctrl: true });
}

function pluginWithShortcut(key: string, calls: string[]): NexusPlugin {
  return {
    name: "alpha",
    shortcuts: [{
      key,
      run: () => {
        calls.push("plugin-shortcut");
        return true;
      },
    }],
  };
}

describe("host keybinding registry", () => {
  it("runs a registered binding and consumes the keystroke", async () => {
    const container = document.createElement("div");
    const editor = createEditor({ container });
    const calls: string[] = [];
    const registration = editor.getContributionSink().registerKeybinding("test-owner", {
      key: "Mod-k",
      run: () => {
        calls.push("host");
        return true;
      },
    });

    await registration.ready;
    pressMod(container, "k");

    expect(calls).toEqual(["host"]);
    await registration.dispose();
    editor.destroy();
  });

  it("falls through to the next binding when the handler does not consume", async () => {
    const container = document.createElement("div");
    const editor = createEditor({ container });
    const calls: string[] = [];
    const sink = editor.getContributionSink();
    const first = sink.registerKeybinding("owner-a", {
      key: "Mod-k",
      run: () => {
        calls.push("a");
        // No return — falls through by contract.
      },
    });
    const second = sink.registerKeybinding("owner-b", {
      key: "Mod-k",
      run: () => {
        calls.push("b");
        return true;
      },
    });

    await Promise.all([first.ready, second.ready]);
    pressMod(container, "k");

    expect(calls).toEqual(["a", "b"]);
    await Promise.all([first.dispose(), second.dispose()]);
    editor.destroy();
  });

  it("dispose removes the binding and re-registering the same key works", async () => {
    const container = document.createElement("div");
    const editor = createEditor({ container });
    const calls: string[] = [];
    const sink = editor.getContributionSink();
    const first = sink.registerKeybinding("owner-a", {
      key: "Mod-j",
      run: () => {
        calls.push("first");
        return true;
      },
    });

    await first.ready;
    await first.dispose();

    const second = sink.registerKeybinding("owner-b", {
      key: "Mod-j",
      run: () => {
        calls.push("second");
        return true;
      },
    });
    await second.ready;
    pressMod(container, "j");

    expect(calls).toEqual(["second"]);
    await second.dispose();
    editor.destroy();
  });

  it("resolves duplicate keys deterministically: earlier registration wins at equal priority", async () => {
    const container = document.createElement("div");
    const editor = createEditor({ container });
    const calls: string[] = [];
    const sink = editor.getContributionSink();
    const first = sink.registerKeybinding("owner-a", {
      key: "Mod-j",
      run: () => {
        calls.push("a");
        return true;
      },
    });
    const second = sink.registerKeybinding("owner-b", {
      key: "Mod-j",
      run: () => {
        calls.push("b");
        return true;
      },
    });

    await Promise.all([first.ready, second.ready]);
    pressMod(container, "j");

    expect(calls).toEqual(["a"]);

    await first.dispose();
    pressMod(container, "j");

    expect(calls).toEqual(["a", "b"]);

    await second.dispose();
    editor.destroy();
  });

  it("default-priority host bindings do not preempt a plugin shortcut", async () => {
    const container = document.createElement("div");
    const calls: string[] = [];
    const editor = createEditor({ container, plugins: [pluginWithShortcut("Mod-j", calls)] });
    const registration = editor.getContributionSink().registerKeybinding("host-app", {
      key: "Mod-j",
      run: () => {
        calls.push("host-default");
        return true;
      },
    });

    await registration.ready;
    pressMod(container, "j");

    expect(calls).toEqual(["plugin-shortcut"]);
    await registration.dispose();
    editor.destroy();
  });

  it("positive-priority host bindings preempt a plugin shortcut", async () => {
    const container = document.createElement("div");
    const calls: string[] = [];
    const editor = createEditor({ container, plugins: [pluginWithShortcut("Mod-j", calls)] });
    const registration = editor.getContributionSink().registerKeybinding(
      "host-app",
      {
        key: "Mod-j",
        run: () => {
          calls.push("host-high");
          return true;
        },
      },
      { priority: 5 }
    );

    await registration.ready;
    pressMod(container, "j");

    expect(calls).toEqual(["host-high"]);
    await registration.dispose();

    await nextFrame();
    pressMod(container, "j");

    expect(calls).toEqual(["host-high", "plugin-shortcut"]);
    editor.destroy();
  });

  it("getKeybindings lists all sources in documented precedence order", async () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      plugins: [{
        name: "alpha",
        shortcuts: [{ key: "Mod-j", run: () => true }],
        commands: [{ id: "alpha.cmd", label: "Alpha", hotkey: "Ctrl-Shift-7", run: () => true }],
      }],
    });
    const high = editor.getContributionSink().registerKeybinding(
      "host-app",
      { key: "Mod-p", run: () => true },
      { priority: 3 }
    );
    const low = editor.getContributionSink().registerKeybinding("host-app", {
      key: "Mod-q",
      run: () => true,
    });
    await Promise.all([high.ready, low.ready]);

    const snapshot: KeybindingInfo[] = editor.getKeybindings();
    const describe = (entry: KeybindingInfo) => `${entry.source}:${entry.ownerId}:${entry.key}`;

    expect(snapshot.map(describe)).toEqual([
      "builtin:nexus-core:Enter",
      "host:host-app:Mod-p",
      "plugin-shortcut:alpha:Mod-j",
      "plugin-command:alpha:Ctrl-Shift-7",
      "host:host-app:Mod-q",
    ]);

    await Promise.all([high.dispose(), low.dispose()]);
    editor.destroy();
  });

  it("installs config.keybindings through the registry with owner editor-config", async () => {
    const container = document.createElement("div");
    const calls: string[] = [];
    const editor = createEditor({
      container,
      keybindings: [{
        key: "Mod-e",
        run: () => {
          calls.push("config");
          return true;
        },
      }],
    });

    await nextFrame();
    pressMod(container, "e");

    expect(calls).toEqual(["config"]);
    const entry = editor.getKeybindings().find((candidate) => candidate.key === "Mod-e");
    expect(entry).toMatchObject({ source: "host", ownerId: "editor-config" });
    editor.destroy();
  });

  it("defers physical installation until an active IME composition ends", async () => {
    const container = document.createElement("div");
    const editor = createEditor({ container });
    const sink = editor.getContributionSink();
    const content = container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("Expected content DOM");
    let installed = false;
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

    content.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const registration = sink.registerKeybinding("ime-owner", {
      key: "Mod-k",
      run: () => {
        installed = true;
        return true;
      },
    });

    // While the composition is active the flush pipeline keeps deferring, so
    // `ready` must not settle no matter how many frames pass.
    let readySettled: boolean | undefined;
    void registration.ready.then(() => {
      readySettled = false;
    });
    await settle();
    await settle();
    await settle();
    expect(readySettled).toBeUndefined();

    content.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await registration.ready;
    // jsdom timing around synthetic composition teardown can swallow a
    // keystroke right after `ready`; keep pressing within a budget until the
    // binding is observably active.
    const deadline = Date.now() + 1000;
    while (!installed && Date.now() < deadline) {
      pressMod(container, "k");
      await settle();
    }

    expect(installed).toBe(true);
    await registration.dispose();
    editor.destroy();
  });

  it("validates arguments and rejects registration on destroyed editors", async () => {
    const container = document.createElement("div");
    const editor = createEditor({ container });
    const sink = editor.getContributionSink();

    expect(() => sink.registerKeybinding("", { key: "Mod-k", run: () => true })).toThrow(TypeError);
    expect(() => sink.registerKeybinding("owner", { key: "", run: () => true })).toThrow(TypeError);
    expect(() =>
      sink.registerKeybinding("owner", { key: "Mod-k", run: undefined as unknown as () => boolean })
    ).toThrow(TypeError);
    expect(() =>
      sink.registerKeybinding("owner", { key: "Mod-k", run: () => true }, { priority: 99_999 })
    ).toThrow(RangeError);

    editor.destroy();
    expect(() => sink.registerKeybinding("owner", { key: "Mod-k", run: () => true })).toThrow(Error);
  });
});
