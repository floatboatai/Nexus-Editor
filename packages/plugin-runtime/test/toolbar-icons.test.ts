import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ManagedResource,
  ResourceOwner,
  UiActionContext,
} from "@floatboat/nexus-plugin-api";
import {
  createWindowContext,
  RuntimeUiHost,
  type RuntimeUiHostOptions,
} from "../src/index";

const owner: ResourceOwner = {
  pluginId: "toolbar-test" as ResourceOwner["pluginId"],
  componentId: "toolbar-test/root" as ResourceOwner["componentId"],
};
const resources: ManagedResource[] = [];
afterEach(async () => {
  for (const resource of resources.splice(0).reverse())
    await resource.dispose();
  document.body.replaceChildren();
});

function setup(
  renderIcon: RuntimeUiHostOptions["renderIcon"],
  ownerDocument = document,
) {
  const window = createWindowContext("toolbar-window", ownerDocument);
  const toolbar = ownerDocument.createElement("div");
  const status = ownerDocument.createElement("div");
  const ribbon = ownerDocument.createElement("div");
  ownerDocument.body.append(toolbar, status, ribbon);
  const context: UiActionContext = {
    window,
    leaf: null,
    view: null,
    editor: null,
    file: null,
    command: null,
  };
  const diagnostics = vi.fn();
  const host = new RuntimeUiHost({
    defaultWindow: window,
    renderIcon,
    reportDiagnostic: diagnostics,
    slots: {
      "editor-toolbar": {
        window,
        containerEl: toolbar,
        actionContext: context,
      },
      "status-bar": { window, containerEl: status, actionContext: context },
      ribbon: { window, containerEl: ribbon, actionContext: context },
    },
  });
  const service = host.createService(owner, (resource) =>
    resources.push(resource),
  );
  return { service, toolbar, status, ribbon, context, diagnostics };
}

describe("runtime editor-toolbar icon presentation", () => {
  it("keeps the default text action when no icon renderer is configured", async () => {
    const { service, toolbar, context, diagnostics } = setup(undefined);
    const action = vi.fn();
    const result = service.registerAction("editor-toolbar", {
      id: "default",
      label: "Default action",
      icon: { id: "host:default" },
      action,
    });
    if (!result.ok) throw new Error(result.diagnostic.message);
    await resources[0].activate?.();

    const button = toolbar.querySelector("button");
    expect(button?.textContent).toBe("Default action");
    expect(button?.children).toHaveLength(0);
    button?.click();
    expect(action).toHaveBeenCalledWith(context);
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it("removes replaced artwork and releases the action DOM when disposed", async () => {
    const icons: HTMLElement[] = [];
    const { service, toolbar } = setup((_icon, ownerDocument) => {
      const icon = ownerDocument.createElement("span");
      icons.push(icon);
      return icon;
    });
    const action = vi.fn();
    const result = service.registerAction("editor-toolbar", {
      id: "replaceable",
      label: "Replaceable",
      icon: { id: "host:first" },
      action,
    });
    if (!result.ok) throw new Error(result.diagnostic.message);
    await resources[0].activate?.();
    const button = toolbar.querySelector("button");
    expect(icons[0].isConnected).toBe(true);

    result.registration.update({ icon: { id: "host:second" } });
    expect(icons).toHaveLength(2);
    expect(icons[0].parentNode).toBeNull();
    expect(icons[1].parentNode).toBe(button);
    expect(toolbar.querySelector("button")).toBe(button);

    await result.registration.dispose();
    await result.registration.dispose();
    expect(toolbar.children).toHaveLength(0);
    expect(icons[1].isConnected).toBe(false);
    button?.click();
    expect(action).not.toHaveBeenCalled();
  });

  it.each(["null", "error"] as const)("removes stale artwork when an update returns %s", async (failure) => {
    let unavailable = false;
    const icon = document.createElement("span");
    const { service, toolbar, context, diagnostics } = setup(() => {
      if (!unavailable) return icon;
      if (failure === "error") throw new Error("icon unavailable");
      return null;
    });
    const action = vi.fn();
    const result = service.registerAction("editor-toolbar", {
      id: "updated-fallback",
      label: "Original",
      icon: { id: "host:original" },
      action,
    });
    if (!result.ok) throw new Error(result.diagnostic.message);
    await resources[0].activate?.();
    expect(icon.isConnected).toBe(true);

    unavailable = true;
    result.registration.update({ label: "Updated" });
    const button = toolbar.querySelector("button");
    expect(icon.parentNode).toBeNull();
    expect(button?.textContent).toBe("Updated");
    expect(button?.getAttribute("aria-label")).toBe("Updated");
    button?.click();
    expect(action).toHaveBeenCalledWith(context);
    expect(diagnostics).toHaveBeenCalledTimes(failure === "error" ? 1 : 0);
    await result.registration.dispose();
    expect(toolbar.children).toHaveLength(0);
  });

  it("renders an icon while retaining accessible names, tooltips, action identity and disabled behavior", async () => {
    const renderIcon = vi.fn((_icon, ownerDocument: Document) => {
      const icon = ownerDocument.createElement("span");
      icon.textContent = "B";
      return icon;
    });
    const { service, toolbar, context } = setup(renderIcon);
    const action = vi.fn();
    let disabled = false;
    const result = service.registerAction("editor-toolbar", {
      id: "bold",
      label: "Bold",
      tooltip: "Bold (Mod+B)",
      icon: { id: "toolbar:bold" },
      disabled: () => disabled,
      action,
    });
    if (!result.ok) throw new Error(result.diagnostic.message);
    await resources[0].activate?.();
    const button = toolbar.querySelector<HTMLButtonElement>("button");
    if (!button) throw new Error("Missing toolbar action");
    expect(button.textContent).toBe("B");
    expect(button.getAttribute("aria-label")).toBe("Bold");
    expect(button.title).toBe("Bold (Mod+B)");
    expect(button.dataset.uiActionId).toBe("toolbar-test:bold");
    expect(button.dataset.uiSlot).toBe("editor-toolbar");
    expect(button.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    button.click();
    expect(action).toHaveBeenCalledWith(context);
    disabled = true;
    result.registration.update({});
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-disabled")).toBe("");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(action).toHaveBeenCalledOnce();
    disabled = false;
    result.registration.update({
      icon: undefined,
      label: "Strong",
      tooltip: "Strong text",
    });
    expect(button.textContent).toBe("Strong");
    expect(button.getAttribute("aria-label")).toBe("Strong");
    expect(button.title).toBe("Strong text");
    expect(button.disabled).toBe(false);
  });

  it("keeps unknown icons as text and does not hide status or ribbon labels", async () => {
    const renderIcon = vi.fn(() => null);
    const { service, toolbar, status, ribbon } = setup(renderIcon);
    for (const slot of ["editor-toolbar", "status-bar", "ribbon"] as const) {
      const result = service.registerAction(slot, {
        id: slot,
        label: `Label ${slot}`,
        icon: { id: "unknown" },
        action() {},
      });
      if (!result.ok) throw new Error(result.diagnostic.message);
    }
    for (const resource of resources) await resource.activate?.();
    expect(toolbar.textContent).toBe("Label editor-toolbar");
    expect(status.textContent).toBe("Label status-bar");
    expect(ribbon.textContent).toBe("Label ribbon");
    expect(renderIcon).toHaveBeenCalledOnce();
  });

  it("uses the destination document and makes SVG artwork non-focusable", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const targetDocument = frame.contentDocument;
    if (!targetDocument) throw new Error("Missing destination document");
    const renderIcon = vi.fn(() => {
      const icon = document.createElement("span");
      icon.innerHTML = '<svg viewBox="0 0 18 18"><path d="M1 9H17"/></svg>';
      return icon;
    });
    const { service, toolbar } = setup(renderIcon, targetDocument);
    const result = service.registerAction("editor-toolbar", {
      id: "divider",
      ariaLabel: "Divider",
      tooltip: "Divider",
      icon: { id: "toolbar:hr" },
      action() {},
    });
    if (!result.ok) throw new Error(result.diagnostic.message);
    await resources[0].activate?.();
    const button = toolbar.querySelector("button");
    expect(renderIcon).toHaveBeenCalledWith(
      { id: "toolbar:hr" },
      targetDocument,
    );
    expect(button?.firstElementChild?.ownerDocument).toBe(targetDocument);
    expect(button?.querySelector("svg")?.getAttribute("focusable")).toBe(
      "false",
    );
    expect(button?.getAttribute("aria-label")).toBe("Divider");
  });

  it("retains an operable text fallback when the host cannot render an icon", async () => {
    const { service, toolbar, diagnostics } = setup(() => {
      throw new Error("icon unavailable");
    });
    const action = vi.fn();
    const result = service.registerAction("editor-toolbar", {
      id: "fallback",
      label: "Fallback",
      icon: { id: "broken" },
      action,
    });
    if (!result.ok) throw new Error(result.diagnostic.message);
    await resources[0].activate?.();
    expect(toolbar.textContent).toBe("Fallback");
    toolbar.querySelector("button")?.click();
    expect(action).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ code: "callback-failed" }),
    );
  });
});
