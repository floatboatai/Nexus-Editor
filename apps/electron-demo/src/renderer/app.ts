import type {
  MenuContext,
  SettingTabDefinition,
  SettingValue,
  UiSlot,
} from "@floatboat/nexus-plugin-api";
import {
  bundledReferencePlugins,
  createReferencePluginBootPlan,
  type ReferencePluginFeatureFlags,
} from "@floatboat/nexus-reference-plugins";
import { createState, type AppState } from "./state";
import { createEditorShell, type EditorShell } from "./editor-shell";
import {
  loadSettings,
  saveSettings,
  createSettingsPanel,
  type EditorSettings,
} from "./settings";
import { createOutlinePanel, type OutlinePanel } from "./outline-panel";
import { createSearchBar, type SearchBar } from "./search-bar";
import {
  createVaultPanel,
  type VaultFileMutationContext,
  type VaultPanel,
} from "./vault-panel";
import { createRuntimeVaultPanelBackend } from "./runtime-vault-panel-backend";
import {
  LinkIndex,
  parseAnchor,
  findAnchorPosition,
  type LinkIndexReader,
} from "./link-index";
import { createBacklinksPanel, type BacklinksPanel } from "./backlinks-panel";
import { perfStart, perfEnd, installLongTaskWatch } from "./perf";
import {
  createPluginRuntimeHost,
  type PluginRuntimeHost,
} from "./plugin-runtime-host";
import {
  ElectronRuntimeProductUiAdapter,
} from "./runtime-product-ui-adapter";
import type { CollaborationLab } from "./collaboration-lab";
import type { ElectronCollaborationProduct } from "./electron-collaboration-product";
import { createDocumentContextTransactions } from "./document-context-transaction";

installLongTaskWatch(50);

const state: AppState = createState();
let settings: EditorSettings = loadSettings();
let shell: EditorShell;
let outline: OutlinePanel;
let searchBar: SearchBar;
let vault: VaultPanel;
let backlinks: BacklinksPanel;
let rootElement: HTMLElement;
let statusText: HTMLElement;
let pluginOwnsDocumentStats = false;
let pluginRuntime: PluginRuntimeHost | null = null;
let runtimeProductUi: ElectronRuntimeProductUiAdapter | null = null;
let appDispatching = false;
let shutdownPromise: Promise<void> | null = null;
let removeAppVaultListener: (() => void) | null = null;
let removeLegacyShutdownListener: (() => void) | null = null;
let deferredRestoreTimeout: ReturnType<typeof setTimeout> | null = null;
const deferredRestoreFrames = new Set<number>();
const settingsPanels = new Set<{ destroy(): void }>();
let removeRuntimeSettingsListeners: (() => void) | null = null;
let collaborationLab: CollaborationLab | null = null;
let collaborationLabOpening: Promise<void> | null = null;
let collaborationProduct: ElectronCollaborationProduct | null = null;
let collaborationProductOpening: Promise<ElectronCollaborationProduct> | null = null;
let editorContainerElement: HTMLElement | null = null;

const documentContextTransactions = createDocumentContextTransactions(() => JSON.stringify([
  pluginRuntime?.session?.sessionId ?? null,
  state.vaultPath,
  state.activeFile,
]));

let linkIndex: LinkIndexReader | null = null;
let legacyLinkIndex: LinkIndex | null = null;

export interface ElectronDemoApp {
  readonly mode: "legacy" | "runtime";
  readonly state: AppState;
  readonly shell: EditorShell;
  readonly runtime: PluginRuntimeHost | null;
  readonly productUi: ElectronRuntimeProductUiAdapter | null;
  readonly slots: Readonly<Record<UiSlot, HTMLElement>>;
  readonly renderStatus: () => void;
  readonly openVault: (path: string) => Promise<void>;
  readonly openVaultFile: (path: string) => Promise<void>;
  readonly shutdown: () => Promise<void>;
}

export interface BootOptions {
  readonly root?: HTMLElement;
  readonly featureFlags?: Partial<ReferencePluginFeatureFlags>;
  readonly deferVaultRestore?: boolean;
}

export function resolveReferencePluginFeatureFlags(
  overrides: Partial<ReferencePluginFeatureFlags> = {},
): ReferencePluginFeatureFlags {
  const { pluginPlatform: _rendererOverride, ...rendererFeatures } = overrides;
  return Object.freeze({
    pluginPlatform: window.nexusHost?.mode === "runtime",
    toolbar: true,
    slashMenu: true,
    wordCount: true,
    ...rendererFeatures,
  });
}

function requireLegacyBridge(): DemoBridge {
  if (!window.nexusDemo) throw new Error("Legacy filesystem bridge is unavailable in runtime mode");
  return window.nexusDemo;
}

function requirePluginBridge() {
  if (!window.nexusPlugins) throw new Error("Plugin capability bridge is unavailable in legacy mode");
  return window.nexusPlugins;
}

function currentCollaborationFile() {
  if (!pluginRuntime || !pluginRuntime.session) return null;
  const path = toVaultRelativePath(state.vaultPath, state.activeFile);
  if (!path) return null;
  const name = path.split("/").pop() ?? path;
  return {
    path,
    title: name.replace(/\.md$/iu, ""),
    markdown: shell.editor.getDocument(),
    editor: shell.editor,
    setReadOnly(readOnly: boolean) {
      if (!editorContainerElement) return;
      if (readOnly) editorContainerElement.dataset.collaborationReadOnly = "true";
      else delete editorContainerElement.dataset.collaborationReadOnly;
      const content = editorContainerElement.querySelector<HTMLElement>(".cm-content");
      if (readOnly) content?.setAttribute("aria-readonly", "true");
      else content?.removeAttribute("aria-readonly");
    },
  };
}

async function openCollaborationLab(): Promise<void> {
  if (collaborationLab || collaborationLabOpening) return;
  collaborationLabOpening = import("./collaboration-lab").then(({ createCollaborationLab }) =>
    createCollaborationLab(document, () => {
      collaborationLab = null;
    })).then((lab) => {
    collaborationLab = lab;
    document.body.append(lab.element);
  }).finally(() => {
    collaborationLabOpening = null;
  });
  await collaborationLabOpening;
}

async function ensureCollaborationProduct(): Promise<ElectronCollaborationProduct> {
  if (!pluginRuntime || !pluginRuntime.session) {
    throw new Error("Open a runtime Vault before using collaboration");
  }
  if (!window.nexusCollabStore) {
    throw new Error("Durable Electron collaboration storage is unavailable");
  }
  if (!window.nexusCollabNetwork) {
    throw new Error("Trusted Electron collaboration networking is unavailable");
  }
  const sessionId = pluginRuntime.session.sessionId;
  if (collaborationProduct?.vaultSessionId === sessionId) return collaborationProduct;
  if (collaborationProductOpening) return collaborationProductOpening;

  collaborationProductOpening = (async () => {
    if (collaborationProduct) {
      await collaborationProduct.destroy();
      collaborationProduct = null;
    }
    const { createElectronCollaborationProduct } = await import("./electron-collaboration-product");
    const { createHostCollaborationInvitationIssuer } = await import("./collaboration-network-adapters");
    const networkBridge = window.nexusCollabNetwork;
    if (!networkBridge) throw new Error("Trusted Electron collaboration networking is unavailable");
    const networkConfiguration = await networkBridge.getConfiguration();
    if (!pluginRuntime?.session || pluginRuntime.session.sessionId !== sessionId || !window.nexusCollabStore) {
      throw new Error("The active Vault changed while collaboration was opening");
    }
    const product = createElectronCollaborationProduct({
      ownerDocument: document,
      pluginBridge: requirePluginBridge(),
      storeBridge: window.nexusCollabStore,
      network: {
        serverUrls: networkConfiguration.serverUrls,
        issueInvitation: createHostCollaborationInvitationIssuer(networkBridge),
      },
      vaultSessionId: sessionId,
      vaultId: pluginRuntime.session.vaultId,
      documentContext: documentContextTransactions,
      getCurrentFile: currentCollaborationFile,
      isCurrentFileDirty: () => state.dirty,
      confirmDiscardEditorContent: () => window.confirm(
        "The current Editor differs from the shared document. Leave and discard the Editor buffer? " +
        "The existing Markdown file and remote document will not be deleted.",
      ),
      confirmDiscardUnprojected: () => window.confirm(
        "File Projection is unresolved. Leave and discard only the unprojected collaboration state? " +
        "This does not delete the Markdown file or remote document.",
      ),
      onProjectionClean: (projected) => {
        if (pluginRuntime?.session?.sessionId !== sessionId) return;
        const current = currentCollaborationFile();
        if (
          !current
          || current.path !== projected.path
          || current.markdown !== projected.markdown
        ) return;
        state.dirty = false;
        renderStatus();
      },
      openDeveloperLab: openCollaborationLab,
    });
    try {
      await product.initialize();
    } catch (cause) {
      try {
        await product.destroy();
      } catch (cleanupFailure) {
        throw new AggregateError(
          [cause, cleanupFailure],
          "Collaboration initialization and cleanup both failed",
        );
      }
      throw cause;
    }
    collaborationProduct = product;
    return product;
  })().finally(() => {
    collaborationProductOpening = null;
  });
  return collaborationProductOpening;
}

async function openCollaborationProduct(): Promise<void> {
  const product = await ensureCollaborationProduct();
  await product.open();
}

interface DocumentContextChangeOptions {
  /** The current Editor buffer remains the source of the new context (Save As / rename). */
  readonly preservesEditorContent?: boolean;
  /** A Host rename moves the active projection instead of leaving its collaboration. */
  readonly preservesActiveCollaboration?: boolean;
}

async function prepareForDocumentChange(
  options: DocumentContextChangeOptions = {},
): Promise<boolean> {
  const collaborationPhase = collaborationProduct?.workspace.getState().phase;
  if (collaborationProduct && collaborationPhase && !["idle", "failed", "closed"].includes(collaborationPhase)) {
    if (options.preservesActiveCollaboration && collaborationPhase === "active") return true;
    const allowed = await collaborationProduct.prepareForFileChange();
    if (allowed) {
      state.dirty = false;
      renderStatus();
    }
    return allowed;
  }
  return options.preservesEditorContent ? true : confirmDiscardIfDirty();
}

function contextTargetsActiveFile(context: VaultFileMutationContext): boolean {
  if (!context.activeFile) return false;
  const active = context.activeFile.replace(/\\/gu, "/");
  const target = context.targetPath.replace(/\\/gu, "/").replace(/\/+$/u, "");
  const caseInsensitive = /^[a-z]:\//iu.test(active) || /^[a-z]:\//iu.test(target);
  const comparableActive = caseInsensitive ? active.toLocaleLowerCase() : active;
  const comparableTarget = caseInsensitive ? target.toLocaleLowerCase() : target;
  return comparableActive === comparableTarget || comparableActive.startsWith(`${comparableTarget}/`);
}

export function toVaultRelativePath(
  vaultRoot: string | null,
  filePath: string | null,
): string | null {
  if (!vaultRoot || !filePath) return null;
  const root = vaultRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const file = filePath.replace(/\\/g, "/");
  const caseInsensitive = /^[a-z]:\//i.test(root);
  const comparableRoot = caseInsensitive ? root.toLocaleLowerCase() : root;
  const comparableFile = caseInsensitive ? file.toLocaleLowerCase() : file;
  if (!comparableFile.startsWith(`${comparableRoot}/`)) return null;
  const relative = file.slice(root.length + 1);
  if (!relative || relative.split("/").some((part) => !part || part === "." || part === "..")) {
    return null;
  }
  return relative;
}

function toVaultAbsolutePath(vaultRoot: string | null, relativePath: string | null): string | null {
  if (!vaultRoot || !relativePath) return null;
  const relative = relativePath.replace(/\\/g, "/");
  if (
    relative.startsWith("/") ||
    /^[a-z]:\//i.test(relative) ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  ) return null;
  const separator = vaultRoot.includes("\\") && !vaultRoot.includes("/") ? "\\" : "/";
  return `${vaultRoot.replace(/[\\/]+$/, "")}${separator}${relative.replace(/\//g, separator)}`;
}

function toIndexPath(filePath: string | null): string | null {
  if (!filePath) return null;
  return pluginRuntime ? toVaultRelativePath(state.vaultPath, filePath) : filePath;
}

function fromIndexPath(filePath: string | null): string | null {
  if (!filePath) return null;
  return pluginRuntime ? toVaultAbsolutePath(state.vaultPath, filePath) : filePath;
}

function resolveWikilink(name: string): string | null {
  const resolved = linkIndex?.resolve(name, toIndexPath(state.activeFile)) ?? null;
  return fromIndexPath(resolved);
}

function createAppToolbar(): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const vaultBtn = document.createElement("button");
  vaultBtn.textContent = "Vault";
  vaultBtn.title = "Open a folder as a vault";
  vaultBtn.addEventListener("click", () => {
    void vault.promptPickVault();
  });

  const openBtn = document.createElement("button");
  openBtn.textContent = "Open";
  openBtn.addEventListener("click", handleOpen);

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", handleSave);

  const saveAsBtn = document.createElement("button");
  saveAsBtn.textContent = "Save As";
  saveAsBtn.addEventListener("click", handleSaveAs);

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  const vaultToggleBtn = document.createElement("button");
  vaultToggleBtn.textContent = "\uD83D\uDCD1"; // 📑
  vaultToggleBtn.title = "Toggle vault panel";
  vaultToggleBtn.style.fontSize = "14px";
  vaultToggleBtn.addEventListener("click", toggleVault);

  const outlineBtn = document.createElement("button");
  outlineBtn.textContent = "\u2630"; // ☰
  outlineBtn.title = "Toggle outline";
  outlineBtn.style.fontSize = "14px";
  outlineBtn.addEventListener("click", toggleOutline);

  const backlinksBtn = document.createElement("button");
  backlinksBtn.textContent = "\uD83D\uDD17"; // 🔗
  backlinksBtn.title = "Toggle backlinks panel";
  backlinksBtn.style.fontSize = "14px";
  backlinksBtn.addEventListener("click", toggleBacklinks);

  const searchBtn = document.createElement("button");
  searchBtn.textContent = "\uD83D\uDD0D"; // 🔍
  searchBtn.title = "Search (Ctrl+F)";
  searchBtn.style.fontSize = "14px";
  searchBtn.addEventListener("click", () => searchBar.open());

  const settingsBtn = document.createElement("button");
  settingsBtn.textContent = "\u2699"; // ⚙
  settingsBtn.title = "Settings";
  settingsBtn.style.fontSize = "16px";
  settingsBtn.addEventListener("click", handleSettings);

  const collaborationBtn = document.createElement("button");
  collaborationBtn.textContent = "Collaborate";
  collaborationBtn.title = "Create, join, or resume authenticated collaboration";
  collaborationBtn.addEventListener("click", () => {
    void openCollaborationProduct().catch((error) => {
      state.error = error instanceof Error ? error.message : String(error);
      renderStatus();
    });
  });

  toolbar.append(
    vaultBtn,
    openBtn,
    saveBtn,
    saveAsBtn,
    spacer,
    vaultToggleBtn,
    outlineBtn,
    backlinksBtn,
    searchBtn,
    collaborationBtn,
    settingsBtn
  );
  return toolbar;
}

function createPluginSlot(slot: UiSlot): HTMLElement {
  const element = document.createElement("div");
  element.className = `plugin-slot plugin-slot--${slot}`;
  element.dataset.pluginSlot = slot;
  if (slot === "command-palette") element.hidden = true;
  return element;
}

function createPluginSlots(): Readonly<Record<UiSlot, HTMLElement>> {
  return Object.freeze({
    "status-bar": createPluginSlot("status-bar"),
    ribbon: createPluginSlot("ribbon"),
    "editor-toolbar": createPluginSlot("editor-toolbar"),
    "view-toolbar": createPluginSlot("view-toolbar"),
    "command-palette": createPluginSlot("command-palette"),
  });
}

function createStatusLine(statusBarSlot: HTMLElement): HTMLElement {
  const status = document.createElement("div");
  status.className = "status-line";
  status.id = "status-line";
  statusText = document.createElement("span");
  statusText.className = "status-line__document";
  status.append(statusText, statusBarSlot);
  return status;
}

function renderStatus(): void {
  if (!statusText?.isConnected) return;

  const pathLabel = state.activeFile ?? state.filePath ?? "Untitled";
  const dirtyMark = state.dirty ? " [modified]" : "";
  // Runtime word-count owns document statistics through the status-bar slot.
  const stats = pluginOwnsDocumentStats ? null : shell?.editor.getDocumentStats();
  const statsText = stats ? ` | ${stats.words} words, ${stats.lines} lines` : "";
  const vaultLabel = state.vaultPath
    ? ` | Vault: ${state.vaultPath.split(/[\\/]/).pop()}`
    : "";
  const errorText = state.error ? ` — Error: ${state.error}` : "";
  statusText.textContent = `${pathLabel}${dirtyMark}${statsText}${vaultLabel}${errorText}`;
}

async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!state.dirty) return true;
  return window.confirm("You have unsaved changes. Discard them and switch files?");
}

async function handleOpen(): Promise<void> {
  if (!appDispatching) return;
  await documentContextTransactions.runContextChange(async () => {
    try {
      state.error = null;
      if (!(await prepareForDocumentChange())) return;
      const result = await requireLegacyBridge().openFile();
      if (!result) return;

      state.filePath = result.path;
      state.activeFile = result.path;
      shell.loadDocument(result.content);
      vault.setActiveFile(result.path);
      await syncRuntimeActiveFile(result.path);
      await collaborationProduct?.refreshFile();
      backlinks.refresh();
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
    renderStatus();
  });
}

async function handleSave(): Promise<void> {
  if (!appDispatching) return;
  if (!(state.activeFile ?? state.filePath)) {
    await handleSaveAs();
    return;
  }
  await documentContextTransactions.runContextChange(async () => {
    try {
      state.error = null;
      const targetPath = state.activeFile ?? state.filePath;
      if (!targetPath) return;
      const context = documentContextTransactions.capture();
      const markdown = shell.editor.getDocument();
      const collaborationPhase = collaborationProduct?.workspace.getState().phase;
      if (collaborationProduct && collaborationPhase && !["idle", "failed", "closed"].includes(collaborationPhase)) {
        await collaborationProduct.saveCurrent();
      } else if (toVaultRelativePath(state.vaultPath, targetPath) !== null) {
        await vault.writeFile(targetPath, markdown);
      } else {
        await requireLegacyBridge().saveFile(targetPath, markdown);
      }
      const currentContext = documentContextTransactions.capture();
      const currentPath = state.activeFile ?? state.filePath;
      if (
        currentContext.identity === context.identity
        && currentContext.generation === context.generation
        && currentPath === targetPath
        && shell.editor.getDocument() === markdown
      ) {
        state.dirty = false;
      }
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
    renderStatus();
  });
}

async function handleSaveAs(): Promise<void> {
  if (!appDispatching) return;
  await documentContextTransactions.runContextChange(async () => {
    try {
      state.error = null;
      if (!(await prepareForDocumentChange({ preservesEditorContent: true }))) return;
      const sourceEditor = shell.editor;
      const sourcePath = state.activeFile ?? state.filePath;
      const sourceMarkdown = sourceEditor.getDocument();
      const sourceContext = documentContextTransactions.capture();
      if (pluginRuntime) {
        if (!state.vaultPath) throw new Error("Open a Vault before saving a runtime document");
        const name = window.prompt("File name", "untitled.md")?.trim();
        if (!name) return;
        const created = await vault.createFile(state.vaultPath, name);
        await vault.writeFile(created.path, sourceMarkdown);
        await vault.refresh();
        const currentSourceContext = documentContextTransactions.capture();
        const sourceContextMatches =
          currentSourceContext.identity === sourceContext.identity
          && currentSourceContext.generation === sourceContext.generation
          && (state.activeFile ?? state.filePath) === sourcePath
          && shell.editor === sourceEditor;
        state.filePath = created.path;
        state.activeFile = created.path;
        vault.setActiveFile(created.path);
        const savedContext = documentContextTransactions.capture();
        await syncRuntimeActiveFile(created.path);
        await collaborationProduct?.refreshFile();
        const currentSavedContext = documentContextTransactions.capture();
        if (
          sourceContextMatches
          && currentSavedContext.identity === savedContext.identity
          && currentSavedContext.generation === savedContext.generation
          && (state.activeFile ?? state.filePath) === created.path
          && shell.editor === sourceEditor
          && sourceEditor.getDocument() === sourceMarkdown
        ) {
          state.dirty = false;
        }
        renderStatus();
        return;
      }
      const result = await requireLegacyBridge().saveFileAs(sourceMarkdown);
      if (!result) return;

      const currentSourceContext = documentContextTransactions.capture();
      const sourceContextMatches =
        currentSourceContext.identity === sourceContext.identity
        && currentSourceContext.generation === sourceContext.generation
        && (state.activeFile ?? state.filePath) === sourcePath
        && shell.editor === sourceEditor;
      state.filePath = result.path;
      state.activeFile = result.path;
      vault.setActiveFile(result.path);
      const savedContext = documentContextTransactions.capture();
      await syncRuntimeActiveFile(result.path);
      await collaborationProduct?.refreshFile();
      const currentSavedContext = documentContextTransactions.capture();
      if (
        sourceContextMatches
        && currentSavedContext.identity === savedContext.identity
        && currentSavedContext.generation === savedContext.generation
        && (state.activeFile ?? state.filePath) === result.path
        && shell.editor === sourceEditor
        && sourceEditor.getDocument() === sourceMarkdown
      ) {
        state.dirty = false;
      }
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
    renderStatus();
  });
}

function handleSettings(): void {
  if (!appDispatching) return;
  if (runtimeProductUi) {
    void runtimeProductUi.displaySettings().then((result) => {
      if (!result.ok) {
        state.error = result.diagnostic.message;
        renderStatus();
      }
    });
    return;
  }
  const panel = createSettingsPanel(settings, (next) => {
    settings = next;
    shell.applySettings(settings);
  });
  settingsPanels.add(panel);
}

function togglePanel(panel: HTMLElement, onShow?: () => void): void {
  if (panel.style.display === "none") {
    panel.style.display = "";
    onShow?.();
  } else {
    panel.style.display = "none";
  }
}

function toggleOutline(): void {
  if (!appDispatching) return;
  if (runtimeProductUi) {
    runtimeProductUi.toggleView("outline");
    return;
  }
  togglePanel(outline.element, () => outline.update());
}

function toggleVault(): void {
  if (!appDispatching) return;
  togglePanel(vault.element);
}

function toggleBacklinks(): void {
  if (!appDispatching) return;
  if (runtimeProductUi) {
    runtimeProductUi.toggleView("backlinks");
    return;
  }
  togglePanel(backlinks.element, () => backlinks.refresh());
}

function settingValue<T extends SettingValue>(
  values: Readonly<Record<string, SettingValue>>,
  key: keyof EditorSettings,
  fallback: T,
): T {
  const value = values[key];
  return (typeof value === typeof fallback ? value : fallback) as T;
}

function applyRuntimeEditorSettings(values: Readonly<Record<string, SettingValue>>): void {
  const next: EditorSettings = {
    colorScheme: settingValue(values, "colorScheme", settings.colorScheme) === "dark" ? "dark" : "light",
    fontSize: settingValue(values, "fontSize", settings.fontSize),
    fontFamily: settingValue(values, "fontFamily", settings.fontFamily),
    fontFamilyMono: settingValue(values, "fontFamilyMono", settings.fontFamilyMono),
    contentMaxWidth: settingValue(values, "contentMaxWidth", settings.contentMaxWidth),
    tabSize: settingValue(values, "tabSize", settings.tabSize),
    direction: settingValue(values, "direction", settings.direction) === "rtl" ? "rtl" : "ltr",
    indentGuides: settingValue(values, "indentGuides", settings.indentGuides),
    lineNumbers: settingValue(values, "lineNumbers", settings.lineNumbers),
    livePreview: settingValue(values, "livePreview", settings.livePreview),
  };
  settings = next;
  saveSettings(next);
  shell.applySettings(next);
}

function applyRuntimeEditorSetting(key: keyof EditorSettings, value: SettingValue): void {
  applyRuntimeEditorSettings({ ...settings, [key]: value });
}

function createProductSettingTab(): SettingTabDefinition {
  return {
    id: "settings",
    name: "Editor settings",
    settings: [
      {
        id: "colorScheme",
        type: "select",
        name: "Color scheme",
        description: "Light or dark theme",
        defaultValue: settings.colorScheme,
        options: [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }],
      },
      { id: "lineNumbers", type: "toggle", name: "Line numbers", defaultValue: settings.lineNumbers },
      { id: "livePreview", type: "toggle", name: "Live preview", defaultValue: settings.livePreview },
      { id: "indentGuides", type: "toggle", name: "Indent guides", defaultValue: settings.indentGuides },
      {
        id: "contentMaxWidth",
        type: "text",
        name: "Content max width",
        defaultValue: settings.contentMaxWidth,
        placeholder: "e.g. 720px",
      },
      {
        id: "direction",
        type: "select",
        name: "Text direction",
        defaultValue: settings.direction,
        options: [{ value: "ltr", label: "Left to right" }, { value: "rtl", label: "Right to left" }],
      },
      { id: "fontSize", type: "number", name: "Font size", defaultValue: settings.fontSize, min: 10, max: 28, step: 1 },
      { id: "fontFamily", type: "text", name: "Body font", defaultValue: settings.fontFamily },
      { id: "fontFamilyMono", type: "text", name: "Code font", defaultValue: settings.fontFamilyMono },
      { id: "tabSize", type: "number", name: "Tab size", defaultValue: settings.tabSize, min: 1, max: 8, step: 1 },
    ],
    display(context) {
      applyRuntimeEditorSettings(context.values);
      removeRuntimeSettingsListeners?.();
      const cleanups: Array<() => void> = [];
      for (const row of Array.from(context.containerEl.querySelectorAll<HTMLElement>("[data-setting-id]"))) {
        const control = row.querySelector("input, select") as HTMLInputElement | HTMLSelectElement | null;
        const key = row.dataset.settingId as keyof EditorSettings | undefined;
        if (!control || !key) continue;
        const update = () => {
          let value: SettingValue;
          if (control instanceof HTMLInputElement && control.type === "checkbox") {
            value = control.checked;
          } else if (key === "fontSize" || key === "tabSize") {
            value = Number(control.value);
          } else {
            value = control.value;
          }
          applyRuntimeEditorSetting(key, value);
        };
        control.addEventListener("change", update);
        cleanups.push(() => control.removeEventListener("change", update));
      }
      removeRuntimeSettingsListeners = () => {
        for (const cleanup of cleanups.splice(0).reverse()) cleanup();
        removeRuntimeSettingsListeners = null;
      };
    },
    hide() {
      removeRuntimeSettingsListeners?.();
    },
  };
}

async function syncRuntimeActiveFile(filePath: string | null): Promise<void> {
  if (!pluginRuntime) return;
  const relative = toVaultRelativePath(state.vaultPath, filePath);
  if (relative === null) {
    await pluginRuntime.setActiveFile(null);
    return;
  }
  if (!pluginRuntime.vault.getFileByPath(relative as never)) {
    await pluginRuntime.restoreSession();
  }
  await pluginRuntime.setActiveFile(relative);
}

async function handleVaultFileOpen(filePath: string): Promise<void> {
  if (!appDispatching) return;
  await documentContextTransactions.runContextChange(async () => {
    const total = perfStart("open-file", { filePath });
    try {
      state.error = null;
      if (filePath !== state.activeFile && !(await prepareForDocumentChange())) return;

      const ipc = perfStart("open-file.ipc-read");
      const result = await vault.readFile(filePath);
      perfEnd(ipc, { bytes: result.content.length });

      state.filePath = result.path;
      state.activeFile = result.path;

      const load = perfStart("open-file.loadDocument");
      shell.loadDocument(result.content);
      perfEnd(load);

      const setActive = perfStart("open-file.vault.setActiveFile");
      vault.setActiveFile(result.path);
      perfEnd(setActive);

      await syncRuntimeActiveFile(result.path);
      await collaborationProduct?.refreshFile();

      const bl = perfStart("open-file.backlinks.refresh");
      backlinks.refresh();
      perfEnd(bl);
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
    renderStatus();
    perfEnd(total);
  });
}

function dirname(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(0, slash) : "";
}

/** Coalesce repeated re-seeds (e.g. a burst of FS changes) into a single run. */
let seedToken = 0;
async function seedLinkIndex(): Promise<void> {
  if (!legacyLinkIndex) return;
  const myToken = ++seedToken;
  const total = perfStart("seed-link-index");
  try {
    const ipc = perfStart("seed-link-index.ipc-readAll");
    const files = await requireLegacyBridge().vault.readAll();
    const totalBytes = files.reduce((n, f) => n + f.content.length, 0);
    perfEnd(ipc, { files: files.length, bytes: totalBytes });

    if (myToken !== seedToken) {
      perfEnd(total, { superseded: true });
      return;
    }

    const rebuild = perfStart("seed-link-index.rebuildAsync");
    const committed = await legacyLinkIndex.rebuildAsync(files, {
      isCancelled: () => myToken !== seedToken,
    });
    perfEnd(rebuild, { files: files.length, committed });
    if (!committed) {
      perfEnd(total, { superseded: true });
      return;
    }
  } catch (err) {
    console.warn("seedLinkIndex failed:", err);
  }
  perfEnd(total);
}

async function handleWikilinkNavigate(target: string, opts: { unresolved: boolean }): Promise<void> {
  try {
    state.error = null;
    // Parse `#heading` / `^blockid` — bare part is what the resolver needs
    // to match a file on disk; the anchor (if any) is used AFTER the file is
    // loaded to scroll the editor to the matching heading / block.
    const { bare, anchor } = parseAnchor(target);
    if (!bare && !anchor) return;

    // `[[#heading]]` with no bare target means "jump inside the current file".
    if (!bare && anchor && state.activeFile) {
      const pos = findAnchorPosition(state.content, anchor);
      if (pos !== null) shell.editor.setSelection(pos);
      return;
    }
    if (!bare) return;

    if (!opts.unresolved) {
      const resolved = resolveWikilink(bare);
      if (resolved) {
        await handleVaultFileOpen(resolved);
        if (anchor) {
          const pos = findAnchorPosition(state.content, anchor);
          if (pos !== null) shell.editor.setSelection(pos);
        }
      }
      return;
    }
    if (!state.vaultPath) {
      state.error = "Open a vault before following wiki links.";
      renderStatus();
      return;
    }
    // Decide the create anchor:
    //   - Target contains `/` → vault-relative path (matches Obsidian semantics
    //     for explicit subpath links). Intermediate folders are auto-created.
    //   - Otherwise → next to the active file.
    const hasSubpath = bare.includes("/") || bare.includes("\\");
    const parent = hasSubpath
      ? state.vaultPath
      : state.activeFile
        ? dirname(state.activeFile)
        : state.vaultPath;
    const name = bare.toLowerCase().endsWith(".md") ? bare : `${bare}.md`;
    const created = await vault.createFile(parent, name);
    await vault.refresh();
    legacyLinkIndex?.updateFile(created.path, "");
    await handleVaultFileOpen(created.path);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    renderStatus();
  }
}

async function tryRestoreLastVault(): Promise<void> {
  if (!appDispatching) return;
  try {
    if (pluginRuntime) {
      await vault.openVault("");
    } else {
      const last = await requireLegacyBridge().vault.getLast();
      if (last.lastVault) await vault.openVault(last.lastVault);
    }
  } catch (err) {
    // swallow — missing vault is a normal case
    console.warn("Could not restore last vault:", err);
  }
}

async function enableRuntimePlugins(
  runtime: PluginRuntimeHost,
  plugins: ReturnType<typeof createReferencePluginBootPlan>["runtimePlugins"],
): Promise<void> {
  for (const Plugin of plugins) {
    const matches = bundledReferencePlugins.filter((entry) => entry.Plugin === Plugin);
    if (matches.length !== 1) {
      throw new Error(`Bundled plugin constructor has ${matches.length} matching manifests`);
    }
    const result = await runtime.enableBundledPlugin(matches[0].manifest, Plugin);
    if (!result.ok) {
      throw new AggregateError(
        result.diagnostics.map((diagnostic) => new Error(diagnostic.message)),
        `Could not enable bundled plugin '${matches[0].manifest.id}'`,
      );
    }
  }
}

function cancelDeferredVaultRestore(): void {
  if (deferredRestoreTimeout !== null) {
    clearTimeout(deferredRestoreTimeout);
    deferredRestoreTimeout = null;
  }
  for (const frame of deferredRestoreFrames) cancelAnimationFrame(frame);
  deferredRestoreFrames.clear();
}

function scheduleDeferredVaultRestore(): void {
  const firstFrame = requestAnimationFrame(() => {
    deferredRestoreFrames.delete(firstFrame);
    const secondFrame = requestAnimationFrame(() => {
      deferredRestoreFrames.delete(secondFrame);
      deferredRestoreTimeout = setTimeout(() => {
        deferredRestoreTimeout = null;
        void tryRestoreLastVault();
      }, 0);
    });
    deferredRestoreFrames.add(secondFrame);
  });
  deferredRestoreFrames.add(firstFrame);
}

async function destroyShellAndPanels(): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (operation: () => void | Promise<void>) => {
    try { await operation(); } catch (error) { errors.push(error); }
  };
  await attempt(async () => { await collaborationProductOpening; });
  collaborationProductOpening = null;
  await attempt(() => collaborationProduct?.destroy());
  collaborationProduct = null;
  await attempt(async () => { await collaborationLabOpening; });
  collaborationLabOpening = null;
  await attempt(() => collaborationLab?.destroy());
  collaborationLab = null;
  removeRuntimeSettingsListeners?.();
  removeRuntimeSettingsListeners = null;
  for (const panel of settingsPanels) await attempt(() => panel.destroy());
  settingsPanels.clear();
  if (runtimeProductUi) {
    await attempt(() => runtimeProductUi!.destroy());
    runtimeProductUi = null;
  } else {
    await attempt(() => backlinks.destroy());
    await attempt(() => outline.destroy());
  }
  await attempt(() => searchBar.destroy());
  await attempt(() => vault.destroy());
  await attempt(() => shell.destroy());
  editorContainerElement = null;
  await attempt(() => rootElement.replaceChildren());
  if (errors.length > 0) throw new AggregateError(errors, "Renderer UI cleanup was not clean");
}

async function performAppShutdown(): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (operation: () => void | Promise<void>) => {
    try { await operation(); } catch (error) { errors.push(error); }
  };
  appDispatching = false;
  seedToken += 1;
  cancelDeferredVaultRestore();
  document.removeEventListener("keydown", handleGlobalKeydown);
  await attempt(() => removeAppVaultListener?.());
  removeAppVaultListener = null;
  if (pluginRuntime) {
    await attempt(() => pluginRuntime!.shutdown({ destroyEditor: destroyShellAndPanels }));
  } else {
    await attempt(destroyShellAndPanels);
    await attempt(() => removeLegacyShutdownListener?.());
    removeLegacyShutdownListener = null;
    await attempt(() => window.nexusHost.shutdownComplete().then(() => undefined));
  }
  if (errors.length > 0) throw new AggregateError(errors, "Electron renderer shutdown was not clean");
}

function shutdown(): Promise<void> {
  if (!shutdownPromise) shutdownPromise = performAppShutdown();
  return shutdownPromise;
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (!appDispatching) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f") {
    event.preventDefault();
    searchBar.open();
  }
}

export async function boot(options: BootOptions = {}): Promise<ElectronDemoApp> {
  if (appDispatching || shutdownPromise) {
    throw new Error("The Electron renderer application can only be booted once per module instance");
  }
  const bootScope = perfStart("boot");
  const root = options.root ?? document.getElementById("app");
  if (!root) throw new Error("Missing #app element");
  rootElement = root;
  root.dataset.nexusStartupState = "starting";
  root.replaceChildren();
  appDispatching = true;
  let shellCreated = false;
  let vaultCreated = false;
  let outlineCreated = false;
  let searchBarCreated = false;
  let backlinksCreated = false;
  const cleanupBootUi = async () => {
    const errors: unknown[] = [];
    const attempt = async (operation: () => void | Promise<void>) => {
      try { await operation(); } catch (error) { errors.push(error); }
    };
    await attempt(async () => { await collaborationProductOpening; });
    collaborationProductOpening = null;
    await attempt(() => collaborationProduct?.destroy());
    collaborationProduct = null;
    removeRuntimeSettingsListeners?.();
    removeRuntimeSettingsListeners = null;
    for (const panel of settingsPanels) await attempt(() => panel.destroy());
    settingsPanels.clear();
    if (runtimeProductUi) {
      await attempt(() => runtimeProductUi!.destroy());
      runtimeProductUi = null;
    } else {
      if (backlinksCreated) await attempt(() => backlinks.destroy());
      if (outlineCreated) await attempt(() => outline.destroy());
    }
    if (searchBarCreated) await attempt(() => searchBar.destroy());
    if (vaultCreated) await attempt(() => vault.destroy());
    if (shellCreated) await attempt(() => shell.destroy());
    editorContainerElement = null;
    await attempt(() => root.replaceChildren());
    if (errors.length > 0) throw new AggregateError(errors, "Failed boot UI cleanup was not clean");
  };

  try {
  const bootPlan = createReferencePluginBootPlan(
    resolveReferencePluginFeatureFlags(options.featureFlags),
  );
  pluginOwnsDocumentStats = bootPlan.mode === "runtime" &&
    bootPlan.runtimePlugins.some((Plugin) =>
      bundledReferencePlugins.some((entry) =>
        entry.Plugin === Plugin && entry.manifest.id === "wordcount"));
  const slots = createPluginSlots();

  if (bootPlan.mode === "runtime") {
    pluginRuntime = createPluginRuntimeHost({
      bridge: requirePluginBridge(),
      document,
      slots,
      confirmDangerousAction: ({ title, message, window: targetWindow }) =>
        targetWindow.ownerWindow.confirm(`${title}\n\n${message}`),
      onShutdownRequested: () => shutdown(),
    });
    linkIndex = pluginRuntime.linkIndex;
    legacyLinkIndex = null;
    state.linkIndex = null;
  } else {
    legacyLinkIndex = new LinkIndex();
    linkIndex = legacyLinkIndex;
    state.linkIndex = legacyLinkIndex;
  }

  const appToolbar = createAppToolbar();
  const statusLine = createStatusLine(slots["status-bar"]);

  const mainArea = document.createElement("div");
  mainArea.className = "main-area";

  const editorColumn = document.createElement("div");
  editorColumn.className = "editor-column";

  const editorContainer = document.createElement("div");
  editorContainer.className = "editor-container";
  editorContainerElement = editorContainer;
  appToolbar.append(slots.ribbon, slots["view-toolbar"]);
  root.append(appToolbar, slots["command-palette"], mainArea, statusLine);

  shell = createEditorShell({
    container: editorContainer,
    state,
    settings,
    onStateChange: renderStatus,
    resolveWikilink,
    suggestWikilinks: (q) => {
      const names = linkIndex?.getAllNoteNames() ?? [];
      if (!q) return names.slice(0, 50);
      const qLower = q.toLowerCase();
      return names.filter((n) => n.toLowerCase().includes(qLower)).slice(0, 50);
    },
    onWikilinkNavigate: (target, opts) => {
      void handleWikilinkNavigate(target, opts);
    },
    contributionMode: bootPlan.mode,
    contributionFeatures: {
      toolbar: bootPlan.mode === "runtime"
        ? bootPlan.runtimePlugins.some((Plugin) =>
            bundledReferencePlugins.some((entry) => entry.Plugin === Plugin && entry.manifest.id === "toolbar"))
        : bootPlan.legacyUi.toolbar,
      slashMenu: bootPlan.mode === "runtime"
        ? bootPlan.runtimePlugins.some((Plugin) =>
            bundledReferencePlugins.some((entry) => entry.Plugin === Plugin && entry.manifest.id === "slash-menu"))
        : bootPlan.legacyUi.slashMenu,
      wordCount: bootPlan.mode === "runtime"
        ? bootPlan.runtimePlugins.some((Plugin) =>
            bundledReferencePlugins.some((entry) => entry.Plugin === Plugin && entry.manifest.id === "wordcount"))
        : bootPlan.legacyUi.wordCount,
    },
    editorContributions: bootPlan.mode === "runtime"
      ? bootPlan.editorContributions
      : [],
  });
  shellCreated = true;

  if (bootPlan.mode === "runtime") {
    slots["editor-toolbar"].classList.add("nexus-toolbar");
  }
  editorContainer.prepend(slots["editor-toolbar"]);

  const vaultBackend = pluginRuntime
    ? createRuntimeVaultPanelBackend({
        runtime: pluginRuntime,
      })
    : undefined;
  vault = createVaultPanel({
    withDocumentContextChange: (operation) => documentContextTransactions.runContextChange(operation),
    onOpenFile: (filePath) => {
      void handleVaultFileOpen(filePath);
    },
    onBeforeVaultOpen: async (nextPath) =>
      nextPath === state.vaultPath ? true : prepareForDocumentChange(),
    onBeforeFileMutation: async (context) => {
      const targetsActiveFile = contextTargetsActiveFile(context);
      const prepared = await prepareForDocumentChange({
        preservesEditorContent: context.kind === "rename" || !targetsActiveFile,
        preservesActiveCollaboration: context.kind === "rename" || !targetsActiveFile,
      });
      if (!prepared) return false;
      const relativePath = toVaultRelativePath(context.vaultPath, context.targetPath);
      if (relativePath && pluginRuntime?.session && window.nexusCollabStore) {
        const product = await ensureCollaborationProduct();
        const reservation = await product.prepareForFileMutation(context.kind, relativePath);
        if (reservation) return { deletionOperationId: reservation.operationId };
      }
      return true;
    },
    onVaultOpen: async (nextPath) => {
      state.vaultPath = nextPath;
      if (toVaultRelativePath(nextPath, state.activeFile) === null) {
        state.filePath = null;
        state.activeFile = null;
        shell.loadDocument("");
        vault.setActiveFile(null);
      }
      await syncRuntimeActiveFile(state.activeFile);
      if (pluginRuntime?.session && window.nexusCollabStore) {
        const product = await ensureCollaborationProduct();
        await product.refreshFile();
      }
      renderStatus();
      if (legacyLinkIndex) void seedLinkIndex();
    },
    onFileRenamed: async (oldPath, newPath, context) => {
      const oldRelative = toVaultRelativePath(context.vaultPath, oldPath);
      const newRelative = toVaultRelativePath(context.vaultPath, newPath);
      let hostError: unknown;
      const activePath = context.activeFile;
      if (
        state.vaultPath === context.vaultPath
        && state.activeFile === activePath
        && contextTargetsActiveFile(context)
      ) {
        const nextActive = `${newPath}${activePath!.slice(oldPath.length)}`;
        state.activeFile = nextActive;
        if (state.filePath === activePath) state.filePath = nextActive;
        vault.setActiveFile(nextActive);
        try {
          await syncRuntimeActiveFile(nextActive);
        } catch (error) {
          hostError = error;
        }
        backlinks.refresh();
        renderStatus();
      }
      let collaborationError: unknown;
      if (state.vaultPath === context.vaultPath && oldRelative && newRelative) {
        try {
          await collaborationProduct?.handlePathRenamed(oldRelative, newRelative);
        } catch (error) {
          collaborationError = error;
        }
      }
      if (hostError !== undefined && collaborationError !== undefined) {
        throw new AggregateError([hostError, collaborationError], "File rename coordination failed");
      }
      if (hostError !== undefined) throw hostError;
      if (collaborationError !== undefined) throw collaborationError;
    },
    onFileDeleted: async (deletedPath, context) => {
      const deletedRelative = toVaultRelativePath(context.vaultPath, deletedPath);
      let collaborationError: unknown;
      if (state.vaultPath === context.vaultPath && deletedRelative) {
        try {
          await collaborationProduct?.handleFileDeleted(deletedRelative);
        } catch (error) {
          collaborationError = error;
        }
      }
      const activePath = context.activeFile;
      if (
        state.vaultPath !== context.vaultPath
        || state.activeFile !== activePath
        || !contextTargetsActiveFile(context)
      ) {
        if (collaborationError !== undefined) throw collaborationError;
        return;
      }
      // Do not mutate a still-bound Editor after fail-closed leave itself failed.
      if (collaborationError !== undefined) throw collaborationError;
      state.activeFile = null;
      if (state.filePath === activePath) state.filePath = null;
      state.dirty = false;
      shell.loadDocument("");
      vault.setActiveFile(null);
      await syncRuntimeActiveFile(null);
      backlinks.refresh();
      renderStatus();
    },
    onFileMutationSettled: async (context, outcome) => {
      const relativePath = toVaultRelativePath(context.vaultPath, context.targetPath);
      if (relativePath) {
        await collaborationProduct?.completeFileMutation(context.kind, relativePath, outcome);
      }
      if (
        context.kind === "delete"
        && outcome.filesystem === "succeeded"
        && outcome.coordination === "succeeded"
      ) {
        await collaborationProduct?.refreshFile();
      }
    },
    onContextMenu: bootPlan.mode === "runtime" ? async ({ event, node, items }) => {
      if (!runtimeProductUi || !pluginRuntime) return;
      const relativePath = toVaultRelativePath(state.vaultPath, node.path);
      const file = node.kind === "file" && relativePath
        ? pluginRuntime.vault.getFileByPath(relativePath as never)
        : null;
      const context: MenuContext = {
        kind: "file",
        event,
        window: pluginRuntime.windowContext,
        leaf: pluginRuntime.leaf,
        view: pluginRuntime.leaf.view,
        editor: pluginRuntime.leaf.editorContext,
        file,
        command: null,
      };
      await runtimeProductUi.showFileMenu(
        context,
        { x: event.clientX, y: event.clientY },
        items,
      );
    } : undefined,
    onError: (message) => {
      state.error = message;
      renderStatus();
    },
    onStatus: (_message) => {
      renderStatus();
    },
  }, vaultBackend);
  vaultCreated = true;

  searchBar = createSearchBar(shell.editor);
  searchBarCreated = true;

  editorColumn.append(searchBar.element, editorContainer);
  mainArea.append(vault.element, editorColumn);

  if (bootPlan.mode === "runtime") {
    await pluginRuntime!.attachEditor(shell.editor, editorContainer);
    runtimeProductUi = new ElectronRuntimeProductUiAdapter({
      workspace: pluginRuntime!.workspace,
      ui: pluginRuntime!.ui,
      window: pluginRuntime!.windowContext,
      primaryLeaf: pluginRuntime!.leaf,
      layoutContainer: mainArea,
      createOutline: () => {
        outline = createOutlinePanel(shell.editor);
        outlineCreated = true;
        return outline;
      },
      createBacklinks: () => {
        backlinks = createBacklinksPanel({
          index: linkIndex!,
          onOpenFile: (filePath) => void handleVaultFileOpen(filePath),
          getActiveFile: () => state.activeFile,
          toIndexPath,
          fromIndexPath,
        });
        backlinksCreated = true;
        return backlinks;
      },
      settingTab: createProductSettingTab(),
      contributeFileMenu: () => undefined,
    });
    await runtimeProductUi.start();
    await enableRuntimePlugins(pluginRuntime!, bootPlan.runtimePlugins);
  } else {
    outline = createOutlinePanel(shell.editor);
    outlineCreated = true;
    backlinks = createBacklinksPanel({
      index: linkIndex!,
      onOpenFile: (filePath) => void handleVaultFileOpen(filePath),
      getActiveFile: () => state.activeFile,
      toIndexPath,
      fromIndexPath,
    });
    backlinksCreated = true;
    mainArea.append(outline.element, backlinks.element);
    removeLegacyShutdownListener = window.nexusHost.onShutdown(() => {
      void shutdown();
    });
  }

  if (legacyLinkIndex) {
    // The compatibility path keeps its existing absolute-path index.
    removeAppVaultListener = requireLegacyBridge().vault.onChanged(() => {
      if (!appDispatching) return;
      void seedLinkIndex();
    });
  }

  document.addEventListener("keydown", handleGlobalKeydown);

  renderStatus();
  perfEnd(bootScope);

  // Defer vault restore until after first paint so the window pops open with
  // a usable UI; the vault read + link-index seed then runs while the user
  // is still looking at the empty editor — invisible to them.
  if (options.deferVaultRestore !== false) scheduleDeferredVaultRestore();

  root.dataset.nexusStartupState = "ready";

  return Object.freeze({
    mode: bootPlan.mode,
    state,
    shell,
    runtime: pluginRuntime,
    productUi: runtimeProductUi,
    slots,
    renderStatus,
    openVault: (path: string) => vault.openVault(path),
    openVaultFile: handleVaultFileOpen,
    shutdown,
  });
  } catch (error) {
    const errors = [error];
    appDispatching = false;
    seedToken += 1;
    cancelDeferredVaultRestore();
    document.removeEventListener("keydown", handleGlobalKeydown);
    try { removeAppVaultListener?.(); } catch (cleanupError) { errors.push(cleanupError); }
    removeAppVaultListener = null;
    try { removeLegacyShutdownListener?.(); } catch (cleanupError) { errors.push(cleanupError); }
    removeLegacyShutdownListener = null;
    if (pluginRuntime) {
      try {
        await pluginRuntime.shutdown({ destroyEditor: cleanupBootUi, notifyHost: false });
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
    } else {
      try { await cleanupBootUi(); } catch (cleanupError) { errors.push(cleanupError); }
    }
    pluginRuntime = null;
    linkIndex = null;
    legacyLinkIndex = null;
    state.linkIndex = null;
    editorContainerElement = null;
    shutdownPromise = null;
    root.dataset.nexusStartupState = "failed";
    if (errors.length > 1) throw new AggregateError(errors, "Electron renderer boot failed and rollback was not clean");
    throw error;
  }
}
