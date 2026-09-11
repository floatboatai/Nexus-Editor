import {
  NexusComponent,
  type ComponentId,
  type EditorContext,
  type JsonObject,
  type JsonValue,
  type ManagedResource,
  type NexusFile,
  type NexusView,
  type PluginDataSnapshot,
  type PluginId,
  type PluginIdentity,
  type PluginStorageService,
  type Registration,
  type ResourceOwner,
  type SettingValue,
  type ViewId,
  type ViewState,
  type WindowContext,
  type WorkspaceLeaf,
} from "@floatboat/nexus-plugin-api";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../src/commands/command-registry";
import { ComponentLifecycleRuntime } from "../src/lifecycle/component-controller";
import {
  RuntimeUiHost,
  createWindowContext,
} from "../src/ui/runtime-ui";
import {
  RuntimeWorkspace,
  RuntimeWorkspaceLeaf,
  type RuntimeWorkspaceOptions,
  type RuntimeWorkspaceSnapshot,
} from "../src/index";

function owner(plugin = "sample-plugin"): ResourceOwner {
  return {
    pluginId: plugin as PluginId,
    componentId: `${plugin}/root` as ComponentId,
  };
}

function identity(plugin = "sample-plugin"): PluginIdentity {
  return {
    id: plugin as PluginId,
    name: plugin,
    version: "1.0.0",
    source: { kind: "development", locator: `fixture:${plugin}` },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function activate(resources: readonly ManagedResource[]): Promise<void> {
  for (const resource of resources) await resource.activate?.();
}

async function dispose(resources: readonly ManagedResource[]): Promise<void> {
  for (const resource of [...resources].reverse()) {
    resource.quiesce?.();
    await resource.dispose();
  }
}

function file(path: string): NexusFile {
  const name = path.split("/").at(-1)!;
  const dot = name.lastIndexOf(".");
  return {
    id: `file:${path}` as NexusFile["id"],
    kind: "file",
    path: path as NexusFile["path"],
    name,
    basename: dot < 0 ? name : name.slice(0, dot),
    extension: dot < 0 ? "" : name.slice(dot + 1),
    parent: null,
    valid: true,
    size: 0,
    createdAt: 0,
    modifiedAt: 0,
    version: "1" as NexusFile["version"],
  };
}

function editor(id: string): EditorContext {
  return { editorId: id } as unknown as EditorContext;
}

class TestView extends NexusComponent implements NexusView {
  readonly id: ViewId;
  readonly containerEl: HTMLElement;
  state: JsonObject = {};
  ephemeral: JsonObject = {};
  opened = 0;
  closed = 0;
  unloaded = 0;
  resourceDisposals = 0;
  windowChanges: Array<[WindowContext, WindowContext]> = [];
  windowEvents: string[] = [];
  windowEventRegistrations: Registration[] = [];

  constructor(
    readonly leaf: RuntimeWorkspaceLeaf,
    readonly type: string,
    sequence: number,
  ) {
    super();
    this.id = `view:${sequence}` as ViewId;
    this.containerEl = leaf.window.ownerDocument.createElement("article");
    this.containerEl.tabIndex = -1;
  }

  get window(): WindowContext { return this.leaf.window; }
  onload(): void {
    this.register(() => { this.resourceDisposals += 1; });
    this.bindWindowEvent(this.window);
  }
  getState(): JsonObject { return { ...this.state }; }
  setState(state: JsonObject): void { this.state = { ...state }; }
  getEphemeralState(): JsonObject { return { ...this.ephemeral }; }
  setEphemeralState(state: JsonObject): void { this.ephemeral = { ...state }; }
  onOpen(): void { this.opened += 1; }
  onClose(): void { this.closed += 1; }
  onunload(): void { this.unloaded += 1; }
  async onWindowContextChanged(previous: WindowContext, current: WindowContext): Promise<void> {
    this.windowChanges.push([previous, current]);
    await this.windowEventRegistrations.at(-1)?.dispose();
    this.bindWindowEvent(current);
  }

  private bindWindowEvent(context: WindowContext): void {
    this.windowEventRegistrations.push(this.registerDomEvent(
      context.ownerWindow,
      "nexus-test-window-context",
      () => this.windowEvents.push(context.id),
    ));
  }
}

function iframeWindow(id: string): { iframe: HTMLIFrameElement; context: WindowContext } {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const childDocument = iframe.contentDocument;
  if (!childDocument?.defaultView) throw new Error("jsdom iframe has no window");
  return { iframe, context: createWindowContext(id, childDocument) };
}

function mouseEvent(context: WindowContext, type: string): MouseEvent {
  const constructor = (context.ownerWindow as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  return new constructor(type, { bubbles: true });
}

function keyboardEvent(
  context: WindowContext,
  key: string,
  options: { readonly shiftKey?: boolean } = {},
): KeyboardEvent {
  const constructor = (context.ownerWindow as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
  return new constructor("keydown", { key, bubbles: true, ...options });
}

function windowEvent(context: WindowContext, type: string): Event {
  const constructor = (context.ownerWindow as unknown as { Event: typeof Event }).Event;
  return new constructor(type);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("RuntimeWorkspace", () => {
  it("routes file navigation through the configured Markdown view without changing placement or context", async () => {
    const resources: ManagedResource[] = [];
    const options: RuntimeWorkspaceOptions = {
      markdownViewType: "sample-plugin:markdown",
      supportedContainers: ["root", "tab"],
    };
    const workspace = new RuntimeWorkspace(document, options);
    const window = workspace.createWindow(document, "main");
    const focused = workspace.createLeaf({ windowId: window.id });
    workspace.focusLeaf(focused.id);
    const service = workspace.createService(owner(), (resource) => resources.push(resource));
    const factory = vi.fn((leaf: WorkspaceLeaf) =>
      new TestView(leaf as RuntimeWorkspaceLeaf, "sample-plugin:markdown", 1),
    );
    const registration = service.registerView("sample-plugin:markdown", factory);
    expect(registration.ok).toBe(true);
    await activate(resources);
    const target = file("notes/custom.md");
    const result = await service.navigate(
      { kind: "file", file: target },
      { placement: "new-tab", active: false, focus: false, ephemeralState: { cursor: 3 } },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("file navigation failed");
    expect(factory).toHaveBeenCalledWith(result.value.leaf, {
      type: "sample-plugin:markdown",
      stateVersion: 1,
      state: { path: target.path },
      ephemeralState: { cursor: 3 },
    });
    expect(result.value.placement).toBe("new-tab");
    expect(result.value.leaf.active).toBe(false);
    expect(service.getFocusedLeaf()).toBe(focused);
    expect((result.value.leaf as RuntimeWorkspaceLeaf).resourceFile).toBe(target);
    expect(result.value.leaf.view?.getEphemeralState()).toEqual({ cursor: 3 });
    expect(workspace.createSnapshot().schemaVersion).toBe(1);
    await dispose(resources);
  });

  it("keeps the default Markdown view type when no host override is provided", async () => {
    const workspace = new RuntimeWorkspace(document);
    const target = file("notes/default.md");
    const result = await workspace.navigate({ kind: "file", file: target });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("file navigation failed");
    expect(result.value.leaf.getViewState()).toMatchObject({
      type: "markdown",
      stateVersion: 1,
      state: { path: target.path },
    });
    await workspace.closeLeaf(result.value.leaf);
  });

  it("restores empty window identities from schema v1 without a document layout model", async () => {
    const original = new RuntimeWorkspace(document);
    original.createWindow(document, "empty");
    original.createWindow(document, "occupied");
    original.createLeaf({ windowId: "occupied" });
    const snapshot = original.createSnapshot();
    const restored = new RuntimeWorkspace(document);

    await restored.restoreSnapshot(snapshot);

    expect(restored.getLayout()).toEqual(snapshot.layout);
    expect(restored.createSnapshot()).toEqual(snapshot);
    expect(restored.createSnapshot().schemaVersion).toBe(1);
    expect(restored.createSnapshot()).not.toHaveProperty("documentLayouts");
  });

  it("rejects a foreign window object with a registered ID before changing the leaf", async () => {
    const workspace = new RuntimeWorkspace(document);
    const main = workspace.createWindow(document, "main");
    const target = workspace.createWindow(document, "target");
    const leaf = workspace.createLeaf({ windowId: main.id });
    const previousParent = leaf.containerEl.parentElement;
    const previousLayout = workspace.getLayout();

    await expect(workspace.moveLeafToWindow(leaf, { ...target })).rejects.toThrow(
      "Unknown runtime workspace window 'target'",
    );
    expect(leaf.window).toBe(main);
    expect(leaf.containerEl.parentElement).toBe(previousParent);
    expect(workspace.getLayout()).toEqual(previousLayout);

    await workspace.moveLeafToWindow(leaf, target);
    expect(leaf.window).toBe(target);
  });

  it("creates independent view instances and persists only durable view state", async () => {
    const resources: ManagedResource[] = [];
    const instances: TestView[] = [];
    let sequence = 0;
    let saved: RuntimeWorkspaceSnapshot | null = null;
    const workspace = new RuntimeWorkspace(document, {
      saveLayout: (snapshot) => { saved = snapshot; },
    });
    workspace.createWindow(document, "main");
    const service = workspace.createService(owner(), (resource) => resources.push(resource));
    const registration = service.registerView(
      "sample-plugin:board",
      (leaf) => {
        const view = new TestView(leaf as RuntimeWorkspaceLeaf, "sample-plugin:board", ++sequence);
        instances.push(view);
        return view;
      },
      { missingViewPolicy: "placeholder", stateVersion: 2 },
    );
    expect(registration.ok).toBe(true);
    await activate(resources);

    const first = await service.navigate(
      { kind: "view", state: { type: "sample-plugin:board", stateVersion: 2, state: { tab: "one" } } },
      { placement: "new-tab", active: false, focus: false, ephemeralState: { cursor: 1 } },
    );
    const second = await service.navigate(
      { kind: "view", state: { type: "sample-plugin:board", stateVersion: 2, state: { tab: "two" } } },
      { placement: "new-tab", active: false, focus: false, ephemeralState: { cursor: 2 } },
    );
    expect(first.ok && second.ok).toBe(true);
    expect(instances).toHaveLength(2);
    expect(instances[0]).not.toBe(instances[1]);
    expect(instances[0]!.owner?.componentId).toContain(`/view:${first.ok ? first.value.leaf.id : "missing"}`);
    expect(instances[1]!.owner?.componentId).toContain(`/view:${second.ok ? second.value.leaf.id : "missing"}`);
    expect(instances.map((view) => view.state)).toEqual([{ tab: "one" }, { tab: "two" }]);
    expect(instances.map((view) => view.ephemeral)).toEqual([{ cursor: 1 }, { cursor: 2 }]);

    await service.requestSaveLayout();
    expect(saved).not.toBeNull();
    expect(saved!.leaves.map((leaf) => leaf.viewState)).toEqual([
      { type: "sample-plugin:board", stateVersion: 2, state: { tab: "one" } },
      { type: "sample-plugin:board", stateVersion: 2, state: { tab: "two" } },
    ]);

    if (!first.ok || !second.ok) throw new Error("navigation failed");
    await service.closeLeaf(first.value.leaf);
    expect(instances[0]!.closed).toBe(1);
    expect(instances[0]!.unloaded).toBe(1);
    expect(instances[0]!.resourceDisposals).toBe(1);
    expect(instances[1]!.closed).toBe(0);
    expect(instances[1]!.resourceDisposals).toBe(0);
    expect(second.value.leaf.view).toBe(instances[1]);
  });

  it("restores placeholders, recovers them after factory activation and applies unload policy", async () => {
    const snapshot: RuntimeWorkspaceSnapshot = {
      schemaVersion: 1,
      layout: {
        id: "root", type: "root", stateVersion: 1, state: {}, leafIds: [], children: [],
      },
      leaves: [{
        id: "restored",
        windowId: "main",
        containerType: "tab",
        viewState: {
          type: "sample-plugin:board",
          stateVersion: 3,
          state: { restored: true },
          ephemeralState: { mustNotRestore: true },
        },
        fileId: null,
        filePath: null,
        editorId: null,
      }],
      focusedLeafId: "restored",
      activeLeafId: "restored",
      unknown: { futureField: "preserved" },
    };
    const resources: ManagedResource[] = [];
    const views: TestView[] = [];
    const workspace = new RuntimeWorkspace(document);
    await workspace.restoreSnapshot(snapshot);
    const leaf = workspace.getLeaves()[0]!;
    expect(leaf.view?.containerEl.className).toBe("nexus-missing-view");
    expect(leaf.getViewState()?.ephemeralState).toEqual({});

    const service = workspace.createService(owner(), (resource) => resources.push(resource));
    service.registerView(
      "sample-plugin:board",
      (target) => {
        const view = new TestView(target as RuntimeWorkspaceLeaf, "sample-plugin:board", views.length + 1);
        views.push(view);
        return view;
      },
      { missingViewPolicy: "placeholder" },
    );
    await activate(resources);
    expect(leaf.view).toBe(views[0]);
    expect(views[0]!.state).toEqual({ restored: true });
    expect(views[0]!.ephemeral).toEqual({});

    await dispose(resources);
    expect(views[0]!.closed).toBe(1);
    expect(leaf.view?.containerEl.className).toBe("nexus-missing-view");
    expect(workspace.createSnapshot().unknown).toEqual({ futureField: "preserved" });

    const closeResources: ManagedResource[] = [];
    const closeService = workspace.createService(owner("closer"), (resource) => closeResources.push(resource));
    closeService.registerView(
      "closer:temporary",
      (target) => new TestView(target as RuntimeWorkspaceLeaf, "closer:temporary", 10),
      { missingViewPolicy: "close" },
    );
    await activate(closeResources);
    const opened = await closeService.navigate(
      { kind: "view", state: { type: "closer:temporary", stateVersion: 1, state: {} } },
      { placement: "new-tab" },
    );
    expect(opened.ok).toBe(true);
    await dispose(closeResources);
    if (opened.ok) expect(workspace.getLeaves()).not.toContain(opened.value.leaf);
  });

  it("keeps focused leaf, active file and recent editor independent with typed events", async () => {
    const resources: ManagedResource[] = [];
    const workspace = new RuntimeWorkspace(document);
    workspace.createWindow(document, "main");
    const service = workspace.createService(owner(), (resource) => resources.push(resource));
    const events: string[] = [];
    service.events.on("focusedLeafChanged", ({ leaf }) => events.push(`focus:${leaf?.id ?? "none"}`));
    service.events.on("activeFileChanged", ({ file: active }) => events.push(`file:${active?.path ?? "none"}`));
    service.events.on("recentEditorChanged", ({ editor: recent }) => events.push(`editor:${recent?.editorId ?? "none"}`));
    await activate(resources);

    const mainFile = file("notes/main.md");
    const mainEditor = editor("editor-main");
    const main = workspace.createLeaf({ file: mainFile, editor: mainEditor });
    const sidebar = workspace.createLeaf({ containerType: "sidebar" });
    workspace.setActiveFile(mainFile);
    workspace.setRecentEditor(mainEditor);
    workspace.focusLeaf(main.id);
    workspace.focusLeaf(sidebar.id);

    expect(service.getFocusedLeaf()).toBe(sidebar);
    expect(service.getActiveView()).toBe(sidebar.view);
    expect(service.getActiveFile()).toBe(mainFile);
    expect(service.getRecentEditor()).toBe(mainEditor);
    expect(events).toEqual([
      "file:notes/main.md",
      "editor:editor-main",
      `focus:${main.id}`,
      `focus:${sidebar.id}`,
    ]);
  });

  it("honors explicit placement, fallback, background focus and target window migration", async () => {
    const resources: ManagedResource[] = [];
    const workspace = new RuntimeWorkspace(document, {
      supportedContainers: ["root", "tab", "window"],
    });
    const mainWindow = workspace.createWindow(document, "main");
    const service = workspace.createService(owner(), (resource) => resources.push(resource));
    const views: TestView[] = [];
    service.registerView("sample-plugin:board", (target) => {
      const view = new TestView(target as RuntimeWorkspaceLeaf, "sample-plugin:board", views.length + 1);
      views.push(view);
      return view;
    });
    await activate(resources);
    const first = workspace.createLeaf({ windowId: mainWindow.id });
    workspace.focusLeaf(first.id);

    const unsupported = await service.navigate(
      { kind: "view", state: { type: "sample-plugin:board", stateVersion: 1, state: {} } },
      { placement: "split" },
    );
    expect(unsupported).toMatchObject({ ok: false, diagnostic: { code: "platform-unsupported" } });
    const background = await service.navigate(
      { kind: "view", state: { type: "sample-plugin:board", stateVersion: 1, state: {} } },
      { placement: "split", fallback: "new-tab", active: false, focus: false },
    );
    expect(background).toMatchObject({ ok: true, value: { placement: "new-tab" } });
    expect(service.getFocusedLeaf()).toBe(first);
    if (!background.ok) throw new Error("fallback navigation failed");
    expect(background.value.leaf.active).toBe(false);
    const migratedView = views[0]!;
    mainWindow.ownerWindow.dispatchEvent(windowEvent(mainWindow, "nexus-test-window-context"));
    expect(migratedView.windowEvents).toEqual(["main"]);

    const second = iframeWindow("second");
    const secondWindow = workspace.createWindow(second.context.ownerDocument, "second");
    await workspace.moveLeafToWindow(background.value.leaf, secondWindow);
    expect(background.value.leaf.containerEl.ownerDocument).toBe(second.context.ownerDocument);
    expect(migratedView.windowChanges).toEqual([[mainWindow, secondWindow]]);
    expect(migratedView.windowEventRegistrations[0]?.disposed).toBe(true);
    mainWindow.ownerWindow.dispatchEvent(windowEvent(mainWindow, "nexus-test-window-context"));
    secondWindow.ownerWindow.dispatchEvent(windowEvent(secondWindow, "nexus-test-window-context"));
    expect(migratedView.windowEvents).toEqual(["main", "second"]);
  });
});

describe("RuntimeUiHost", () => {
  it("composes menu contributions in the source window and provides keyboard/focus semantics", async () => {
    const resources: ManagedResource[] = [];
    const second = iframeWindow("second");
    const source = second.context.ownerDocument.createElement("button");
    source.textContent = "source";
    second.context.ownerDocument.body.append(source);
    source.focus();
    const sourceLeaf = { id: "source-leaf" } as unknown as RuntimeWorkspaceLeaf;
    const calls: Array<{ id: string; leaf: unknown }> = [];
    const host = new RuntimeUiHost({ defaultWindow: createWindowContext("main", document) });
    const service = host.createService(owner(), (resource) => resources.push(resource));
    service.menus.registerContribution("editor-menu", (menu) => {
      menu.addItem({
        id: "low",
        label: "Low",
        action: (context) => void calls.push({ id: "low", leaf: context.leaf }),
      });
    }, { section: "edit", priority: 0 });
    service.menus.registerContribution("editor-menu", (menu) => {
      menu.addItem({
        id: "high",
        label: "High",
        action: (context) => void calls.push({ id: "high", leaf: context.leaf }),
      });
    }, { section: "edit", priority: 20 });
    service.menus.registerContribution("editor-menu", (menu) => {
      menu.addItem({
        id: "more",
        label: "More",
        submenu: [{ id: "nested", label: "Nested", action: vi.fn() }],
      });
    }, { section: "more", priority: 0 });
    await activate(resources);
    const menu = service.menus.createMenu({
      kind: "editor",
      event: mouseEvent(second.context, "contextmenu"),
      window: second.context,
      leaf: sourceLeaf,
      view: null,
      editor: null,
      file: null,
      command: null,
    });
    await menu.showAt({ x: 11, y: 13 });
    const menuEl = second.context.ownerDocument.querySelector<HTMLElement>(".nexus-plugin-menu");
    expect(menuEl).not.toBeNull();
    expect(document.querySelector(".nexus-plugin-menu")).toBeNull();
    expect(menuEl!.style.left).toBe("11px");
    expect(menuEl!.style.top).toBe("13px");
    expect(menu.context.event).toBeInstanceOf(
      (second.context.ownerWindow as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent,
    );
    expect(Array.from(menuEl!.querySelectorAll("button")).map((button) => button.textContent)).toEqual(["High", "Low", "More", "Nested"]);

    const more = Array.from(menuEl!.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "More")!;
    more.focus();
    second.context.ownerDocument.dispatchEvent(keyboardEvent(second.context, "ArrowRight"));
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(second.context.ownerDocument.activeElement?.textContent).toBe("Nested");
    second.context.ownerDocument.dispatchEvent(keyboardEvent(second.context, "ArrowLeft"));
    expect(second.context.ownerDocument.activeElement).toBe(more);

    menuEl!.querySelector<HTMLButtonElement>("button")!.focus();

    second.context.ownerDocument.dispatchEvent(keyboardEvent(second.context, "ArrowDown"));
    second.context.ownerDocument.dispatchEvent(keyboardEvent(second.context, "Enter"));
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([{ id: "low", leaf: sourceLeaf }]);
    expect(menu.closed).toBe(true);
    expect(second.context.ownerDocument.activeElement).toBe(source);
    await menu.close();
  });

  it("traps modal focus, rolls back failed opens and owner cleanup closes exactly once", async () => {
    const resources: ManagedResource[] = [];
    const second = iframeWindow("modal-window");
    const source = second.context.ownerDocument.createElement("button");
    source.textContent = "source";
    second.context.ownerDocument.body.append(source);
    source.focus();
    const close = vi.fn();
    const host = new RuntimeUiHost({ defaultWindow: second.context });
    const service = host.createService(owner(), (resource) => resources.push(resource));
    const opened = await service.modals.open({
      window: second.context,
      title: "Dialog",
      restoreFocus: source,
      onOpen: (modal) => {
        const first = second.context.ownerDocument.createElement("button");
        first.textContent = "first";
        const last = second.context.ownerDocument.createElement("button");
        last.textContent = "last";
        modal.contentEl.append(first, last);
      },
      onClose: close,
    });
    expect(opened.ok).toBe(true);
    expect(second.context.ownerDocument.activeElement?.textContent).toBe("first");
    second.context.ownerDocument.dispatchEvent(keyboardEvent(second.context, "Tab", { shiftKey: true }));
    expect(second.context.ownerDocument.activeElement?.textContent).toBe("last");

    await dispose(resources);
    expect(close).toHaveBeenCalledOnce();
    expect(second.context.ownerDocument.querySelector(".nexus-plugin-modal")).toBeNull();
    expect(second.context.ownerDocument.activeElement).toBe(source);

    const failed = await service.modals.open({
      window: second.context,
      onOpen: () => { throw new Error("cannot initialize"); },
    });
    expect(failed).toMatchObject({ ok: false, diagnostic: { code: "callback-failed" } });
    expect(second.context.ownerDocument.querySelector(".nexus-plugin-modal")).toBeNull();
  });

  it("deduplicates accessible notices and degrades to structured headless logs", async () => {
    const resources: ManagedResource[] = [];
    const context = createWindowContext("main", document);
    const host = new RuntimeUiHost({ defaultWindow: context });
    const service = host.createService(owner(), (resource) => resources.push(resource));
    const first = service.notices.show("Saving", { dedupeKey: "save", durationMs: 0 });
    const second = service.notices.show("Saved", { dedupeKey: "save", level: "success", durationMs: 0 });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("notice failed");
    expect(second.value).toBe(first.value);
    expect(document.querySelectorAll(".nexus-plugin-notice")).toHaveLength(1);
    expect(document.querySelector(".nexus-plugin-notice")?.textContent).toBe("Saved");
    expect(document.querySelector(".nexus-plugin-notice")?.getAttribute("aria-live")).toBe("polite");
    expect(resources).toHaveLength(1);
    await dispose(resources);

    const headlessResources: ManagedResource[] = [];
    const headless = new RuntimeUiHost();
    const headlessService = headless.createService(owner(), (resource) => headlessResources.push(resource));
    expect(headlessService.notices.show("Background complete", { level: "success" }).ok).toBe(true);
    expect(headless.headlessNoticeLog).toMatchObject([{ message: "Background complete", level: "success" }]);
    expect(headlessService.registerAction("status-bar", {
      id: "status", label: "Status", action: vi.fn(),
    })).toMatchObject({ ok: false, diagnostic: { code: "platform-unsupported" } });
  });

  it("removes temporary UI and slot contributions through the component owner ledger", async () => {
    const context = createWindowContext("main", document);
    const ribbon = document.createElement("div");
    document.body.append(ribbon);
    const host = new RuntimeUiHost({
      defaultWindow: context,
      slots: {
        ribbon: {
          window: context,
          containerEl: ribbon,
          actionContext: {
            window: context,
            leaf: null,
            view: null,
            editor: null,
            file: null,
            command: null,
          },
        },
      },
    });
    class UiOwner extends NexusComponent {
      override async onload(): Promise<void> {
        const service = host.createService(this.owner!, (resource) => {
          this.register(resource);
        });
        service.registerAction("ribbon", {
          id: "owned-action",
          label: "Owned action",
          action: vi.fn(),
        });
        const menu = service.menus.createMenu({
          kind: "custom",
          event: null,
          window: context,
          leaf: null,
          view: null,
          editor: null,
          file: null,
          command: null,
        });
        menu.addItem({ id: "owned-menu-item", label: "Owned", action: vi.fn() });
        await menu.showAt({ x: 0, y: 0 });
        await service.modals.open({ window: context, title: "Owned modal" });
        service.notices.show("Owned notice", { durationMs: 0 });
      }
    }
    const component = new UiOwner();
    const controller = new ComponentLifecycleRuntime().manage(component, identity());
    await controller.load();
    expect(ribbon.querySelector("button")).not.toBeNull();
    expect(document.querySelector(".nexus-plugin-menu")).not.toBeNull();
    expect(document.querySelector(".nexus-plugin-modal")).not.toBeNull();
    expect(document.querySelector(".nexus-plugin-notice")).not.toBeNull();

    const result = await controller.unload();
    expect(result.clean).toBe(true);
    expect(ribbon.querySelector("button")).toBeNull();
    expect(document.querySelector(".nexus-plugin-menu")).toBeNull();
    expect(document.querySelector(".nexus-plugin-modal")).toBeNull();
    expect(document.querySelector(".nexus-plugin-notice")).toBeNull();
  });

  it("updates a slot contribution in place and rejects updates after disposal", async () => {
    const resources: ManagedResource[] = [];
    const context = createWindowContext("main", document);
    const status = document.createElement("div");
    document.body.append(status);
    const host = new RuntimeUiHost({
      defaultWindow: context,
      slots: {
        "status-bar": {
          window: context,
          containerEl: status,
          actionContext: {
            window: context,
            leaf: null,
            view: null,
            editor: null,
            file: null,
            command: null,
          },
        },
      },
    });
    const service = host.createService(owner(), (resource) => resources.push(resource));
    const result = service.registerAction("status-bar", {
      id: "document-stats",
      label: "0 words",
      action: vi.fn(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("status registration failed");
    await activate(resources);
    const element = status.querySelector<HTMLButtonElement>("button")!;

    expect(result.registration.update({
      label: "7 words",
      ariaLabel: "Document statistics: 7 words",
      disabled: () => true,
    })).toEqual({ ok: true, value: undefined });
    expect(status.querySelector("button")).toBe(element);
    expect(element.textContent).toBe("7 words");
    expect(element.getAttribute("aria-label")).toBe("Document statistics: 7 words");
    expect(element.disabled).toBe(true);

    await result.registration.dispose();
    expect(status.children).toHaveLength(0);
    expect(result.registration.update({ label: "stale" })).toMatchObject({
      ok: false,
      diagnostic: { code: "registration-owner-quiescing" },
    });
  });

  it("re-evaluates slot predicates safely and preserves the node while reprioritizing", async () => {
    const diagnostics: Array<{ code: string; message: string }> = [];
    const resources: ManagedResource[] = [];
    const context = createWindowContext("main", document);
    const status = document.createElement("div");
    document.body.append(status);
    const host = new RuntimeUiHost({
      defaultWindow: context,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      slots: {
        "status-bar": {
          window: context,
          containerEl: status,
          actionContext: { window: context, leaf: null, view: null, editor: null, file: null, command: null },
        },
      },
    });
    const service = host.createService(owner(), (resource) => resources.push(resource));
    let visible = false;
    const dynamic = service.registerAction("status-bar", {
      id: "dynamic",
      label: "Dynamic",
      priority: 0,
      visible: () => visible,
      action: vi.fn(),
    });
    const fixed = service.registerAction("status-bar", {
      id: "fixed",
      label: "Fixed",
      priority: 10,
      action: vi.fn(),
    });
    expect(dynamic.ok && fixed.ok).toBe(true);
    if (!dynamic.ok || !fixed.ok) throw new Error("slot registration failed");
    await activate(resources);
    expect(status.textContent).toBe("Fixed");

    visible = true;
    expect(dynamic.registration.update({})).toEqual({ ok: true, value: undefined });
    const element = status.querySelector<HTMLButtonElement>("[data-ui-action-id='sample-plugin:dynamic']")!;
    element.focus();
    expect(dynamic.registration.update({ priority: 20 })).toEqual({ ok: true, value: undefined });
    expect(status.firstElementChild).toBe(element);
    expect(status.querySelector("[data-ui-action-id='sample-plugin:dynamic']")).toBe(element);
    expect(document.activeElement).toBe(element);

    expect(dynamic.registration.update({ visible: () => { throw new Error("visibility failed"); } })).toEqual({ ok: true, value: undefined });
    expect(status.querySelector("[data-ui-action-id='sample-plugin:dynamic']")).toBeNull();
    expect(diagnostics.at(-1)).toMatchObject({ code: "callback-failed" });
    expect(dynamic.registration.update({
      visible: () => true,
      disabled: () => { throw new Error("disabled failed"); },
    })).toEqual({ ok: true, value: undefined });
    const disabled = status.querySelector<HTMLButtonElement>("[data-ui-action-id='sample-plugin:dynamic']")!;
    expect(disabled.disabled).toBe(true);
    disabled.click();
    expect(diagnostics.at(-1)).toMatchObject({ code: "callback-failed" });
  });

  it("cancels a dangerous slot action when its definition changes or owner unloads during confirmation", async () => {
    const resources: ManagedResource[] = [];
    const context = createWindowContext("main", document);
    const ribbon = document.createElement("div");
    document.body.append(ribbon);
    const confirmations: Array<ReturnType<typeof deferred<boolean>>> = [];
    const host = new RuntimeUiHost({
      defaultWindow: context,
      confirmDangerousAction: () => {
        const confirmation = deferred<boolean>();
        confirmations.push(confirmation);
        return confirmation.promise;
      },
      slots: {
        ribbon: {
          window: context,
          containerEl: ribbon,
          actionContext: { window: context, leaf: null, view: null, editor: null, file: null, command: null },
        },
      },
    });
    const service = host.createService(owner(), (resource) => resources.push(resource));
    const originalAction = vi.fn();
    const replacementAction = vi.fn();
    const result = service.registerAction("ribbon", {
      id: "dangerous",
      label: "Dangerous",
      dangerous: true,
      action: originalAction,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("slot registration failed");
    await activate(resources);

    ribbon.querySelector<HTMLButtonElement>("button")!.click();
    expect(confirmations).toHaveLength(1);
    expect(result.registration.update({ action: replacementAction })).toEqual({ ok: true, value: undefined });
    confirmations[0]!.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(originalAction).not.toHaveBeenCalled();
    expect(replacementAction).not.toHaveBeenCalled();

    ribbon.querySelector<HTMLButtonElement>("button")!.click();
    expect(confirmations).toHaveLength(2);
    await result.registration.dispose();
    confirmations[1]!.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(replacementAction).not.toHaveBeenCalled();
  });

  it("cancels dangerous menu and setting actions when their owner closes during confirmation", async () => {
    const resources: ManagedResource[] = [];
    const diagnostics: Array<{ code: string; message: string }> = [];
    const context = createWindowContext("main", document);
    const confirmations: Array<ReturnType<typeof deferred<boolean>>> = [];
    const storage: PluginStorageService = {
      events: { on: vi.fn() as never },
      loadData: async <TData extends JsonValue = JsonValue>() => ({
        data: {} as TData,
        version: "0",
        schemaVersion: null,
      }) satisfies PluginDataSnapshot<TData>,
      saveData: vi.fn() as never,
      migrateData: vi.fn() as never,
    };
    const host = new RuntimeUiHost({
      defaultWindow: context,
      resolveStorage: () => storage,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      confirmDangerousAction: () => {
        const confirmation = deferred<boolean>();
        confirmations.push(confirmation);
        return confirmation.promise;
      },
    });
    const service = host.createService(owner(), (resource) => resources.push(resource));
    const menuAction = vi.fn();
    const menu = service.menus.createMenu({
      kind: "custom",
      event: null,
      window: context,
      leaf: null,
      view: null,
      editor: null,
      file: null,
      command: null,
    });
    menu.addItem({
      id: "dangerous-menu",
      label: "Dangerous menu",
      dangerous: true,
      action: menuAction,
    });
    await menu.showAt({ x: 0, y: 0 });
    document.querySelector<HTMLButtonElement>("[data-menu-item-id='dangerous-menu']")!.click();
    expect(confirmations).toHaveLength(1);
    await menu.dispose();
    confirmations[0]!.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(menuAction).not.toHaveBeenCalled();

    const settingAction = vi.fn();
    const registered = service.settings.registerSettingTab({
      id: "danger-zone",
      name: "Danger zone",
      settings: [{
        id: "erase",
        type: "action",
        name: "Erase data",
        defaultValue: null,
        actionLabel: "Erase",
        dangerous: true,
        action: settingAction,
      }],
    });
    expect(registered.ok).toBe(true);
    if (!registered.ok) throw new Error("setting registration failed");
    await activate(resources);
    const displayed = await host.displaySettingTab("sample-plugin:danger-zone");
    expect(displayed.ok).toBe(true);
    document.querySelector<HTMLButtonElement>("[data-setting-id='erase'] button")!.click();
    expect(confirmations).toHaveLength(2);
    await registered.registration.dispose();
    confirmations[1]!.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(settingAction).not.toHaveBeenCalled();

    const failingMenu = service.menus.createMenu({
      kind: "custom",
      event: null,
      window: context,
      leaf: null,
      view: null,
      editor: null,
      file: null,
      command: null,
    });
    failingMenu.addItem({
      id: "failing-confirmation",
      label: "Failing confirmation",
      dangerous: true,
      action: vi.fn(),
    });
    await failingMenu.showAt({ x: 0, y: 0 });
    document.querySelector<HTMLButtonElement>("[data-menu-item-id='failing-confirmation']")!.click();
    expect(confirmations).toHaveLength(3);
    confirmations[2]!.resolve(Promise.reject(new Error("confirmation failed")));
    await vi.waitFor(() => {
      expect(diagnostics.at(-1)).toMatchObject({
        code: "callback-failed",
        message: "Menu action 'failing-confirmation' confirmation failed",
      });
    });
    await failingMenu.dispose();
  });

  it("rejects missing slot action callbacks on registration and update", async () => {
    const resources: ManagedResource[] = [];
    const context = createWindowContext("main", document);
    const status = document.createElement("div");
    document.body.append(status);
    const host = new RuntimeUiHost({
      defaultWindow: context,
      slots: {
        "status-bar": {
          window: context,
          containerEl: status,
          actionContext: { window: context, leaf: null, view: null, editor: null, file: null, command: null },
        },
      },
    });
    const service = host.createService(owner(), (resource) => resources.push(resource));
    expect(service.registerAction("status-bar", {
      id: "invalid",
      label: "Invalid",
      action: undefined,
    } as never)).toMatchObject({ ok: false, diagnostic: { code: "command-invalid" } });

    const valid = service.registerAction("status-bar", {
      id: "valid",
      label: "Valid",
      action: vi.fn(),
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error("slot registration failed");
    await activate(resources);
    expect(valid.registration.update({ action: undefined } as never)).toMatchObject({
      ok: false,
      diagnostic: { code: "command-invalid" },
    });
    expect(status.querySelector("button")).not.toBeNull();
  });

  it("validates declarative settings, reloads storage and clears each display scope", async () => {
    const resources: ManagedResource[] = [];
    const context = createWindowContext("main", document);
    let stored: Record<string, SettingValue> = {};
    let version = 0;
    const save = vi.fn(async (data: unknown) => {
      stored = data as Record<string, SettingValue>;
      version += 1;
      return { ok: true as const, value: { version: String(version), schemaVersion: null } };
    });
    const storage: PluginStorageService = {
      events: { on: vi.fn() as never },
      loadData: async <TData extends JsonValue = JsonValue>() => ({
        data: stored as TData,
        version: String(version),
        schemaVersion: null,
      }) satisfies PluginDataSnapshot<TData>,
      saveData: save,
      migrateData: vi.fn() as never,
    };
    const hide = vi.fn();
    const display = vi.fn();
    let childDisposals = 0;
    class SettingChild extends NexusComponent {
      override onload(): void {
        this.register(() => { childDisposals += 1; });
      }
    }
    const host = new RuntimeUiHost({ defaultWindow: context, resolveStorage: () => storage });
    const service = host.createService(owner(), (resource) => resources.push(resource));
    const registered = service.settings.registerSettingTab({
      id: "preferences",
      name: "Preferences",
      settings: [{
        id: "count",
        type: "number",
        name: "Count",
        defaultValue: 1,
        validate: (value) => value < 1 ? "Must be positive" : null,
      }],
      display: async (contextValue) => {
        display();
        await contextValue.addChild(new SettingChild());
      },
      hide,
    });
    expect(registered.ok).toBe(true);
    await activate(resources);
    const first = await host.displaySettingTab("sample-plugin:preferences");
    expect(first.ok).toBe(true);
    expect(display).toHaveBeenCalledOnce();
    const invalid = await host.setSettingValue("sample-plugin:preferences", "count", 0);
    expect(invalid).toMatchObject({ ok: false });
    expect(save).not.toHaveBeenCalled();
    expect(document.querySelector("[data-setting-error]")?.textContent).toBe("Must be positive");
    expect((await host.setSettingValue("sample-plugin:preferences", "count", 4)).ok).toBe(true);
    expect(stored).toEqual({ settings: { count: 4 } });
    await host.hideSettingTab("sample-plugin:preferences");
    expect(hide).toHaveBeenCalledOnce();
    expect(childDisposals).toBe(1);
    expect(document.querySelector("[data-setting-id='count']")).toBeNull();
    const hostContainer = document.createElement("div");
    document.body.append(hostContainer);
    await host.displaySettingTab("sample-plugin:preferences", context, hostContainer);
    expect((document.querySelector("[data-setting-id='count'] input") as HTMLInputElement).value).toBe("4");
    await dispose(resources);
    expect(hide).toHaveBeenCalledTimes(2);
    expect(childDisposals).toBe(2);
    expect(hostContainer.isConnected).toBe(true);
    expect(hostContainer.childElementCount).toBe(0);
  });

  it("renders named slots, uses the unified command registry and preserves source editor context", async () => {
    const commandResources: ManagedResource[] = [];
    const sourceEditor = editor("source-editor");
    const otherEditor = editor("other-editor");
    let current = otherEditor;
    const executed: EditorContext[] = [];
    const commands = new CommandRegistry({
      resolveContext: (partial) => ({
        trigger: partial.trigger ?? "api",
        editor: partial.editor ?? current,
        ...(partial.sourceId ? { sourceId: partial.sourceId } : {}),
      }),
    });
    const commandService = commands.createService(owner(), (resource) => commandResources.push(resource));
    commandService.registerCommand({
      id: "inspect",
      name: "Inspect source",
      editorCallback: (target) => void executed.push(target),
    });
    await activate(commandResources);

    const context = createWindowContext("main", document);
    const palette = document.createElement("div");
    document.body.append(palette);
    const source = {
      window: context,
      leaf: { id: "leaf-a" } as never,
      view: null,
      editor: sourceEditor,
      file: null,
      command: null,
    };
    const uiResources: ManagedResource[] = [];
    const host = new RuntimeUiHost({
      defaultWindow: context,
      commandRegistry: commands,
      slots: { "command-palette": { window: context, containerEl: palette, actionContext: source } },
    });
    const service = host.createService(owner(), (resource) => uiResources.push(resource));
    expect(service.registerAction("command-palette", {
      id: "inspect-action",
      label: "Inspect source",
      commandId: "sample-plugin:inspect",
      action: vi.fn(),
    }).ok).toBe(true);
    await activate(uiResources);
    expect(palette.querySelector("button")?.getAttribute("aria-label")).toBe("Inspect source");
    const listed = await host.listPaletteCommands("inspect", source);
    expect(listed).toMatchObject([{ command: { id: "sample-plugin:inspect" }, availability: { status: "available" } }]);
    current = otherEditor;
    palette.querySelector<HTMLButtonElement>("button")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(executed).toEqual([sourceEditor]);
  });

  it("keeps a user-hidden ribbon action hidden while its command remains available", async () => {
    const commandResources: ManagedResource[] = [];
    const action = vi.fn();
    const commands = new CommandRegistry();
    const commandService = commands.createService(owner(), (resource) => commandResources.push(resource));
    expect(commandService.registerCommand({
      id: "inspect",
      name: "Inspect",
      callback: action,
    }).ok).toBe(true);
    await activate(commandResources);

    const context = createWindowContext("main", document);
    const ribbon = document.createElement("div");
    document.body.append(ribbon);
    const uiResources: ManagedResource[] = [];
    const host = new RuntimeUiHost({
      commandRegistry: commands,
      defaultWindow: context,
      slots: {
        ribbon: {
          window: context,
          containerEl: ribbon,
          actionContext: {
            window: context,
            leaf: null,
            view: null,
            editor: null,
            file: null,
            command: null,
          },
        },
      },
    });
    const service = host.createService(owner(), (resource) => uiResources.push(resource));
    const registered = service.registerAction("ribbon", {
      id: "inspect-ribbon",
      label: "Inspect",
      commandId: "sample-plugin:inspect",
      visible: () => true,
      action,
    });
    expect(registered.ok).toBe(true);
    if (!registered.ok) throw new Error("ribbon registration failed");
    await activate(uiResources);
    expect(ribbon.querySelector("button")).not.toBeNull();

    host.setActionHidden("ribbon", "sample-plugin:inspect-ribbon", true);
    expect(ribbon.querySelector("button")).toBeNull();
    expect(registered.registration.update({ label: "Plugin tried to restore", visible: () => true })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(ribbon.querySelector("button")).toBeNull();
    expect(commands.getCommand("sample-plugin:inspect")).toMatchObject({ name: "Inspect" });
    await expect(commands.executeCommand("sample-plugin:inspect")).resolves.toMatchObject({ ok: true });
    expect(action).toHaveBeenCalledOnce();

    host.setActionHidden("ribbon", "sample-plugin:inspect-ribbon", false);
    expect(ribbon.querySelector("button")?.textContent).toBe("Plugin tried to restore");
  });

  it("sanitizes HTML, denies unsafe URLs and rejects unnamed icon actions", async () => {
    const diagnostics: unknown[] = [];
    const context = createWindowContext("main", document);
    const ribbon = document.createElement("div");
    document.body.append(ribbon);
    const host = new RuntimeUiHost({
      defaultWindow: context,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      slots: {
        ribbon: {
          window: context,
          containerEl: ribbon,
          actionContext: { window: context, leaf: null, view: null, editor: null, file: null, command: null },
        },
      },
    });
    const resources: ManagedResource[] = [];
    const service = host.createService(owner(), (resource) => resources.push(resource));
    const sanitized = service.policy.sanitizeHtml("<img src=x onerror=alert(1)><script>alert(2)</script>");
    expect(sanitized.removed).toBe(true);
    expect(sanitized.html).not.toContain("onerror");
    expect(sanitized.html).not.toContain("script");
    expect(await service.policy.openExternalUrl("javascript:alert(1)", context)).toMatchObject({
      ok: false,
      diagnostic: { code: "ui-policy-denied" },
    });
    expect(service.registerAction("ribbon", {
      id: "unnamed",
      icon: { id: "bolt" },
      action: vi.fn(),
    })).toMatchObject({ ok: false, diagnostic: { code: "ui-action-inaccessible" } });
    expect(diagnostics).not.toEqual([]);
  });
});
