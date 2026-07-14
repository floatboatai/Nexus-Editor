import type { EditorAPI, NexusPlugin } from "@floatboat/nexus-core";
import { basename } from "./path-utils";

/**
 * Plugins panel - the *policy* half of runtime plugin management (see
 * openspec/changes/add-runtime-plugin-management, design D5). Core only
 * provides the mechanism (addPlugin / removePlugin / getPlugins /
 * pluginsChange); this panel decides what can be installed and renders the
 * install state. The marketplace below is deliberately host-owned: only
 * bundled entries can execute. Local folders are previewed as a future
 * developer-mode flow, not loaded as arbitrary code.
 */
export interface PluginsPanel {
  element: HTMLElement;
  destroy(): void;
}

type MarketplaceTab = "featured" | "installed" | "local";
type CatalogStatus = "available" | "preview" | "planned" | "static-only";
type LocalFolderStatus = "idle" | "picking" | "selected" | "error";

interface CatalogEntry {
  /** Must match the installed plugin's `name` (what getPlugins reports) when loadable. */
  id: string;
  label: string;
  eyebrow: string;
  description: string;
  status: CatalogStatus;
  accent: string;
  tags: string[];
  note: string;
  load?: () => Promise<NexusPlugin>;
}

const CATALOG: CatalogEntry[] = [
  {
    id: "plugin-typewriter",
    label: "Typewriter Mode",
    eyebrow: "Writing",
    description: "Keep the active line centered so long drafting sessions feel anchored.",
    status: "available",
    accent: "#0f766e",
    tags: ["Runtime-safe", "Bundled"],
    note: "Hot install",
    load: async () => {
      const mod = await import("@floatboat/nexus-plugin-typewriter");
      return mod.createTypewriterPlugin();
    },
  },
  {
    id: "focus-line",
    label: "Focus Line",
    eyebrow: "Writing",
    description: "Dim surrounding paragraphs and keep the current thought visually sharp.",
    status: "preview",
    accent: "#315f9a",
    tags: ["Preview", "No download"],
    note: "Mock listing",
  },
  {
    id: "table-lab",
    label: "Table Lab",
    eyebrow: "Editing",
    description: "Resize, reorder, and format markdown tables with a spreadsheet-like surface.",
    status: "planned",
    accent: "#9a5b13",
    tags: ["Roadmap", "Widgets"],
    note: "Needs widget lifecycle",
  },
  {
    id: "command-deck",
    label: "Command Deck",
    eyebrow: "Workflow",
    description: "A fast command launcher for snippets, transforms, and custom editor actions.",
    status: "preview",
    accent: "#6d5f2f",
    tags: ["Preview", "Shortcuts"],
    note: "Mock listing",
  },
  {
    id: "export-pack",
    label: "Export Pack",
    eyebrow: "Publishing",
    description: "Package markdown into clean HTML, PDF-ready documents, and shareable bundles.",
    status: "static-only",
    accent: "#8a3b3b",
    tags: ["Static hooks", "Restart"],
    note: "Requires restart",
  },
];

/**
 * Structural colors reuse the app's --nexus-* theme variables (see
 * theme.ts), with this panel's original hardcoded values kept as CSS
 * fallbacks — so the panel now tracks light/dark theme switching like every
 * other panel, instead of a shadow palette that only happened to look like
 * the default theme. Marketplace-only roles (the "NX" mark, text sitting on
 * a colored accent surface, the error banner) have no app-wide equivalent
 * and get their own names instead of borrowing an unrelated one.
 *
 * Consolidating into this one map also fixes several near-duplicate values
 * that had drifted apart with no semantic reason (five near-identical grays
 * all meaning "neutral border", three near-identical dark grays all meaning
 * "primary text") — the kind of drift that makes an automated dedupe pass
 * bail out, because it can't tell "accidentally different" from "meant to
 * differ" without a palette to check against.
 */
const COLOR = {
  border: "var(--nexus-border, #dfe5eb)",
  bg: "var(--nexus-bg, #ffffff)",
  bgSubtle: "var(--nexus-bg-subtle, #f8fafb)",
  bgMuted: "var(--nexus-bg-muted, #f2f5f7)",
  text: "var(--nexus-text, #17212b)",
  textMuted: "var(--nexus-text-muted, #667085)",
  mark: "#102a2a",
  markText: "#f5fbf8",
  onAccent: "#ffffff",
  error: "#b42318",
  errorBg: "#fff4f2",
} as const;

const PANEL_STYLES = `
  width: 332px;
  height: 100%;
  min-height: 0;
  flex-shrink: 0;
  border-left: 1px solid ${COLOR.border};
  background: ${COLOR.bgSubtle};
  color: ${COLOR.text};
  overflow: hidden;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  display: flex;
  flex-direction: column;
`;

const HEADER_STYLES = `
  padding: 14px 14px 12px;
  border-bottom: 1px solid ${COLOR.border};
  background: ${COLOR.bg};
  flex-shrink: 0;
`;

const TITLE_ROW_STYLES = `
  display: flex;
  align-items: flex-start;
  gap: 10px;
`;

const MARK_STYLES = `
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: ${COLOR.mark};
  color: ${COLOR.markText};
  font-size: 15px;
  font-weight: 800;
  line-height: 1;
  box-shadow: inset 0 -1px 0 rgba(255,255,255,0.16);
  flex-shrink: 0;
`;

const TITLE_STYLES = `
  font-size: 15px;
  font-weight: 760;
  letter-spacing: 0;
  color: ${COLOR.text};
`;

const SUBTITLE_STYLES = `
  margin-top: 2px;
  color: ${COLOR.textMuted};
  font-size: 12px;
  line-height: 1.35;
`;

const SEARCH_STYLES = `
  width: 100%;
  margin-top: 12px;
  border: 1px solid ${COLOR.border};
  border-radius: 8px;
  background: ${COLOR.bgSubtle};
  color: ${COLOR.text};
  padding: 7px 10px;
  font: inherit;
  outline: none;
`;

const TAB_ROW_STYLES = `
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 3px;
  border: 1px solid ${COLOR.border};
  border-radius: 8px;
  background: ${COLOR.bgMuted};
`;

const TAB_BASE_STYLES = `
  border: 0;
  border-radius: 6px;
  padding: 5px 6px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  color: ${COLOR.textMuted};
  background: transparent;
`;

const TAB_ACTIVE_STYLES = `
  color: ${COLOR.text};
  background: ${COLOR.bg};
  box-shadow: 0 1px 2px rgba(16, 42, 42, 0.12);
`;

const LOCAL_BAR_STYLES = `
  margin-top: 10px;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px dashed ${COLOR.border};
  border-radius: 8px;
  background: ${COLOR.bgSubtle};
`;

const LOCAL_TEXT_STYLES = `
  min-width: 0;
  color: ${COLOR.textMuted};
  font-size: 12px;
  line-height: 1.35;
`;

const LIST_STYLES = `
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  padding: 10px;
`;

const CARD_STYLES = `
  position: relative;
  overflow: hidden;
  border: 1px solid ${COLOR.border};
  border-radius: 8px;
  background: ${COLOR.bg};
  padding: 11px;
  margin-bottom: 9px;
  box-shadow: 0 1px 2px rgba(16, 42, 42, 0.04);
`;

const CARD_TOP_STYLES = `
  display: flex;
  align-items: flex-start;
  gap: 10px;
`;

const GLYPH_STYLES = `
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: ${COLOR.onAccent};
  font-size: 15px;
  font-weight: 760;
  flex-shrink: 0;
`;

const EYEBROW_STYLES = `
  color: ${COLOR.textMuted};
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const CARD_TITLE_STYLES = `
  margin-top: 1px;
  color: ${COLOR.text};
  font-size: 13px;
  font-weight: 760;
  line-height: 1.2;
`;

const STATUS_PILL_STYLES = `
  border-radius: 999px;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
`;

const DESCRIPTION_STYLES = `
  margin-top: 8px;
  color: ${COLOR.textMuted};
  line-height: 1.42;
  font-size: 12px;
`;

const TAG_ROW_STYLES = `
  margin-top: 9px;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
`;

const TAG_STYLES = `
  padding: 2px 6px;
  border-radius: 5px;
  background: ${COLOR.bgMuted};
  color: ${COLOR.textMuted};
  font-size: 10px;
  font-weight: 650;
`;

const CARD_ACTION_ROW_STYLES = `
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const NOTE_STYLES = `
  min-width: 0;
  color: ${COLOR.textMuted};
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const BUTTON_BASE_STYLES = `
  border-radius: 7px;
  padding: 5px 9px;
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
`;

const PRIMARY_BUTTON_STYLES = BUTTON_BASE_STYLES + `
  border: 1px solid ${COLOR.mark};
  background: ${COLOR.mark};
  color: ${COLOR.onAccent};
`;

const SECONDARY_BUTTON_STYLES = BUTTON_BASE_STYLES + `
  border: 1px solid ${COLOR.border};
  background: ${COLOR.bg};
  color: ${COLOR.text};
`;

const DISABLED_BUTTON_STYLES = BUTTON_BASE_STYLES + `
  border: 1px solid ${COLOR.border};
  background: ${COLOR.bgMuted};
  color: ${COLOR.textMuted};
  cursor: not-allowed;
  opacity: 0.72;
`;

const ERROR_STYLES = `
  margin-top: 8px;
  border-left: 2px solid ${COLOR.error};
  padding: 6px 8px;
  background: ${COLOR.errorBg};
  color: ${COLOR.error};
  font-size: 12px;
  line-height: 1.35;
  white-space: pre-wrap;
`;

const EMPTY_STYLES = `
  padding: 22px 12px;
  border: 1px dashed ${COLOR.border};
  border-radius: 8px;
  background: ${COLOR.bg};
  color: ${COLOR.textMuted};
  font-size: 12px;
  line-height: 1.45;
  text-align: center;
`;

function glyphFor(entry: CatalogEntry): string {
  return entry.label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

const STATUS_META: Record<string, { label: string; style: string }> = {
  installed: { label: "Installed", style: "background:#e7f6ef;color:#05603a;" },
  available: { label: "Runtime", style: "background:#e6f2ef;color:#0f766e;" },
  preview:   { label: "Preview", style: "background:#e8eef8;color:#315f9a;" },
  planned:   { label: "Planned", style: "background:#fbefd9;color:#8a4b0f;" },
  default:   { label: "Static", style: "background:#f7e8e8;color:#8a3b3b;" },
};

function statusKey(status: CatalogStatus, installed: boolean): string {
  if (installed) return "installed";
  return status === "static-only" ? "default" : status;
}

function statusLabel(status: CatalogStatus, installed: boolean): string {
  return STATUS_META[statusKey(status, installed)].label;
}

function statusStyles(status: CatalogStatus, installed: boolean): string {
  return STATUS_PILL_STYLES + STATUS_META[statusKey(status, installed)].style;
}

function matchesQuery(entry: CatalogEntry, query: string): boolean {
  if (!query) return true;
  const haystack = `${entry.label} ${entry.eyebrow} ${entry.description} ${entry.tags.join(" ")}`.toLowerCase();
  return haystack.includes(query);
}

function renderTag(text: string): HTMLElement {
  const tag = document.createElement("span");
  tag.style.cssText = TAG_STYLES;
  tag.textContent = text;
  return tag;
}

export function createPluginsPanel(editor: EditorAPI): PluginsPanel {
  const element = document.createElement("aside");
  element.className = "plugins-panel";
  element.style.cssText = PANEL_STYLES;

  const header = document.createElement("div");
  header.style.cssText = HEADER_STYLES;

  const titleRow = document.createElement("div");
  titleRow.style.cssText = TITLE_ROW_STYLES;

  const mark = document.createElement("div");
  mark.style.cssText = MARK_STYLES;
  mark.textContent = "NX";

  const titleBlock = document.createElement("div");
  titleBlock.style.cssText = "min-width:0;flex:1;";

  const title = document.createElement("div");
  title.style.cssText = TITLE_STYLES;
  title.textContent = "Marketplace";

  const subtitle = document.createElement("div");
  subtitle.style.cssText = SUBTITLE_STYLES;

  titleBlock.append(title, subtitle);
  titleRow.append(mark, titleBlock);

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search extensions";
  search.style.cssText = SEARCH_STYLES;

  const tabRow = document.createElement("div");
  tabRow.style.cssText = TAB_ROW_STYLES;

  const tabs: Array<{ id: MarketplaceTab; label: string; button: HTMLButtonElement }> = [
    { id: "featured", label: "Featured", button: document.createElement("button") },
    { id: "installed", label: "Installed", button: document.createElement("button") },
    { id: "local", label: "Local", button: document.createElement("button") },
  ];

  let activeTab: MarketplaceTab = "featured";
  let searchQuery = "";
  let localFolderStatus: LocalFolderStatus = "idle";
  let localFolderPath: string | null = null;
  let localError: string | null = null;

  for (const tab of tabs) {
    tab.button.type = "button";
    tab.button.textContent = tab.label;
    tab.button.addEventListener("click", () => {
      activeTab = tab.id;
      render();
    });
    tabRow.appendChild(tab.button);
  }

  const localBar = document.createElement("div");
  localBar.style.cssText = LOCAL_BAR_STYLES;

  const localText = document.createElement("div");
  localText.style.cssText = LOCAL_TEXT_STYLES;

  const localButton = document.createElement("button");
  localButton.type = "button";
  localButton.style.cssText = SECONDARY_BUTTON_STYLES;
  localButton.addEventListener("click", () => {
    void handlePickLocalFolder();
  });

  localBar.append(localText, localButton);
  header.append(titleRow, search, tabRow, localBar);

  const list = document.createElement("div");
  list.style.cssText = LIST_STYLES;

  element.append(header, list);

  // Per-entry transient UI state (install in flight / last error).
  const busy = new Set<string>();
  const errors = new Map<string, string>();

  // Cached set of installed runtime plugin names — invalidated only on
  // pluginsChange, not on every search-input render.
  let installedNames = new Set<string>();
  const refreshInstalledNames = (): void => {
    installedNames = new Set(
      editor
        .getPlugins()
        .filter((plugin) => plugin.runtime)
        .map((plugin) => plugin.name)
    );
  };
  refreshInstalledNames();

  search.addEventListener("input", () => {
    searchQuery = search.value.trim().toLowerCase();
    render();
  });

  function render(): void {
    const installed = installedNames;
    const installedCount = CATALOG.filter((entry) => installed.has(entry.id)).length;
    subtitle.textContent = `${installedCount} enabled / ${CATALOG.length} curated listings`;

    for (const tab of tabs) {
      tab.button.style.cssText = TAB_BASE_STYLES + (tab.id === activeTab ? TAB_ACTIVE_STYLES : "");
    }

    // Local bar is only relevant on the "Local" tab.
    localBar.style.display = activeTab === "local" ? "" : "none";
    if (activeTab === "local") {
      if (localFolderStatus === "picking") {
        localText.textContent = "Opening a folder picker for a future local plugin flow.";
        localButton.textContent = "Picking...";
        localButton.style.cssText = DISABLED_BUTTON_STYLES;
        localButton.disabled = true;
      } else if (localFolderStatus === "error") {
        localText.textContent = localError ?? "Local folder preview is unavailable.";
        localText.title = "";
        localButton.textContent = "Try again";
        localButton.style.cssText = SECONDARY_BUTTON_STYLES;
        localButton.disabled = false;
      } else if (localFolderPath) {
        localText.textContent = `${basename(localFolderPath)} selected for preview. Loading is disabled in this demo.`;
        localText.title = localFolderPath;
        localButton.textContent = "Change";
        localButton.style.cssText = SECONDARY_BUTTON_STYLES;
        localButton.disabled = false;
      } else {
        localText.textContent = "Preview a local plugin folder without executing any code.";
        localText.title = "";
        localButton.textContent = "Add local...";
        localButton.style.cssText = SECONDARY_BUTTON_STYLES;
        localButton.disabled = false;
      }
    }

    list.textContent = "";

    if (activeTab === "local") {
      renderLocalIntro(list);
    }

    const visible = CATALOG.filter((entry) => {
      if (activeTab === "installed" && !installed.has(entry.id)) return false;
      if (!matchesQuery(entry, searchQuery)) return false;
      return true;
    });

    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = EMPTY_STYLES;
      empty.textContent =
        activeTab === "installed"
          ? "No runtime extensions are installed yet."
          : "No marketplace listings match this search.";
      list.appendChild(empty);
      return;
    }

    for (const entry of visible) {
      renderCard(entry, installed.has(entry.id), list);
    }
  }

  function renderLocalIntro(parent: HTMLElement): void {
    const intro = document.createElement("div");
    intro.style.cssText = CARD_STYLES + "border-style:dashed;";

    const label = document.createElement("div");
    label.style.cssText = EYEBROW_STYLES;
    label.textContent = "Developer mode";

    const heading = document.createElement("div");
    heading.style.cssText = CARD_TITLE_STYLES + "font-size:14px;margin-top:4px;";
    heading.textContent = localFolderPath ? basename(localFolderPath) : "Add from folder";
    heading.title = localFolderPath ?? "";

    const copy = document.createElement("div");
    copy.style.cssText = DESCRIPTION_STYLES;
    copy.textContent = localFolderPath
      ? "The folder is only remembered for this panel preview. A real loader still needs a manifest, trust prompt, and sandbox policy."
      : "Choose a folder to show the intended local-plugin install path. This demo never imports or runs code from that folder.";

    intro.append(label, heading, copy);

    if (localError) {
      const errorEl = document.createElement("div");
      errorEl.style.cssText = ERROR_STYLES;
      errorEl.textContent = localError;
      intro.appendChild(errorEl);
    }

    parent.appendChild(intro);
  }

  function renderCard(entry: CatalogEntry, isInstalled: boolean, parent: HTMLElement): void {
    const card = document.createElement("div");
    card.style.cssText = CARD_STYLES;

    const stripe = document.createElement("div");
    stripe.style.cssText = `
      position:absolute;
      left:0;
      top:0;
      bottom:0;
      width:3px;
      background:${entry.accent};
      opacity:${isInstalled ? "1" : "0.55"};
    `;
    card.appendChild(stripe);

    const top = document.createElement("div");
    top.style.cssText = CARD_TOP_STYLES;

    const glyph = document.createElement("div");
    glyph.style.cssText = GLYPH_STYLES + `background:${entry.accent};`;
    glyph.textContent = glyphFor(entry);

    const main = document.createElement("div");
    main.style.cssText = "min-width:0;flex:1;";

    const eyebrow = document.createElement("div");
    eyebrow.style.cssText = EYEBROW_STYLES;
    eyebrow.textContent = entry.eyebrow;

    const cardTitle = document.createElement("div");
    cardTitle.style.cssText = CARD_TITLE_STYLES;
    cardTitle.textContent = entry.label;

    main.append(eyebrow, cardTitle);

    const status = document.createElement("span");
    status.style.cssText = statusStyles(entry.status, isInstalled);
    status.textContent = statusLabel(entry.status, isInstalled);

    top.append(glyph, main, status);
    card.appendChild(top);

    const description = document.createElement("div");
    description.style.cssText = DESCRIPTION_STYLES;
    description.textContent = entry.description;
    card.appendChild(description);

    const tagRow = document.createElement("div");
    tagRow.style.cssText = TAG_ROW_STYLES;
    for (const tag of entry.tags) {
      tagRow.appendChild(renderTag(tag));
    }
    card.appendChild(tagRow);

    const actionRow = document.createElement("div");
    actionRow.style.cssText = CARD_ACTION_ROW_STYLES;

    const note = document.createElement("div");
    note.style.cssText = NOTE_STYLES;
    note.textContent = entry.note;
    actionRow.appendChild(note);

    const button = document.createElement("button");
    button.type = "button";
    renderActionButton(button, entry, isInstalled);
    actionRow.appendChild(button);
    card.appendChild(actionRow);

    const error = errors.get(entry.id);
    if (error) {
      const errorEl = document.createElement("div");
      errorEl.style.cssText = ERROR_STYLES;
      errorEl.textContent = error;
      card.appendChild(errorEl);
    }

    parent.appendChild(card);
  }

  function renderActionButton(
    button: HTMLButtonElement,
    entry: CatalogEntry,
    isInstalled: boolean
  ): void {
    const isBusy = busy.has(entry.id);
    if (isBusy) {
      button.textContent = "Working";
      button.style.cssText = DISABLED_BUTTON_STYLES;
      button.disabled = true;
      return;
    }

    if (isInstalled) {
      button.textContent = "Remove";
      button.style.cssText = SECONDARY_BUTTON_STYLES;
      button.disabled = false;
      button.addEventListener("click", () => handleRemove(entry));
      return;
    }

    if (entry.status === "available" && entry.load) {
      button.textContent = "Install";
      button.style.cssText = PRIMARY_BUTTON_STYLES;
      button.disabled = false;
      button.addEventListener("click", () => {
        void handleInstall(entry);
      });
      return;
    }

    button.textContent = entry.status === "static-only" ? "Restart" : "Preview";
    button.style.cssText = DISABLED_BUTTON_STYLES;
    button.disabled = true;
  }

  async function handleInstall(entry: CatalogEntry): Promise<void> {
    if (!entry.load) return;
    busy.add(entry.id);
    errors.delete(entry.id);
    render();
    try {
      const plugin = await entry.load();
      editor.addPlugin(plugin); // pluginsChange re-renders on success
    } catch (err) {
      errors.set(entry.id, err instanceof Error ? err.message : String(err));
    } finally {
      busy.delete(entry.id);
      render();
    }
  }

  function handleRemove(entry: CatalogEntry): void {
    errors.delete(entry.id);
    try {
      editor.removePlugin(entry.id);
    } catch (err) {
      errors.set(entry.id, err instanceof Error ? err.message : String(err));
      render();
    }
  }

  async function handlePickLocalFolder(): Promise<void> {
    localFolderStatus = "picking";
    localError = null;
    render();
    try {
      const bridge = (window as Window & { nexusDemo?: Window["nexusDemo"] }).nexusDemo;
      if (!bridge) {
        throw new Error("Local folder preview requires the Electron shell.");
      }
      const picked = await bridge.vault.pick();
      if (!picked) {
        localFolderStatus = localFolderPath ? "selected" : "idle";
        render();
        return;
      }
      localFolderPath = picked.path;
      activeTab = "local";
      localFolderStatus = "selected";
    } catch (err) {
      localFolderStatus = "error";
      localError = err instanceof Error ? err.message : String(err);
    } finally {
      render();
    }
  }

  const onPluginsChange = (): void => {
    refreshInstalledNames();
    render();
  };
  editor.on("pluginsChange", onPluginsChange);
  render();

  return {
    element,
    destroy() {
      editor.off("pluginsChange", onPluginsChange);
      element.remove();
    },
  };
}
