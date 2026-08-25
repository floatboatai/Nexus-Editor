import {
  NexusComponent,
  type ComponentId,
  type JsonObject,
  type ManagedResource,
  type Menu,
  type MenuContext,
  type MenuItemDefinition,
  type NexusView,
  type PluginId,
  type RegistrationResult,
  type ResourceOwner,
  type ServiceResult,
  type SettingTabDefinition,
  type ViewId,
  type ViewState,
  type WindowContext,
} from "@floatboat/nexus-plugin-api";
import {
  type RuntimeUiHost,
  type RuntimeWorkspace,
  type RuntimeWorkspaceLeaf,
  type RuntimeWorkspaceWindow,
} from "@floatboat/nexus-plugin-runtime";

import type { ProductViewResource, ProductViewSurface } from "./product-ui-owner";

export const ELECTRON_PRODUCT_UI_OWNER: ResourceOwner = Object.freeze({
  pluginId: "electron-host-ui" as PluginId,
  componentId: "electron-host-ui/product-surfaces" as ComponentId,
});

export const ELECTRON_PRODUCT_VIEW_TYPES = Object.freeze({
  outline: "electron-host-ui:outline",
  backlinks: "electron-host-ui:backlinks",
} satisfies Readonly<Record<ProductViewSurface, string>>);

export const ELECTRON_PRODUCT_SETTING_TAB_ID = "electron-host-ui:settings";

export interface RuntimeProductViewFactory {
  (): ProductViewResource;
}

export interface ElectronRuntimeProductUiAdapterOptions {
  readonly workspace: RuntimeWorkspace;
  readonly ui: RuntimeUiHost;
  readonly window: RuntimeWorkspaceWindow;
  readonly primaryLeaf: RuntimeWorkspaceLeaf;
  readonly layoutContainer: HTMLElement;
  readonly createOutline: RuntimeProductViewFactory;
  readonly createBacklinks: RuntimeProductViewFactory;
  readonly settingTab: SettingTabDefinition;
  readonly contributeFileMenu: (menu: Menu, context: MenuContext) => void;
}

export interface ElectronRuntimeProductUiSnapshot {
  readonly started: boolean;
  readonly destroyed: boolean;
  readonly owner: ResourceOwner;
  readonly primaryLeafId: string;
  readonly views: Readonly<Record<ProductViewSurface, {
    readonly viewType: string;
    readonly leafId: string | null;
    readonly visible: boolean;
  }>>;
  readonly managedResourceCount: number;
}

class ElectronProductWorkspaceView extends NexusComponent implements NexusView {
  readonly id: ViewId;
  readonly containerEl: HTMLElement;
  private persistentState: JsonObject = {};
  private ephemeralState: JsonObject = {};

  constructor(
    readonly leaf: RuntimeWorkspaceLeaf,
    readonly type: string,
    private readonly resource: ProductViewResource,
  ) {
    super();
    this.id = `electron-product-view:${leaf.id}` as ViewId;
    this.containerEl = resource.element;
    this.containerEl.tabIndex = -1;
  }

  get window(): WindowContext {
    return this.leaf.window;
  }

  override onload(): void {
    this.register(() => this.resource.destroy());
  }

  onOpen(): void {
    this.setVisible(true);
  }

  onClose(): void {
    this.setVisible(false);
  }

  getState(): JsonObject {
    return { ...this.persistentState };
  }

  setState(state: JsonObject): void {
    this.persistentState = { ...state };
  }

  getEphemeralState(): JsonObject {
    return { ...this.ephemeralState };
  }

  setEphemeralState(state: JsonObject): void {
    this.ephemeralState = { ...state };
  }

  refresh(): void {
    this.resource.update?.();
    this.resource.refresh?.();
  }

  setVisible(visible: boolean): void {
    if (this.resource.setVisible) this.resource.setVisible(visible);
    else if (visible) this.refresh();
  }
}

function requireRegistration(
  result: RegistrationResult,
  label: string,
): void {
  if (!result.ok) throw new Error(`${label}: ${result.diagnostic.message}`);
}

function isPluginActionContainer(element: HTMLElement): boolean {
  return element.matches("[data-plugin-slot], [data-ui-action-id]") ||
    element.closest("[data-plugin-slot], [data-ui-action-id]") !== null;
}

/**
 * Bridges Electron product chrome into the same owner-bound Workspace/UI
 * registries exposed to plugins, without treating product panels as UiSlots.
 */
export class ElectronRuntimeProductUiAdapter {
  private readonly resources: ManagedResource[] = [];
  private readonly leaves = new Map<ProductViewSurface, RuntimeWorkspaceLeaf>();
  private readonly workspaceService;
  private readonly uiService;
  private started = false;
  private destroyed = false;
  private startPromise: Promise<void> | null = null;
  private destroyPromise: Promise<void> | null = null;
  private activeMenu: Menu | null = null;
  private menuTail: Promise<void> = Promise.resolve();
  private settingsHost: HTMLElement | null = null;
  private removeSettingsListeners: (() => void) | null = null;

  constructor(private readonly options: ElectronRuntimeProductUiAdapterOptions) {
    const register = (resource: ManagedResource) => {
      if (this.destroyed) {
        void resource.dispose();
        throw new Error("Electron runtime product UI adapter is destroyed");
      }
      this.resources.push(resource);
    };
    this.workspaceService = options.workspace.createService(ELECTRON_PRODUCT_UI_OWNER, register);
    this.uiService = options.ui.createService(ELECTRON_PRODUCT_UI_OWNER, register);
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startNow();
    return this.startPromise;
  }

  getSnapshot(): ElectronRuntimeProductUiSnapshot {
    const view = (surface: ProductViewSurface) => {
      const leaf = this.leaves.get(surface) ?? null;
      return Object.freeze({
        viewType: ELECTRON_PRODUCT_VIEW_TYPES[surface],
        leafId: leaf?.id ?? null,
        visible: Boolean(leaf && !leaf.containerEl.hidden),
      });
    };
    return Object.freeze({
      started: this.started,
      destroyed: this.destroyed,
      owner: ELECTRON_PRODUCT_UI_OWNER,
      primaryLeafId: String(this.options.primaryLeaf.id),
      views: Object.freeze({ outline: view("outline"), backlinks: view("backlinks") }),
      managedResourceCount: this.resources.length,
    });
  }

  getViewLeaf(surface: ProductViewSurface): RuntimeWorkspaceLeaf | null {
    return this.leaves.get(surface) ?? null;
  }

  setViewVisible(surface: ProductViewSurface, visible: boolean): void {
    const leaf = this.requireLeaf(surface);
    leaf.containerEl.hidden = !visible;
    if (leaf.view instanceof ElectronProductWorkspaceView) leaf.view.setVisible(visible);
  }

  toggleView(surface: ProductViewSurface): void {
    const leaf = this.requireLeaf(surface);
    this.setViewVisible(surface, leaf.containerEl.hidden);
  }

  async displaySettings(container?: HTMLElement): Promise<ServiceResult<HTMLElement>> {
    this.assertStarted();
    if (container) {
      return this.options.ui.displaySettingTab(
        ELECTRON_PRODUCT_SETTING_TAB_ID,
        this.options.window,
        container,
      );
    }
    if (this.settingsHost?.isConnected) {
      this.settingsHost.focus();
      return { ok: true, value: this.settingsHost };
    }

    const document = this.options.window.ownerDocument;
    const host = document.createElement("div");
    host.className = "nexus-settings-panel nexus-runtime-settings-panel";
    host.dataset.nexusProductSurface = "settings";
    host.dataset.nexusProductKind = "dialog";
    host.dataset.nexusUiOwner = "electron-host-ui";
    host.tabIndex = -1;
    const dialog = document.createElement("section");
    dialog.className = "nexus-runtime-settings-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "nexus-runtime-settings-title");
    const header = document.createElement("header");
    const title = document.createElement("h2");
    title.id = "nexus-runtime-settings-title";
    title.textContent = "Settings";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "\u00d7";
    close.setAttribute("aria-label", "Close settings");
    header.append(title, close);
    const content = document.createElement("div");
    content.className = "nexus-runtime-settings-content";
    dialog.append(header, content);
    host.append(dialog);
    document.body.append(host);

    const closeSettings = () => void this.hideSettings();
    const onBackdrop = (event: MouseEvent) => {
      if (event.target === host) closeSettings();
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSettings();
      }
    };
    close.addEventListener("click", closeSettings);
    host.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKeydown, true);
    this.settingsHost = host;
    this.removeSettingsListeners = () => {
      close.removeEventListener("click", closeSettings);
      host.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKeydown, true);
    };

    const result = await this.options.ui.displaySettingTab(
      ELECTRON_PRODUCT_SETTING_TAB_ID,
      this.options.window,
      content,
    );
    if (!result.ok) {
      this.removeSettingsHost();
      return result;
    }
    close.focus();
    return { ok: true, value: host };
  }

  async hideSettings(): Promise<void> {
    await this.options.ui.hideSettingTab(ELECTRON_PRODUCT_SETTING_TAB_ID);
    this.removeSettingsHost();
  }

  createFileMenu(
    context: MenuContext,
    baseItems: readonly MenuItemDefinition[] = [],
  ): Menu {
    this.assertStarted();
    if (context.kind !== "file") {
      throw new TypeError("Electron runtime product file menu requires kind='file'");
    }
    const menu = this.uiService.menus.createMenu(context);
    for (const item of baseItems) menu.addItem(item);
    return menu;
  }

  async showFileMenu(
    context: MenuContext,
    position: { readonly x: number; readonly y: number },
    baseItems: readonly MenuItemDefinition[] = [],
  ): Promise<Menu> {
    this.assertStarted();
    const operation = this.menuTail.then(async () => {
      this.assertStarted();
      await this.activeMenu?.close();
      const menu = this.createFileMenu(context, baseItems);
      this.activeMenu = menu;
      await menu.showAt(position);
      return menu;
    });
    this.menuTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.destroyPromise = this.destroyNow();
    return this.destroyPromise;
  }

  private async startNow(): Promise<void> {
    if (this.destroyed) throw new Error("Electron runtime product UI adapter is destroyed");
    if (!this.options.workspace.getLeaves().includes(this.options.primaryLeaf)) {
      throw new Error("Primary Markdown leaf does not belong to the supplied RuntimeWorkspace");
    }
    if (this.options.primaryLeaf.window !== this.options.window) {
      throw new Error("Primary Markdown leaf belongs to another WindowContext");
    }
    if (isPluginActionContainer(this.options.layoutContainer)) {
      throw new Error("Electron product views cannot mount inside a plugin action slot");
    }

    try {
      requireRegistration(this.workspaceService.registerView(
        ELECTRON_PRODUCT_VIEW_TYPES.outline,
        (leaf) => new ElectronProductWorkspaceView(
          leaf as RuntimeWorkspaceLeaf,
          ELECTRON_PRODUCT_VIEW_TYPES.outline,
          this.options.createOutline(),
        ),
        { missingViewPolicy: "close", stateVersion: 1 },
      ), "Could not register the Outline product view");
      requireRegistration(this.workspaceService.registerView(
        ELECTRON_PRODUCT_VIEW_TYPES.backlinks,
        (leaf) => new ElectronProductWorkspaceView(
          leaf as RuntimeWorkspaceLeaf,
          ELECTRON_PRODUCT_VIEW_TYPES.backlinks,
          this.options.createBacklinks(),
        ),
        { missingViewPolicy: "close", stateVersion: 1 },
      ), "Could not register the Backlinks product view");
      requireRegistration(
        this.uiService.settings.registerSettingTab(this.options.settingTab),
        "Could not register the product SettingTab",
      );
      requireRegistration(this.uiService.menus.registerContribution(
        "file-menu",
        this.options.contributeFileMenu,
        { section: "electron-host", priority: 0 },
      ), "Could not register the product file-menu contribution");

      for (const resource of this.resources) await resource.activate?.();
      await this.mountView("outline");
      await this.mountView("backlinks");
      this.started = true;
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }

  private async mountView(surface: ProductViewSurface): Promise<void> {
    const leaf = this.options.workspace.createLeaf({
      id: `electron-product-${surface}-leaf`,
      windowId: this.options.window.id,
      containerType: "sidebar",
    });
    if (leaf === this.options.primaryLeaf) {
      throw new Error(`Product view '${surface}' attempted to reuse the primary Markdown leaf`);
    }
    this.leaves.set(surface, leaf);
    await leaf.setViewState({
      type: ELECTRON_PRODUCT_VIEW_TYPES[surface],
      stateVersion: 1,
      state: { surface },
    });
    leaf.containerEl.dataset.nexusProductSurface = surface;
    leaf.containerEl.dataset.nexusProductKind = "view";
    leaf.containerEl.dataset.nexusUiOwner = "electron-host-ui";
    leaf.containerEl.setAttribute("role", "complementary");
    leaf.containerEl.setAttribute("aria-label", surface === "outline" ? "Outline" : "Backlinks");
    this.options.layoutContainer.append(leaf.containerEl);
  }

  private requireLeaf(surface: ProductViewSurface): RuntimeWorkspaceLeaf {
    this.assertStarted();
    const leaf = this.leaves.get(surface);
    if (!leaf) throw new Error(`Product view '${surface}' is not mounted`);
    return leaf;
  }

  private assertStarted(): void {
    if (!this.started || this.destroyed) {
      throw new Error("Electron runtime product UI adapter is not active");
    }
  }

  private async destroyNow(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    await this.menuTail;
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    const errors: unknown[] = [];
    if (this.activeMenu) {
      try {
        await this.activeMenu.close();
      } catch (error) {
        errors.push(error);
      }
      this.activeMenu = null;
    }
    try {
      await this.hideSettings();
    } catch (error) {
      errors.push(error);
    }
    for (const leaf of [...this.leaves.values()].reverse()) {
      try {
        await this.options.workspace.closeLeaf(leaf);
      } catch (error) {
        errors.push(error);
      }
    }
    this.leaves.clear();
    for (const resource of [...this.resources].reverse()) {
      try {
        resource.quiesce?.();
        await resource.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.resources.length = 0;
    this.started = false;
    if (errors.length > 0) {
      throw new AggregateError(errors, "Electron runtime product UI cleanup was not clean");
    }
  }

  private removeSettingsHost(): void {
    this.removeSettingsListeners?.();
    this.removeSettingsListeners = null;
    this.settingsHost?.remove();
    this.settingsHost = null;
  }
}
