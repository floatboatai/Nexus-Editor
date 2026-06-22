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

export function defaultSettings(): EditorSettings {
  return {
    colorScheme: "light",
    fontSize: 15,
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
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
  const base = settings.colorScheme === "dark" ? darkTheme : lightTheme;
  return {
    ...base,
    fontSize: settings.fontSize,
    fontFamily: settings.fontFamily,
    fontFamilyMono: settings.fontFamilyMono,
    contentMaxWidth: settings.contentMaxWidth || undefined,
  };
}

// ── Settings Panel UI ──

const PANEL_STYLES = `
  position: fixed; inset: 0; z-index: 9999;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.4);
  font-family: system-ui, -apple-system, sans-serif;
`;

const DIALOG_STYLES = `
  background: var(--nexus-bg, #fff);
  color: var(--nexus-text, #24292e);
  border: 1px solid var(--nexus-border, #eee);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  width: min(520px, calc(100vw - 32px)); max-height: min(80vh, calc(100vh - 32px));
  overflow-y: auto;
  padding: 0;
`;

const HEADER_STYLES = `
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
  padding: 16px 24px;
  border-bottom: 1px solid var(--nexus-border, #eee);
  font-size: 16px; font-weight: 600;
`;

const SECTION_STYLES = `
  padding: 8px 24px 16px;
`;

const SECTION_TITLE_STYLES = `
  font-size: 12px; font-weight: 600; text-transform: uppercase;
  color: var(--nexus-text-muted, #888);
  letter-spacing: 0.5px;
  padding: 12px 0 4px;
`;

const ROW_STYLES = `
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--nexus-border-subtle, #f0f0f0);
  gap: 12px;
`;

const LABEL_STYLES = `
  flex: 1; min-width: 0;
`;

const LABEL_TITLE_STYLES = `
  font-size: 14px; font-weight: 500; line-height: 1.4;
`;

const LABEL_DESC_STYLES = `
  font-size: 12px; color: var(--nexus-text-muted, #888); line-height: 1.4;
`;

const CLOSE_BTN_STYLES = `
  background: none; border: none; cursor: pointer;
  font-size: 20px; color: var(--nexus-text-muted, #888);
  width: 32px; height: 32px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
`;

interface SettingsPanelResult {
  element: HTMLElement;
  destroy(): void;
}

type OnChange = (settings: EditorSettings) => void;

export interface LLMWikiSettingsActions {
  getConfigStatus(): Promise<LLMWikiConfigStatus>;
  saveConfig(input: LLMWikiConfigInput): Promise<LLMWikiConfigStatus>;
  getSubmitMode(): Promise<{ projectPath: string; mode: LLMWikiSubmitMode }>;
  setSubmitMode(mode: LLMWikiSubmitMode): Promise<{ projectPath: string; mode: LLMWikiSubmitMode }>;
  openSchema(): Promise<void>;
}

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

function createPasswordInput(placeholder: string, onChange: (v: string) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "password";
  input.autocomplete = "off";
  input.placeholder = placeholder;
  input.style.cssText = `
    padding: 4px 8px; border-radius: 6px; font-size: 13px;
    border: 1px solid var(--nexus-border, #ddd);
    background: var(--nexus-bg, #fff);
    color: var(--nexus-text, #24292e);
    width: 180px; flex-shrink: 0;
  `;
  input.addEventListener("input", () => onChange(input.value));
  return input;
}

function createInlineButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.style.cssText = `
    padding: 4px 10px; border-radius: 6px; font-size: 13px;
    border: 1px solid var(--nexus-border, #ddd);
    background: var(--nexus-bg, #fff);
    color: var(--nexus-text, #24292e);
    cursor: pointer;
  `;
  btn.addEventListener("click", onClick);
  return btn;
}

function row(title: string, desc: string, control: HTMLElement): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = ROW_STYLES;

  const labelWrap = document.createElement("div");
  labelWrap.style.cssText = LABEL_STYLES;

  const t = document.createElement("div");
  t.style.cssText = LABEL_TITLE_STYLES;
  t.textContent = title;

  const d = document.createElement("div");
  d.style.cssText = LABEL_DESC_STYLES;
  d.textContent = desc;

  labelWrap.append(t, d);
  el.append(labelWrap, control);
  return el;
}

function sectionTitle(text: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = SECTION_TITLE_STYLES;
  el.textContent = text;
  return el;
}

function formatLLMWikiConfigStatus(status: LLMWikiConfigStatus): string {
  return status.provider === "deepseek" && status.apiKeyConfigured
    ? "DeepSeek configured"
    : "Fixture mode";
}

function sanitizeLLMWikiError(err: unknown, apiKey: string): string {
  const message = err instanceof Error ? err.message : String(err);
  const withoutInputKey = apiKey ? message.split(apiKey).join("[redacted]") : message;
  return withoutInputKey
    .replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET)[A-Z0-9_]*)=([^\s]+)/gi, "$1=[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted-key]")
    .slice(0, 500);
}

export function createSettingsPanel(
  settings: EditorSettings,
  onChange: OnChange,
  llmWiki?: LLMWikiSettingsActions
): SettingsPanelResult {
  const backdrop = document.createElement("div");
  backdrop.style.cssText = PANEL_STYLES;

  const dialog = document.createElement("div");
  dialog.style.cssText = DIALOG_STYLES;

  // Header
  const header = document.createElement("div");
  header.style.cssText = HEADER_STYLES;
  const titleEl = document.createElement("span");
  titleEl.textContent = "Settings";
  const closeBtn = document.createElement("button");
  closeBtn.style.cssText = CLOSE_BTN_STYLES;
  closeBtn.innerHTML = "&times;";
  closeBtn.title = "Close";
  header.append(titleEl, closeBtn);

  // Body
  const body = document.createElement("div");
  body.style.cssText = SECTION_STYLES;

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

  if (llmWiki) {
    const configState: LLMWikiConfigInput = {
      provider: "fixture",
      model: "deepseek-v4-pro",
      baseUrl: "https://api.deepseek.com",
      apiKey: "",
    };
    const statusText = document.createElement("span");
    statusText.textContent = "Loading...";
    statusText.style.cssText = "font-size:13px;color:var(--nexus-text-muted,#888);";

    let submitModeTouched = false;
    const submitModeSelect = createSelect(["manual", "auto"], "manual", (v) => {
      submitModeTouched = true;
      void llmWiki.setSubmitMode(v === "auto" ? "auto" : "manual")
        .then((result) => {
          submitModeSelect.value = result.mode;
        })
        .catch((err) => {
          statusText.textContent = err instanceof Error ? err.message : String(err);
        });
    }) as HTMLSelectElement;
    const providerSelect = createSelect(["fixture", "deepseek"], configState.provider, (v) => {
      configState.provider = v === "deepseek" ? "deepseek" : "fixture";
    }) as HTMLSelectElement;
    const modelInput = createTextInput(configState.model ?? "", "deepseek-v4-pro", (v) => {
      configState.model = v;
    }) as HTMLInputElement;
    const baseUrlInput = createTextInput(configState.baseUrl ?? "", "https://api.deepseek.com", (v) => {
      configState.baseUrl = v;
    }) as HTMLInputElement;
    const apiKeyInput = createPasswordInput("Leave blank to keep existing key", (v) => {
      configState.apiKey = v;
    });

    const saveBtn = createInlineButton("Save", () => {
      void (async () => {
        const submittedKey = configState.apiKey ?? "";
        try {
          statusText.textContent = "Saving...";
          const next = await llmWiki.saveConfig(configState);
          apiKeyInput.value = "";
          configState.apiKey = "";
          configState.provider = next.provider;
          configState.model = next.model;
          configState.baseUrl = next.baseUrl;
          providerSelect.value = next.provider;
          modelInput.value = next.model;
          baseUrlInput.value = next.baseUrl;
          statusText.textContent = formatLLMWikiConfigStatus(next);
        } catch (err) {
          statusText.textContent = sanitizeLLMWikiError(err, submittedKey);
        }
      })();
    });
    const openSchemaBtn = createInlineButton("Open schema", () => {
      void (async () => {
        try {
          statusText.textContent = "Opening schema...";
          await llmWiki.openSchema();
        } catch (err) {
          statusText.textContent = sanitizeLLMWikiError(err, configState.apiKey ?? "");
        }
      })();
    });
    const docsLink = document.createElement("a");
    docsLink.href = "https://api-docs.deepseek.com/zh-cn/";
    docsLink.target = "_blank";
    docsLink.rel = "noreferrer";
    docsLink.textContent = "DeepSeek docs";
    docsLink.style.cssText = "font-size:13px;color:var(--nexus-accent,#0969da);text-decoration:none;";

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;";
    actions.append(saveBtn, openSchemaBtn, docsLink);

    body.appendChild(sectionTitle("LLM Wiki"));
    body.appendChild(row("Submit mode", "Manual by default, or auto submit raw saves", submitModeSelect));
    body.appendChild(row("Provider", "Use deterministic fixtures or DeepSeek", providerSelect));
    body.appendChild(row("DeepSeek model", "Model used by the Python sidecar", modelInput));
    body.appendChild(row("DeepSeek base URL", "API endpoint for DeepSeek-compatible requests", baseUrlInput));
    body.appendChild(row("DeepSeek API key", "Stored only in the sidecar .env file", apiKeyInput));
    body.appendChild(row("Configuration status", "Current sidecar provider configuration", statusText));
    body.appendChild(row("Actions", "Save provider config or edit the schema", actions));

    void llmWiki.getConfigStatus()
      .then((status) => {
        configState.provider = status.provider;
        configState.model = status.model;
        configState.baseUrl = status.baseUrl;
        configState.apiKey = "";
        providerSelect.value = status.provider;
        modelInput.value = status.model;
        baseUrlInput.value = status.baseUrl;
        statusText.textContent = formatLLMWikiConfigStatus(status);
      })
      .catch((err) => {
        statusText.textContent = sanitizeLLMWikiError(err, "");
      });
    void llmWiki.getSubmitMode()
      .then((result) => {
        if (!submitModeTouched) {
          submitModeSelect.value = result.mode;
        }
      })
      .catch((err) => {
        statusText.textContent = err instanceof Error ? err.message : String(err);
      });
  }

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
