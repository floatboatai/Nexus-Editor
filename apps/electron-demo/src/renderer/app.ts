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
import { createVaultPanel, type VaultPanel } from "./vault-panel";
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
import {
  createI18n,
  normalizeLocale,
  slashCommandLabels,
  toolbarLabels,
  wordCountLabels,
  type MessageKey,
} from "./i18n";

installLongTaskWatch(50);

const state: AppState = createState();
let settings: EditorSettings = loadSettings();
const i18n = createI18n(settings.locale);
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
let removeAppLocaleListener: (() => void) | null = null;

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
  vaultBtn.addEventListener("click", () => {
    void vault.promptPickVault();
  });

  const openBtn = document.createElement("button");
  openBtn.addEventListener("click", handleOpen);

  const saveBtn = document.createElement("button");
  saveBtn.addEventListener("click", handleSave);

  const saveAsBtn = document.createElement("button");
  saveAsBtn.addEventListener("click", handleSaveAs);

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  const vaultToggleBtn = document.createElement("button");
  vaultToggleBtn.className = "toolbar__icon-button";
  vaultToggleBtn.textContent = "\uD83D\uDCD1"; // 📑
  vaultToggleBtn.addEventListener("click", toggleVault);

  const outlineBtn = document.createElement("button");
  outlineBtn.className = "toolbar__icon-button";
  outlineBtn.textContent = "\u2630"; // ☰
  outlineBtn.addEventListener("click", toggleOutline);

  const backlinksBtn = document.createElement("button");
  backlinksBtn.className = "toolbar__icon-button";
  backlinksBtn.textContent = "\uD83D\uDD17"; // 🔗
  backlinksBtn.addEventListener("click", toggleBacklinks);

  const searchBtn = document.createElement("button");
  searchBtn.className = "toolbar__icon-button";
  searchBtn.textContent = "\uD83D\uDD0D"; // 🔍
  searchBtn.addEventListener("click", () => searchBar.open());

  const settingsBtn = document.createElement("button");
  settingsBtn.className = "toolbar__icon-button";
  settingsBtn.textContent = "\u2699"; // ⚙
  settingsBtn.addEventListener("click", handleSettings);

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
    settingsBtn
  );
  const renderLabels = () => {
    vaultBtn.textContent = i18n.t("app.vault");
    vaultBtn.title = i18n.t("app.openVault");
    openBtn.textContent = i18n.t("app.open");
    saveBtn.textContent = i18n.t("app.save");
    saveAsBtn.textContent = i18n.t("app.saveAs");
    vaultToggleBtn.title = i18n.t("app.toggleVault");
    outlineBtn.title = i18n.t("app.toggleOutline");
    backlinksBtn.title = i18n.t("app.toggleBacklinks");
    searchBtn.title = i18n.t("app.search");
    settingsBtn.title = i18n.t("app.settings");
    for (const button of [vaultToggleBtn, outlineBtn, backlinksBtn, searchBtn, settingsBtn]) {
      button.setAttribute("aria-label", button.title);
    }
  };
  renderLabels();
  removeAppLocaleListener?.();
  removeAppLocaleListener = i18n.subscribe(renderLabels);
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

  const pathLabel = state.activeFile ?? state.filePath ?? i18n.t("status.untitled");
  const dirtyMark = state.dirty ? ` [${i18n.t("status.modified")}]` : "";
  // Runtime word-count owns document statistics through the status-bar slot.
  const stats = pluginOwnsDocumentStats ? null : shell?.editor.getDocumentStats();
  const statsText = stats
    ? ` | ${i18n.t("status.words", { count: stats.words })}, ${i18n.t("status.lines", { count: stats.lines })}`
    : "";
  const vaultLabel = state.vaultPath
    ? ` | ${i18n.t("status.vault", { name: state.vaultPath.split(/[\\/]/).pop() ?? "" })}`
    : "";
  const errorText = state.error ? ` — ${i18n.t("status.error", { message: state.error })}` : "";
  statusText.textContent = `${pathLabel}${dirtyMark}${statsText}${vaultLabel}${errorText}`;
}

async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!state.dirty) return true;
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "nexus-confirm-dialog";
    dialog.setAttribute("aria-labelledby", "nexus-confirm-title");
    dialog.setAttribute("aria-describedby", "nexus-confirm-message");

    const title = document.createElement("h2");
    title.id = "nexus-confirm-title";
    title.textContent = i18n.t("confirm.discardTitle");
    const message = document.createElement("p");
    message.id = "nexus-confirm-message";
    message.textContent = i18n.t("confirm.unsaved");
    const actions = document.createElement("div");
    actions.className = "nexus-confirm-dialog__actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = i18n.t("confirm.cancel");
    const discard = document.createElement("button");
    discard.type = "button";
    discard.dataset.action = "discard";
    discard.textContent = i18n.t("confirm.discard");
    actions.append(cancel, discard);
    dialog.append(title, message, actions);

    let settled = false;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      dialog.remove();
      resolve(confirmed);
    };
    cancel.addEventListener("click", () => finish(false));
    discard.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    document.body.append(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    cancel.focus();
  });
}

async function handleOpen(): Promise<void> {
  if (!appDispatching) return;
  try {
    state.error = null;
    if (!(await confirmDiscardIfDirty())) return;
    shell.editor.blur();
    const result = await requireLegacyBridge().openFile();
    if (!result) return;

    state.filePath = result.path;
    state.activeFile = result.path;
    shell.loadDocument(result.content);
    vault.setActiveFile(result.path);
    await syncRuntimeActiveFile(result.path);
    backlinks.refresh();
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    shell.editor.focus();
    renderStatus();
  }
}

async function handleSave(): Promise<void> {
  if (!appDispatching) return;
  try {
    state.error = null;
    const content = shell.editor.getDocument();
    const targetPath = state.activeFile ?? state.filePath;
    if (targetPath) {
      if (toVaultRelativePath(state.vaultPath, targetPath) !== null) {
        await vault.writeFile(targetPath, content);
      } else {
        await requireLegacyBridge().saveFile(targetPath, content);
      }
      state.savedContent = content;
      state.content = shell.editor.getDocument();
      state.dirty = state.content !== state.savedContent;
    } else {
      await handleSaveAs();
      return;
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
  renderStatus();
}

async function handleSaveAs(): Promise<void> {
  if (!appDispatching) return;
  try {
    state.error = null;
    const content = shell.editor.getDocument();
    if (pluginRuntime) {
      if (!state.vaultPath) throw new Error(i18n.t("error.openVaultBeforeSave"));
      const name = window.prompt(i18n.t("prompt.fileName"), "untitled.md")?.trim();
      if (!name) return;
      const created = await vault.createFile(state.vaultPath, name);
      await vault.writeFile(created.path, content);
      await vault.refresh();
      state.filePath = created.path;
      state.activeFile = created.path;
      state.savedContent = content;
      state.content = shell.editor.getDocument();
      state.dirty = state.content !== state.savedContent;
      vault.setActiveFile(created.path);
      await syncRuntimeActiveFile(created.path);
      renderStatus();
      return;
    }
    const result = await requireLegacyBridge().saveFileAs(content);
    if (!result) return;

    state.filePath = result.path;
    state.activeFile = result.path;
    state.savedContent = content;
    state.content = shell.editor.getDocument();
    state.dirty = state.content !== state.savedContent;
    vault.setActiveFile(result.path);
    await syncRuntimeActiveFile(result.path);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
  renderStatus();
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
    applyLocale();
  }, i18n);
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
    locale: normalizeLocale(settingValue(values, "locale", settings.locale)),
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
  applyLocale();
}

function applyRuntimeEditorSetting(key: keyof EditorSettings, value: SettingValue): void {
  applyRuntimeEditorSettings({ ...settings, [key]: value });
}

function createProductSettingTab(): SettingTabDefinition {
  return {
    id: "settings",
    name: i18n.t("settings.title"),
    settings: [
      {
        id: "locale",
        type: "select",
        name: i18n.t("settings.language"),
        description: i18n.t("settings.languageDescription"),
        defaultValue: settings.locale,
        options: [
          { value: "en", label: i18n.t("settings.english") },
          { value: "zh-CN", label: i18n.t("settings.chinese") },
        ],
      },
      {
        id: "colorScheme",
        type: "select",
        name: i18n.t("settings.colorScheme"),
        description: i18n.t("settings.colorSchemeDescription"),
        defaultValue: settings.colorScheme,
        options: [
          { value: "light", label: i18n.t("settings.light") },
          { value: "dark", label: i18n.t("settings.dark") },
        ],
      },
      { id: "lineNumbers", type: "toggle", name: i18n.t("settings.lineNumbers"), description: i18n.t("settings.lineNumbersDescription"), defaultValue: settings.lineNumbers },
      { id: "livePreview", type: "toggle", name: i18n.t("settings.livePreview"), description: i18n.t("settings.livePreviewDescription"), defaultValue: settings.livePreview },
      { id: "indentGuides", type: "toggle", name: i18n.t("settings.indentGuides"), description: i18n.t("settings.indentGuidesDescription"), defaultValue: settings.indentGuides },
      {
        id: "contentMaxWidth",
        type: "text",
        name: i18n.t("settings.contentMaxWidth"),
        description: i18n.t("settings.contentMaxWidthDescription"),
        defaultValue: settings.contentMaxWidth,
        placeholder: i18n.t("settings.contentMaxWidthPlaceholder"),
      },
      {
        id: "direction",
        type: "select",
        name: i18n.t("settings.textDirection"),
        description: i18n.t("settings.textDirectionDescription"),
        defaultValue: settings.direction,
        options: [
          { value: "ltr", label: i18n.t("settings.leftToRight") },
          { value: "rtl", label: i18n.t("settings.rightToLeft") },
        ],
      },
      { id: "fontSize", type: "number", name: i18n.t("settings.fontSize"), description: i18n.t("settings.fontSizeDescription"), defaultValue: settings.fontSize, min: 10, max: 28, step: 1 },
      { id: "fontFamily", type: "text", name: i18n.t("settings.bodyFont"), description: i18n.t("settings.bodyFontDescription"), defaultValue: settings.fontFamily },
      { id: "fontFamilyMono", type: "text", name: i18n.t("settings.codeFont"), description: i18n.t("settings.codeFontDescription"), defaultValue: settings.fontFamilyMono },
      { id: "tabSize", type: "number", name: i18n.t("settings.tabSize"), description: i18n.t("settings.tabSizeDescription"), defaultValue: settings.tabSize, min: 1, max: 8, step: 1 },
    ],
    display(context) {
      applyRuntimeEditorSettings(context.values);
      removeRuntimeSettingsListeners?.();
      const cleanups: Array<() => void> = [];
      localizeRuntimeSettings(context.containerEl);
      cleanups.push(i18n.subscribe(() => localizeRuntimeSettings(context.containerEl)));
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

const runtimeSettingCopy: Readonly<Record<keyof EditorSettings, {
  name: MessageKey;
  description?: MessageKey;
}>> = {
  locale: { name: "settings.language", description: "settings.languageDescription" },
  colorScheme: { name: "settings.colorScheme", description: "settings.colorSchemeDescription" },
  lineNumbers: { name: "settings.lineNumbers", description: "settings.lineNumbersDescription" },
  livePreview: { name: "settings.livePreview", description: "settings.livePreviewDescription" },
  indentGuides: { name: "settings.indentGuides", description: "settings.indentGuidesDescription" },
  contentMaxWidth: { name: "settings.contentMaxWidth", description: "settings.contentMaxWidthDescription" },
  direction: { name: "settings.textDirection", description: "settings.textDirectionDescription" },
  fontSize: { name: "settings.fontSize", description: "settings.fontSizeDescription" },
  fontFamily: { name: "settings.bodyFont", description: "settings.bodyFontDescription" },
  fontFamilyMono: { name: "settings.codeFont", description: "settings.codeFontDescription" },
  tabSize: { name: "settings.tabSize", description: "settings.tabSizeDescription" },
};

function localizeRuntimeSettings(container: HTMLElement): void {
  for (const row of Array.from(container.querySelectorAll<HTMLElement>("[data-setting-id]"))) {
    const key = row.dataset.settingId as keyof EditorSettings;
    const copy = runtimeSettingCopy[key];
    if (!copy) continue;
    const label = row.querySelector("label");
    if (label) label.textContent = i18n.t(copy.name);
    const description = Array.from(row.querySelectorAll<HTMLParagraphElement>("p"))
      .find((candidate) => !candidate.hasAttribute("data-setting-error"));
    if (description) {
      description.textContent = copy.description ? i18n.t(copy.description) : "";
      description.hidden = !copy.description;
    }
    const input = row.querySelector<HTMLInputElement>("input[type='text']");
    if (input && key === "contentMaxWidth") {
      input.placeholder = i18n.t("settings.contentMaxWidthPlaceholder");
    }
    const select = row.querySelector<HTMLSelectElement>("select");
    if (!select) continue;
    const optionLabels = key === "locale"
      ? [i18n.t("settings.english"), i18n.t("settings.chinese")]
      : key === "colorScheme"
        ? [i18n.t("settings.light"), i18n.t("settings.dark")]
        : key === "direction"
          ? [i18n.t("settings.leftToRight"), i18n.t("settings.rightToLeft")]
          : [];
    Array.from(select.options).forEach((option, index) => {
      if (optionLabels[index]) option.textContent = optionLabels[index];
    });
  }
}

function localizeRuntimePlugins(): void {
  const toolbar = pluginRuntime?.pluginManager.getEnabled("toolbar") as
    | { setLabels?(labels: Readonly<Record<string, string>>): void }
    | undefined;
  toolbar?.setLabels?.(toolbarLabels(i18n));

  const slash = pluginRuntime?.pluginManager.getEnabled("slash-menu") as
    | { setLabels?(labels: unknown): void }
    | undefined;
  slash?.setLabels?.({
    ariaLabel: i18n.t("slash.commands"),
    noMatches: i18n.t("slash.noMatches"),
    commands: slashCommandLabels(i18n),
  });

  const wordcount = pluginRuntime?.pluginManager.getEnabled("wordcount") as
    | { setLabels?(labels: unknown, locale?: string, summaryLabel?: string): void }
    | undefined;
  wordcount?.setLabels?.(
    wordCountLabels(i18n),
    i18n.locale,
    i18n.t("wordcount.documentStatistics"),
  );
}

function applyLocale(): void {
  i18n.setLocale(settings.locale);
  document.documentElement.lang = i18n.locale;
  document.title = i18n.t("app.title");
  localizeRuntimePlugins();
  renderStatus();
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
  const total = perfStart("open-file", { filePath });
  try {
    state.error = null;
    if (!(await confirmDiscardIfDirty())) return;
    shell.editor.blur();

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

    const bl = perfStart("open-file.backlinks.refresh");
    backlinks.refresh();
    perfEnd(bl);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    shell.editor.focus();
    renderStatus();
    perfEnd(total);
  }
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
      state.error = i18n.t("error.openVaultBeforeLink");
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
  removeRuntimeSettingsListeners?.();
  removeRuntimeSettingsListeners = null;
  removeAppLocaleListener?.();
  removeAppLocaleListener = null;
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
  const primaryModifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLocaleLowerCase();
  if (primaryModifier && !event.altKey && !event.shiftKey && key === "s") {
    event.preventDefault();
    void handleSave();
    return;
  }
  if (primaryModifier && key === "f") {
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
    removeRuntimeSettingsListeners?.();
    removeRuntimeSettingsListeners = null;
    removeAppLocaleListener?.();
    removeAppLocaleListener = null;
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
    await attempt(() => root.replaceChildren());
    if (errors.length > 0) throw new AggregateError(errors, "Failed boot UI cleanup was not clean");
  };

  try {
  applyLocale();
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
    i18n,
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
    onOpenFile: (filePath) => {
      void handleVaultFileOpen(filePath);
    },
    onBeforeVaultOpen: (nextPath) =>
      nextPath === state.vaultPath ? true : confirmDiscardIfDirty(),
    onVaultOpen: async (nextPath) => {
      state.vaultPath = nextPath;
      if (toVaultRelativePath(nextPath, state.activeFile) === null) {
        state.filePath = null;
        state.activeFile = null;
        shell.loadDocument("");
        vault.setActiveFile(null);
      }
      await syncRuntimeActiveFile(state.activeFile);
      renderStatus();
      if (legacyLinkIndex) void seedLinkIndex();
    },
    onFileRenamed: async (oldPath, newPath) => {
      const activePath = state.activeFile;
      if (activePath && (activePath === oldPath || activePath.startsWith(`${oldPath.replace(/[\\/]+$/, "")}/`))) {
        const nextActive = `${newPath}${activePath.slice(oldPath.length)}`;
        state.activeFile = nextActive;
        if (state.filePath === activePath) state.filePath = nextActive;
        vault.setActiveFile(nextActive);
        await syncRuntimeActiveFile(nextActive);
        backlinks.refresh();
        renderStatus();
      }
    },
    onFileDeleted: async (deletedPath) => {
      const activePath = state.activeFile;
      if (!activePath || (activePath !== deletedPath && !activePath.startsWith(`${deletedPath.replace(/[\\/]+$/, "")}/`))) return;
      state.activeFile = null;
      if (state.filePath === activePath) state.filePath = null;
      shell.loadDocument("");
      vault.setActiveFile(null);
      await syncRuntimeActiveFile(null);
      backlinks.refresh();
      renderStatus();
    },
    onRevealInFileExplorer: async (itemPath) => {
      if (!pluginRuntime) {
        await window.nexusHost.showItemInFolder(itemPath);
        return;
      }
      const session = pluginRuntime.session;
      const relativePath = toVaultRelativePath(state.vaultPath, itemPath);
      if (!session || !relativePath) throw new Error("No active Vault item to reveal");
      await window.nexusHost.showItemInFolder(relativePath, session.sessionId);
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
  }, vaultBackend, i18n);
  vaultCreated = true;

  searchBar = createSearchBar(shell.editor, i18n);
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
        outline = createOutlinePanel(shell.editor, i18n);
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
          i18n,
        });
        backlinksCreated = true;
        return backlinks;
      },
      settingTab: createProductSettingTab(),
      contributeFileMenu: () => undefined,
      i18n,
    });
    await runtimeProductUi.start();
    await enableRuntimePlugins(pluginRuntime!, bootPlan.runtimePlugins);
    localizeRuntimePlugins();
  } else {
    outline = createOutlinePanel(shell.editor, i18n);
    outlineCreated = true;
    backlinks = createBacklinksPanel({
      index: linkIndex!,
      onOpenFile: (filePath) => void handleVaultFileOpen(filePath),
      getActiveFile: () => state.activeFile,
      toIndexPath,
      fromIndexPath,
      i18n,
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
    shutdownPromise = null;
    if (errors.length > 1) throw new AggregateError(errors, "Electron renderer boot failed and rollback was not clean");
    throw error;
  }
}
