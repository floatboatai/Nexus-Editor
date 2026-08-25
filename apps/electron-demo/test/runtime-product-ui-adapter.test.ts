import {
  type ComponentId,
  type JsonValue,
  type MenuContext,
  type NexusFile,
  type PluginDataSnapshot,
  type PluginId,
  type PluginStorageService,
  type ResourceOwner,
  type SettingValue,
} from "@floatboat/nexus-plugin-api";
import {
  RuntimeUiHost,
  RuntimeWorkspace,
  createWindowContext,
} from "@floatboat/nexus-plugin-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ELECTRON_PRODUCT_SETTING_TAB_ID,
  ELECTRON_PRODUCT_UI_OWNER,
  ELECTRON_PRODUCT_VIEW_TYPES,
  ElectronRuntimeProductUiAdapter,
} from "../src/renderer/runtime-product-ui-adapter";

function owner(pluginId: string): ResourceOwner {
  return {
    pluginId: pluginId as PluginId,
    componentId: `${pluginId}/root` as ComponentId,
  };
}

function file(path: string): NexusFile {
  const name = path.split("/").at(-1)!;
  return {
    id: `file:${path}` as NexusFile["id"],
    kind: "file",
    path: path as NexusFile["path"],
    name,
    basename: name.replace(/\.md$/, ""),
    extension: "md",
    parent: null,
    valid: true,
    size: 0,
    createdAt: 0,
    modifiedAt: 0,
    version: "1" as NexusFile["version"],
  };
}

function memoryStorage(): PluginStorageService {
  let data: JsonValue | null = null;
  let version = 0;
  return {
    events: { on: vi.fn() as never },
    loadData: async <TData extends JsonValue = JsonValue>() => ({
      data: data as TData | null,
      version: String(version),
      schemaVersion: null,
    } satisfies PluginDataSnapshot<TData>),
    saveData: async (next) => {
      data = next;
      version += 1;
      return { ok: true, value: { version: String(version), schemaVersion: null } };
    },
    migrateData: vi.fn() as never,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("ElectronRuntimeProductUiAdapter", () => {
  it("owns product views through sidebar leaves without replacing the primary Markdown leaf", async () => {
    const workspace = new RuntimeWorkspace(document, {
      supportedContainers: ["root", "tab", "sidebar"],
    });
    const window = workspace.createWindow(document, "main");
    const primary = workspace.createLeaf({
      id: "electron-markdown-leaf",
      windowId: window.id,
      containerType: "tab",
    });
    workspace.setActiveLeaf(primary.id);
    workspace.focusLeaf(primary.id);
    const layout = document.createElement("main");
    document.body.append(layout);
    const storage = memoryStorage();
    const ui = new RuntimeUiHost({
      defaultWindow: window,
      resolveStorage: () => storage,
    });
    const destroys = { outline: vi.fn(), backlinks: vi.fn() };
    const visibility = { outline: vi.fn(), backlinks: vi.fn() };
    const updates = { outline: vi.fn(), backlinks: vi.fn() };
    const adapter = new ElectronRuntimeProductUiAdapter({
      workspace,
      ui,
      window,
      primaryLeaf: primary,
      layoutContainer: layout,
      createOutline: () => {
        const element = document.createElement("aside");
        element.className = "nexus-outline-panel";
        return {
          element,
          setVisible: visibility.outline,
          update: updates.outline,
          destroy: destroys.outline,
        };
      },
      createBacklinks: () => {
        const element = document.createElement("aside");
        element.className = "backlinks-panel";
        return {
          element,
          setVisible: visibility.backlinks,
          refresh: updates.backlinks,
          destroy: destroys.backlinks,
        };
      },
      settingTab: {
        id: "settings",
        name: "Settings",
        settings: [{ id: "lineNumbers", type: "toggle", name: "Line numbers", defaultValue: true }],
      },
      contributeFileMenu: (menu) => menu.addItem({ id: "host-open", label: "Open", action: vi.fn() }),
    });

    await adapter.start();

    expect(workspace.getFocusedLeaf()).toBe(primary);
    expect(workspace.getActiveView()).toBe(primary.view);
    expect(workspace.getLeaves()).toContain(primary);
    const outlineLeaf = adapter.getViewLeaf("outline")!;
    const backlinksLeaf = adapter.getViewLeaf("backlinks")!;
    expect(outlineLeaf).not.toBe(primary);
    expect(backlinksLeaf).not.toBe(primary);
    expect(outlineLeaf.containerType).toBe("sidebar");
    expect(backlinksLeaf.containerType).toBe("sidebar");
    expect(outlineLeaf.viewType).toBe(ELECTRON_PRODUCT_VIEW_TYPES.outline);
    expect(backlinksLeaf.viewType).toBe(ELECTRON_PRODUCT_VIEW_TYPES.backlinks);
    expect(outlineLeaf.view?.owner).toMatchObject({ pluginId: ELECTRON_PRODUCT_UI_OWNER.pluginId });
    expect(backlinksLeaf.view?.owner).toMatchObject({ pluginId: ELECTRON_PRODUCT_UI_OWNER.pluginId });
    expect(layout.querySelectorAll(".nexus-workspace-leaf")).toHaveLength(2);
    expect(layout.querySelectorAll(".nexus-outline-panel")).toHaveLength(1);
    expect(layout.querySelectorAll(".backlinks-panel")).toHaveLength(1);
    expect(layout.querySelector("[data-plugin-slot], [data-ui-action-id]")).toBeNull();
    expect(visibility.outline.mock.calls).toEqual([[true]]);
    expect(visibility.backlinks.mock.calls).toEqual([[true]]);
    expect(updates.outline).not.toHaveBeenCalled();
    expect(updates.backlinks).not.toHaveBeenCalled();

    adapter.toggleView("outline");
    expect(outlineLeaf.containerEl.hidden).toBe(true);
    adapter.toggleView("outline");
    expect(outlineLeaf.containerEl.hidden).toBe(false);
    expect(visibility.outline.mock.calls).toEqual([[true], [false], [true]]);
    expect(adapter.getViewLeaf("outline")).toBe(outlineLeaf);

    await adapter.destroy();
    expect(workspace.getLeaves()).toEqual([primary]);
    expect(workspace.getFocusedLeaf()).toBe(primary);
    expect(workspace.getLeavesOfType(ELECTRON_PRODUCT_VIEW_TYPES.outline)).toEqual([]);
    expect(workspace.getLeavesOfType(ELECTRON_PRODUCT_VIEW_TYPES.backlinks)).toEqual([]);
    expect(destroys.outline).toHaveBeenCalledOnce();
    expect(destroys.backlinks).toHaveBeenCalledOnce();
    expect(visibility.outline).toHaveBeenLastCalledWith(false);
    expect(visibility.backlinks).toHaveBeenLastCalledWith(false);
    expect(layout.childElementCount).toBe(0);
  });

  it("routes settings and file menus through owner-bound RuntimeUiHost registries", async () => {
    const workspace = new RuntimeWorkspace(document, {
      supportedContainers: ["root", "tab", "sidebar"],
    });
    const window = workspace.createWindow(document, "main");
    const primary = workspace.createLeaf({ id: "primary", windowId: window.id, containerType: "tab" });
    const storage = memoryStorage();
    const ui = new RuntimeUiHost({ defaultWindow: window, resolveStorage: () => storage });
    const layout = document.createElement("main");
    document.body.append(layout);
    const adapter = new ElectronRuntimeProductUiAdapter({
      workspace,
      ui,
      window,
      primaryLeaf: primary,
      layoutContainer: layout,
      createOutline: () => ({ element: document.createElement("aside"), destroy: vi.fn() }),
      createBacklinks: () => ({ element: document.createElement("aside"), destroy: vi.fn() }),
      settingTab: {
        id: "settings",
        name: "Editor settings",
        settings: [{ id: "fontSize", type: "number", name: "Font size", defaultValue: 15 }],
      },
      contributeFileMenu: (menu, context) => menu.addItem({
        id: "host-inspect",
        label: `Inspect ${context.file?.path ?? "file"}`,
        action: vi.fn(),
      }),
    });
    await adapter.start();

    const settingContainer = document.createElement("section");
    document.body.append(settingContainer);
    const displayed = await adapter.displaySettings(settingContainer);
    expect(displayed.ok).toBe(true);
    expect(settingContainer.dataset.settingTabId).toBe(ELECTRON_PRODUCT_SETTING_TAB_ID);
    expect(document.querySelectorAll(`[data-setting-tab-id="${ELECTRON_PRODUCT_SETTING_TAB_ID}"]`)).toHaveLength(1);
    expect(settingContainer.querySelectorAll("[data-setting-id='fontSize']")).toHaveLength(1);
    await adapter.displaySettings(settingContainer);
    expect(settingContainer.querySelectorAll("[data-setting-id='fontSize']")).toHaveLength(1);

    const pluginResources: Array<{ activate?(): void | Promise<void>; quiesce?(): void; dispose(): void | Promise<void> }> = [];
    const pluginUi = ui.createService(owner("menu-plugin"), (resource) => pluginResources.push(resource));
    const pluginContribution = pluginUi.menus.registerContribution("file-menu", (menu) => {
      menu.addItem({ id: "plugin-item", label: "Plugin item", action: vi.fn() });
    }, { section: "plugin" });
    expect(pluginContribution.ok).toBe(true);
    for (const resource of pluginResources) await resource.activate?.();
    const sourceFile = file("note.md");
    const context: MenuContext = {
      kind: "file",
      event: null,
      window,
      leaf: primary,
      view: primary.view,
      editor: null,
      file: sourceFile,
      command: null,
    };
    const menu = adapter.createFileMenu(context, [{ id: "rename", label: "Rename", action: vi.fn() }]);
    await menu.showAt({ x: 1, y: 2 });
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>(".nexus-plugin-menu button")).map((button) => button.textContent))
      .toEqual(expect.arrayContaining(["Rename", "Inspect note.md", "Plugin item"]));
    expect(document.querySelectorAll(".nexus-plugin-menu")).toHaveLength(1);
    await menu.close();

    const otherContext: MenuContext = { ...context, file: file("other.md") };
    const firstMenu = adapter.showFileMenu(context, { x: 3, y: 4 }, [
      { id: "first-only", label: "First only", action: vi.fn() },
    ]);
    const secondMenu = adapter.showFileMenu(otherContext, { x: 5, y: 6 }, [
      { id: "second-only", label: "Second only", action: vi.fn() },
    ]);
    await Promise.all([firstMenu, secondMenu]);
    expect(document.querySelectorAll(".nexus-plugin-menu")).toHaveLength(1);
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>(".nexus-plugin-menu button"))
      .map((button) => button.textContent)).toEqual(expect.arrayContaining([
        "Second only",
        "Inspect other.md",
        "Plugin item",
      ]));
    expect(document.querySelector<HTMLButtonElement>('[data-menu-item-id="first-only"]')).toBeNull();

    await adapter.destroy();
    expect((await ui.displaySettingTab(ELECTRON_PRODUCT_SETTING_TAB_ID, window, settingContainer)).ok).toBe(false);
    const remainingMenu = pluginUi.menus.createMenu(context);
    await remainingMenu.showAt({ x: 0, y: 0 });
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>(".nexus-plugin-menu button")).map((button) => button.textContent))
      .toEqual(["Plugin item"]);
    await remainingMenu.close();
    for (const resource of [...pluginResources].reverse()) {
      resource.quiesce?.();
      await resource.dispose();
    }
  });

  it("rejects product layout containers nested in plugin action slots", async () => {
    const workspace = new RuntimeWorkspace(document, { supportedContainers: ["root", "tab", "sidebar"] });
    const window = workspace.createWindow(document, "main");
    const primary = workspace.createLeaf({ id: "primary", windowId: window.id, containerType: "tab" });
    const pluginSlot = document.createElement("div");
    pluginSlot.dataset.pluginSlot = "view-toolbar";
    const nested = document.createElement("div");
    pluginSlot.append(nested);
    const adapter = new ElectronRuntimeProductUiAdapter({
      workspace,
      ui: new RuntimeUiHost({ defaultWindow: createWindowContext("main", document), resolveStorage: () => memoryStorage() }),
      window,
      primaryLeaf: primary,
      layoutContainer: nested,
      createOutline: () => ({ element: document.createElement("aside"), destroy: vi.fn() }),
      createBacklinks: () => ({ element: document.createElement("aside"), destroy: vi.fn() }),
      settingTab: { id: "settings", name: "Settings" },
      contributeFileMenu: vi.fn(),
    });

    await expect(adapter.start()).rejects.toThrow("cannot mount inside a plugin action slot");
    expect(workspace.getLeaves()).toEqual([primary]);
    expect(adapter.getSnapshot().managedResourceCount).toBe(0);
  });
});
