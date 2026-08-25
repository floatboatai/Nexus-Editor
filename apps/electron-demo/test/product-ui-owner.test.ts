import { createEditor } from "@floatboat/nexus-core";
import { describe, expect, it, vi } from "vitest";

import { createBacklinksPanel } from "../src/renderer/backlinks-panel";
import { LinkIndex } from "../src/renderer/link-index";
import { createOutlinePanel } from "../src/renderer/outline-panel";
import {
  ELECTRON_PRODUCT_UI_SURFACES,
  ElectronProductUiOwner,
  type ProductUiResource,
} from "../src/renderer/product-ui-owner";
import { createSettingsPanel, defaultSettings } from "../src/renderer/settings";

describe("ElectronProductUiOwner", () => {
  it("keeps product views in host-owned surfaces outside plugin action slots", () => {
    const owner = new ElectronProductUiOwner(document);
    const layout = document.createElement("main");
    const editorContainer = document.createElement("div");
    document.body.append(layout, editorContainer);
    const editor = createEditor({
      container: editorContainer,
      initialValue: "# First\n\n## Second",
    });
    const outline = createOutlinePanel(editor);
    const backlinks = createBacklinksPanel({
      index: new LinkIndex(),
      getActiveFile: () => null,
      onOpenFile: vi.fn(),
    });

    const outlineRegistration = owner.registerView("outline", outline, { containerEl: layout });
    const backlinksRegistration = owner.registerView("backlinks", backlinks, { containerEl: layout });

    expect(Object.keys(ELECTRON_PRODUCT_UI_SURFACES).sort()).toEqual([
      "backlinks",
      "outline",
      "settings",
      "vault-context-menu",
    ]);
    expect(layout.children).toEqual(expect.objectContaining({ length: 2 }));
    expect(outline.element.dataset).toMatchObject({
      nexusProductSurface: "outline",
      nexusProductKind: "view",
      nexusUiOwner: "electron-host",
    });
    expect(backlinks.element.dataset).toMatchObject({
      nexusProductSurface: "backlinks",
      nexusProductKind: "view",
      nexusUiOwner: "electron-host",
    });
    expect(layout.querySelector("[data-plugin-slot], [data-ui-action-id]")).toBeNull();

    outlineRegistration.hide();
    expect(outlineRegistration.visible).toBe(false);
    outlineRegistration.show();
    expect(outlineRegistration.visible).toBe(true);
    backlinksRegistration.toggle();
    expect(backlinks.element.hidden).toBe(true);

    expect(() => owner.registerView("outline", createOutlinePanel(editor), { containerEl: layout }))
      .toThrow("already has an owner");

    owner.destroy();
    expect(owner.size).toBe(0);
    expect(layout.childElementCount).toBe(0);
    editor.destroy();
    editorContainer.remove();
    layout.remove();
  });

  it("refuses to mount a product view into a plugin action slot", () => {
    const owner = new ElectronProductUiOwner(document);
    const pluginSlot = document.createElement("div");
    pluginSlot.dataset.pluginSlot = "view-toolbar";
    const element = document.createElement("aside");
    const destroy = vi.fn(() => element.remove());

    expect(() => owner.registerView("outline", { element, destroy }, { containerEl: pluginSlot }))
      .toThrow("cannot mount inside a plugin action slot");
    expect(owner.size).toBe(0);
    expect(destroy).not.toHaveBeenCalled();
    owner.destroy();
  });

  it("propagates visibility without double-refreshing lifecycle-aware views", () => {
    const owner = new ElectronProductUiOwner(document);
    const layout = document.createElement("main");
    const outlineElement = document.createElement("aside");
    const outlineVisibility = vi.fn();
    const outlineUpdate = vi.fn();
    const outlineRefresh = vi.fn();
    const outline = owner.registerView("outline", {
      element: outlineElement,
      setVisible: outlineVisibility,
      update: outlineUpdate,
      refresh: outlineRefresh,
      destroy: vi.fn(),
    }, { containerEl: layout });

    expect(outlineVisibility.mock.calls).toEqual([[true]]);
    outline.hide();
    outline.show();
    outline.show();
    expect(outlineVisibility.mock.calls).toEqual([[true], [false], [true]]);
    expect(outlineUpdate).not.toHaveBeenCalled();
    expect(outlineRefresh).not.toHaveBeenCalled();

    const backlinksUpdate = vi.fn();
    const backlinksRefresh = vi.fn();
    const backlinks = owner.registerView("backlinks", {
      element: document.createElement("aside"),
      update: backlinksUpdate,
      refresh: backlinksRefresh,
      destroy: vi.fn(),
    }, { containerEl: layout });
    backlinks.hide();
    backlinks.show();
    expect(backlinksUpdate).toHaveBeenCalledOnce();
    expect(backlinksRefresh).toHaveBeenCalledOnce();

    owner.destroy();
  });

  it("keeps one host settings dialog and replaces the short-lived Vault menu", () => {
    const owner = new ElectronProductUiOwner(document);
    const createSettings = vi.fn(() => createSettingsPanel(defaultSettings(), vi.fn()));

    const firstSettings = owner.openDialog("settings", createSettings);
    const secondSettings = owner.openDialog("settings", createSettings);
    const onSettingsDisposed = vi.fn();
    firstSettings.setDisposeObserver(onSettingsDisposed);
    expect(secondSettings.element).toBe(firstSettings.element);
    expect(createSettings).toHaveBeenCalledOnce();
    expect(document.querySelectorAll(".nexus-settings-panel")).toHaveLength(1);
    const settingsPanel = createSettings.mock.results[0]?.value;
    settingsPanel?.setCloseObserver(firstSettings.dispose);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(firstSettings.disposed).toBe(true);
    expect(owner.has("settings")).toBe(false);
    expect(document.querySelector(".nexus-settings-panel")).toBeNull();

    const reopenedSettings = owner.openDialog("settings", createSettings);
    expect(reopenedSettings.element).not.toBe(firstSettings.element);
    expect(createSettings).toHaveBeenCalledTimes(2);

    const menuResources: Array<ProductUiResource & { destroy: ReturnType<typeof vi.fn> }> = [];
    const createMenu = () => {
      const element = document.createElement("div");
      element.className = "nexus-vault-ctxmenu";
      document.body.append(element);
      const resource = { element, destroy: vi.fn(() => element.remove()) };
      menuResources.push(resource);
      return resource;
    };
    const firstMenu = owner.replaceMenu("vault-context-menu", createMenu);
    const secondMenu = owner.replaceMenu("vault-context-menu", createMenu);
    expect(firstMenu.disposed).toBe(true);
    expect(menuResources[0]?.destroy).toHaveBeenCalledOnce();
    expect(secondMenu.disposed).toBe(false);
    expect(document.querySelectorAll(".nexus-vault-ctxmenu")).toHaveLength(1);

    owner.destroy();
    expect(firstSettings.disposed).toBe(true);
    expect(reopenedSettings.disposed).toBe(true);
    expect(onSettingsDisposed).toHaveBeenCalledOnce();
    expect(secondMenu.disposed).toBe(true);
    expect(menuResources[1]?.destroy).toHaveBeenCalledOnce();
    expect(document.querySelector(".nexus-settings-panel, .nexus-vault-ctxmenu")).toBeNull();
  });

  it("continues reverse cleanup after one product surface throws", () => {
    const owner = new ElectronProductUiOwner(document);
    const calls: string[] = [];
    const resource = (name: string, fail = false): ProductUiResource => {
      const element = document.createElement("div");
      return {
        element,
        destroy() {
          calls.push(name);
          element.remove();
          if (fail) throw new Error(`${name} failed`);
        },
      };
    };
    const layout = document.createElement("div");
    owner.registerView("outline", resource("outline", true), { containerEl: layout });
    owner.registerView("backlinks", resource("backlinks"), { containerEl: layout });
    owner.openDialog("settings", () => resource("settings"));

    expect(() => owner.destroy()).toThrow("Electron product UI cleanup was not clean");
    expect(calls).toEqual(["settings", "backlinks", "outline"]);
    expect(owner.size).toBe(0);
    expect(() => owner.destroy()).not.toThrow();
  });
});
