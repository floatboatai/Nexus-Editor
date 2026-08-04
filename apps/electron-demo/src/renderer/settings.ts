import { lightTheme, darkTheme, type NexusTheme } from "@floatboat/nexus-core";

export interface EditorSettings {
  /** "light" | "dark" */
  colorScheme: "light" | "dark";
  fontSize: number;
  fontFamily: string;
  fontFamilyMono: string;
  contentMaxWidth: string;
  tabSize: number;
  direction: "ltr" | "rtl";
  indentGuides: boolean;
  lineNumbers: boolean;
  livePreview: boolean;
}

const STORAGE_KEY = "nexus-editor-settings";

/** Editorial light palette from DESIGN.md — injected only in the demo shell. */
const designLightTheme: Partial<NexusTheme> = {
  bg: "#ffffff",
  bgSubtle: "#f5f5f5",
  bgMuted: "#f0efed",
  text: "#0c0a09",
  textMuted: "#777169",
  textFaint: "#a8a29e",
  border: "#e7e5e4",
  borderSubtle: "#f0efed",
  accent: "#292524",
  tooltipBg: "#0c0a09",
  tooltipText: "#ffffff",
  hlKeyword: "#9f1239",
  hlString: "#3f6212",
  hlTitle: "#44403c",
  hlComment: "#a8a29e",
  hlNumber: "#b45309",
  hlType: "#57534e",
  hlDeletion: "#dc2626",
  hlVariable: "#78716c",
};

/** Editorial dark palette aligned with DESIGN surface-dark tokens. */
const designDarkTheme: Partial<NexusTheme> = {
  bg: "#1c1917",
  bgSubtle: "#0c0a09",
  bgMuted: "#292524",
  text: "#fafaf9",
  textMuted: "#a8a29e",
  textFaint: "#78716c",
  border: "#292524",
  borderSubtle: "#1c1917",
  accent: "#fafaf9",
  tooltipBg: "#292524",
  tooltipText: "#fafaf9",
  hlKeyword: "#fb7185",
  hlString: "#a3e635",
  hlTitle: "#e7e5e4",
  hlComment: "#78716c",
  hlNumber: "#fbbf24",
  hlType: "#a8a29e",
  hlDeletion: "#f87171",
  hlVariable: "#d6d3d1",
};

/**
 * Drive shell chrome CSS (`html[data-theme]`) so panels / titlebar / menus
 * follow color scheme. The editor theme is applied separately via setTheme().
 */
export function applyShellColorScheme(scheme: "light" | "dark"): void {
  const root = document.documentElement;
  root.dataset.theme = scheme;
  root.classList.toggle("theme-dark", scheme === "dark");
  root.classList.toggle("theme-light", scheme === "light");
  document.body?.classList.toggle("theme-dark", scheme === "dark");
  document.body?.classList.toggle("theme-light", scheme === "light");

  // Keep OS window chrome / overscroll tint roughly in sync.
  const canvas = scheme === "dark" ? "#0c0a09" : "#f5f5f5";
  document.body.style.background = canvas;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", canvas);
}

export function defaultSettings(): EditorSettings {
  return {
    colorScheme: "light",
    fontSize: 15,
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    fontFamilyMono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    contentMaxWidth: "",
    tabSize: 4,
    direction: "ltr",
    indentGuides: false,
    lineNumbers: true,
    livePreview: true,
  };
}

export function loadSettings(): EditorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultSettings();
}

export function saveSettings(settings: EditorSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

export function settingsToTheme(settings: EditorSettings): NexusTheme {
  const base =
    settings.colorScheme === "dark"
      ? { ...darkTheme, ...designDarkTheme }
      : { ...lightTheme, ...designLightTheme };
  return {
    ...base,
    fontSize: settings.fontSize,
    fontFamily: settings.fontFamily,
    fontFamilyMono: settings.fontFamilyMono,
    contentMaxWidth: settings.contentMaxWidth || undefined,
  };
}

// ── Settings Panel UI ──

interface SettingsPanelResult {
  element: HTMLElement;
  destroy(): void;
}

type OnChange = (settings: EditorSettings) => void;

function createToggle(value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  const update = (v: boolean) => {
    btn.style.cssText = `
      width: 44px; height: 24px; border-radius: 12px; border: none; cursor: pointer;
      position: relative; transition: background 0.2s; flex-shrink: 0;
      background: ${v ? "var(--nexus-accent, #0969da)" : "var(--nexus-bg-muted, #ccc)"};
    `;
    btn.innerHTML = `<span style="
      position: absolute; top: 2px; ${v ? "left: 22px" : "left: 2px"};
      width: 20px; height: 20px; border-radius: 50%;
      background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      transition: left 0.2s;
    "></span>`;
  };
  update(value);
  btn.addEventListener("click", () => {
    value = !value;
    update(value);
    onChange(value);
  });
  return btn;
}

function createSelect(options: string[], value: string, onChange: (v: string) => void): HTMLElement {
  const sel = document.createElement("select");
  sel.style.cssText = `
    padding: 4px 8px; border-radius: 6px; font-size: 13px;
    border: 1px solid var(--nexus-border, #ddd);
    background: var(--nexus-bg, #fff);
    color: var(--nexus-text, #24292e);
    cursor: pointer; flex-shrink: 0;
  `;
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (opt === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function createNumberInput(value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;align-items:center;gap:8px;flex-shrink:0;";

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.style.cssText = "width:100px;cursor:pointer;accent-color:var(--nexus-accent,#0969da);";

  const label = document.createElement("span");
  label.textContent = String(value);
  label.style.cssText = "font-size:13px;min-width:28px;text-align:right;color:var(--nexus-text-muted,#888);";

  input.addEventListener("input", () => {
    const v = Number(input.value);
    label.textContent = String(v);
    onChange(v);
  });

  wrap.append(input, label);
  return wrap;
}

function createTextInput(value: string, placeholder: string, onChange: (v: string) => void): HTMLElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.style.cssText = `
    padding: 4px 8px; border-radius: 6px; font-size: 13px;
    border: 1px solid var(--nexus-border, #ddd);
    background: var(--nexus-bg, #fff);
    color: var(--nexus-text, #24292e);
    width: 180px; flex-shrink: 0;
  `;
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

function row(title: string, desc: string, control: HTMLElement): HTMLElement {
  const el = document.createElement("div");
  el.className = "nx-modal__row";

  const labelWrap = document.createElement("div");
  labelWrap.style.cssText = "flex:1;min-width:0;";

  const t = document.createElement("div");
  t.className = "nx-modal__label-title";
  t.textContent = title;

  const d = document.createElement("div");
  d.className = "nx-modal__label-desc";
  d.textContent = desc;

  labelWrap.append(t, d);
  el.append(labelWrap, control);
  return el;
}

function sectionTitle(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "nx-modal__section-title";
  el.textContent = text;
  return el;
}

export function createSettingsPanel(settings: EditorSettings, onChange: OnChange): SettingsPanelResult {
  const backdrop = document.createElement("div");
  backdrop.className = "nx-modal";

  const dialog = document.createElement("div");
  dialog.className = "nx-modal__dialog";

  // Header
  const header = document.createElement("div");
  header.className = "nx-modal__header";
  const titleEl = document.createElement("span");
  titleEl.textContent = "Settings";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "nx-btn nx-btn--icon";
  closeBtn.innerHTML = "&times;";
  closeBtn.title = "Close";
  header.append(titleEl, closeBtn);

  // Body
  const body = document.createElement("div");
  body.className = "nx-modal__body";

  const s = { ...settings };
  const emit = () => { saveSettings(s); onChange(s); };

  // -- Display section --
  body.appendChild(sectionTitle("Display"));
  body.appendChild(row("Color scheme", "Light or dark theme", createSelect(["light", "dark"], s.colorScheme, (v) => { s.colorScheme = v as "light" | "dark"; emit(); })));
  body.appendChild(row("Line numbers", "Show line numbers in the gutter", createToggle(s.lineNumbers, (v) => { s.lineNumbers = v; emit(); })));
  body.appendChild(row("Live preview", "Render markdown in real-time", createToggle(s.livePreview, (v) => { s.livePreview = v; emit(); })));
  body.appendChild(row("Indent guides", "Show indentation guide lines", createToggle(s.indentGuides, (v) => { s.indentGuides = v; emit(); })));
  body.appendChild(row("Content max width", "Limit line width for readability (e.g. 720px)", createTextInput(s.contentMaxWidth, "e.g. 720px", (v) => { s.contentMaxWidth = v; emit(); })));
  body.appendChild(row("Text direction", "Left-to-right or right-to-left", createSelect(["ltr", "rtl"], s.direction, (v) => { s.direction = v as "ltr" | "rtl"; emit(); })));

  // -- Font section --
  body.appendChild(sectionTitle("Font"));
  body.appendChild(row("Font size", "Editor text size in pixels", createNumberInput(s.fontSize, 10, 28, 1, (v) => { s.fontSize = v; emit(); })));
  body.appendChild(row("Body font", "Font for prose content", createTextInput(s.fontFamily, "system-ui, sans-serif", (v) => { s.fontFamily = v; emit(); })));
  body.appendChild(row("Code font", "Monospace font for code blocks", createTextInput(s.fontFamilyMono, "ui-monospace, monospace", (v) => { s.fontFamilyMono = v; emit(); })));

  // -- Behavior section --
  body.appendChild(sectionTitle("Behavior"));
  body.appendChild(row("Tab size", "Number of spaces per tab", createNumberInput(s.tabSize, 1, 8, 1, (v) => { s.tabSize = v; emit(); })));

  dialog.append(header, body);
  backdrop.appendChild(dialog);

  const close = () => backdrop.remove();
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", handleEsc); } };
  document.addEventListener("keydown", handleEsc);

  document.body.appendChild(backdrop);

  return {
    element: backdrop,
    destroy() {
      document.removeEventListener("keydown", handleEsc);
      close();
    },
  };
}
