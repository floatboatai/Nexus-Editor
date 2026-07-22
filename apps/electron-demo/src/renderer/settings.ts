// apps/electron-demo/src/renderer/settings.ts
import { lightTheme, darkTheme, type NexusTheme } from "@floatboat/nexus-core";
import { t, setLanguage, getLanguage, type Language } from "./i18n";

export interface EditorSettings {
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
  language: Language; // 新增
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
    language: "en",
  };
}

export function loadSettings(): EditorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.language) parsed.language = "en";
      return { ...defaultSettings(), ...parsed };
    }
  } catch {
    /* ignore */
  }
  return defaultSettings();
}

export function saveSettings(settings: EditorSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
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

type OnChange = (settings: EditorSettings) => void;

let stylesInjected = false;

function injectSettingsStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    .nexus-settings-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.4);
      font-family: system-ui, -apple-system, sans-serif;
    }
    .nexus-settings-dialog {
      background: var(--nexus-bg, #fff);
      color: var(--nexus-text, #24292e);
      border: 1px solid var(--nexus-border, #eee);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      width: 540px;
      max-height: 80vh;
      overflow-y: auto;
      padding: 0;
    }
    .nexus-settings-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px;
      border-bottom: 1px solid var(--nexus-border, #eee);
    }
    .nexus-settings-header h2 {
      font-size: 16px;
      font-weight: 600;
      margin: 0;
    }
    .nexus-settings-header-actions {
      display: flex;
      gap: 8px;
    }
    .nexus-settings-header-actions button {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 14px;
      color: var(--nexus-text-muted, #888);
      padding: 4px 8px;
      border-radius: 6px;
      transition: background 0.15s;
    }
    .nexus-settings-header-actions button:hover {
      background: var(--nexus-bg-muted, #f0f0f0);
    }
    .nexus-settings-body {
      padding: 8px 24px 16px;
    }
    .nexus-settings-section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--nexus-text-muted, #888);
      letter-spacing: 0.5px;
      padding: 12px 0 4px;
    }
    .nexus-settings-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid var(--nexus-border-subtle, #f0f0f0);
      gap: 12px;
    }
    .nexus-settings-row-label {
      flex: 1;
      min-width: 0;
    }
    .nexus-settings-row-label-title {
      font-size: 14px;
      font-weight: 500;
      line-height: 1.4;
    }
    .nexus-settings-row-label-desc {
      font-size: 12px;
      color: var(--nexus-text-muted, #888);
      line-height: 1.4;
    }
    .nexus-settings-row-control {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .nexus-toggle {
      width: 44px;
      height: 24px;
      border-radius: 12px;
      border: none;
      cursor: pointer;
      position: relative;
      transition: background 0.2s;
      flex-shrink: 0;
      background: var(--nexus-bg-muted, #ccc);
    }
    .nexus-toggle[aria-checked="true"] {
      background: var(--nexus-accent, #0969da);
    }
    .nexus-toggle::after {
      content: "";
      position: absolute;
      top: 2px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: white;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      transition: left 0.2s;
    }
    .nexus-toggle[aria-checked="false"]::after {
      left: 2px;
    }
    .nexus-toggle[aria-checked="true"]::after {
      left: 22px;
    }
    .nexus-settings-select,
    .nexus-settings-textinput {
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 13px;
      border: 1px solid var(--nexus-border, #ddd);
      background: var(--nexus-bg, #fff);
      color: var(--nexus-text, #24292e);
    }
    .nexus-settings-select {
      cursor: pointer;
    }
    .nexus-settings-textinput {
      width: 180px;
    }
    .nexus-settings-range {
      width: 100px;
      cursor: pointer;
      accent-color: var(--nexus-accent, #0969da);
    }
    .nexus-settings-range-value {
      font-size: 13px;
      min-width: 28px;
      text-align: right;
      color: var(--nexus-text-muted, #888);
    }
  `;
  document.head.appendChild(style);
}

function createToggle(value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "nexus-toggle";
  btn.type = "button";
  btn.setAttribute("role", "switch");
  btn.setAttribute("aria-checked", String(value));
  btn.addEventListener("click", () => {
    value = !value;
    btn.setAttribute("aria-checked", String(value));
    onChange(value);
  });
  return btn;
}

function createSelect(options: string[], value: string, onChange: (v: string) => void): HTMLElement {
  const sel = document.createElement("select");
  sel.className = "nexus-settings-select";
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

function createNumberInput(
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "nexus-settings-row-control";

  const range = document.createElement("input");
  range.type = "range";
  range.className = "nexus-settings-range";
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(value);

  const label = document.createElement("span");
  label.className = "nexus-settings-range-value";
  label.textContent = String(value);

  range.addEventListener("input", () => {
    const v = Number(range.value);
    label.textContent = String(v);
    onChange(v);
  });

  wrap.append(range, label);
  return wrap;
}

function createTextInput(value: string, placeholder: string, onChange: (v: string) => void): HTMLElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "nexus-settings-textinput";
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

function row(title: string, desc: string, control: HTMLElement): HTMLElement {
  const el = document.createElement("div");
  el.className = "nexus-settings-row";

  const labelWrap = document.createElement("div");
  labelWrap.className = "nexus-settings-row-label";

  const t = document.createElement("div");
  t.className = "nexus-settings-row-label-title";
  t.textContent = title;

  const d = document.createElement("div");
  d.className = "nexus-settings-row-label-desc";
  d.textContent = desc;

  labelWrap.append(t, d);
  el.append(labelWrap, control);
  return el;
}

function sectionTitle(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "nexus-settings-section-title";
  el.textContent = text;
  return el;
}

export function createSettingsPanel(settings: EditorSettings, onChange: OnChange): {
  element: HTMLElement;
  destroy(): void;
} {
  // 确保当前语言与设置一致
  setLanguage(settings.language);

  injectSettingsStyles();

  const backdrop = document.createElement("div");
  backdrop.className = "nexus-settings-overlay";

  const dialog = document.createElement("div");
  dialog.className = "nexus-settings-dialog";

  // Header
  const header = document.createElement("div");
  header.className = "nexus-settings-header";
  const titleEl = document.createElement("h2");
  titleEl.textContent = t("settings.title");

  const actions = document.createElement("div");
  actions.className = "nexus-settings-header-actions";

  const resetBtn = document.createElement("button");
  resetBtn.textContent = t("settings.reset");
  resetBtn.title = t("settings.reset");
  resetBtn.addEventListener("click", () => {
    if (confirm(t("settings.resetConfirm"))) {
      const def = defaultSettings();
      Object.assign(settings, def);
      saveSettings(settings);
      onChange(settings);
      backdrop.remove();
      createSettingsPanel(settings, onChange); // 重新创建
    }
  });

  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = "&times;";
  closeBtn.title = t("settings.close");
  closeBtn.style.fontSize = "20px";
  closeBtn.style.width = "32px";
  closeBtn.style.height = "32px";
  closeBtn.addEventListener("click", () => backdrop.remove());

  actions.append(resetBtn, closeBtn);
  header.append(titleEl, actions);

  // Body
  const body = document.createElement("div");
  body.className = "nexus-settings-body";

  const s = { ...settings };
  const emit = () => {
    saveSettings(s);
    onChange(s);
    // 如果语言改变，更新当前语言并重建面板
    if (s.language !== getLanguage()) {
      setLanguage(s.language);
      backdrop.remove();
      createSettingsPanel(s, onChange);
      return;
    }
  };

  // -- Display section --
  body.appendChild(sectionTitle(t("settings.display")));
  body.appendChild(
    row(
      t("settings.colorScheme"),
      t("settings.colorScheme.desc"),
      createSelect(["light", "dark"], s.colorScheme, (v) => {
        s.colorScheme = v as "light" | "dark";
        emit();
      })
    )
  );
  body.appendChild(
    row(
      t("settings.lineNumbers"),
      t("settings.lineNumbers.desc"),
      createToggle(s.lineNumbers, (v) => {
        s.lineNumbers = v;
        emit();
      })
    )
  );
  body.appendChild(
    row(
      t("settings.livePreview"),
      t("settings.livePreview.desc"),
      createToggle(s.livePreview, (v) => {
        s.livePreview = v;
        emit();
      })
    )
  );
  body.appendChild(
    row(
      t("settings.indentGuides"),
      t("settings.indentGuides.desc"),
      createToggle(s.indentGuides, (v) => {
        s.indentGuides = v;
        emit();
      })
    )
  );
  body.appendChild(
    row(
      t("settings.contentMaxWidth"),
      t("settings.contentMaxWidth.desc"),
      createTextInput(s.contentMaxWidth, "e.g. 720px", (v) => {
        s.contentMaxWidth = v;
        emit();
      })
    )
  );
  body.appendChild(
    row(
      t("settings.direction"),
      t("settings.direction.desc"),
      createSelect(["ltr", "rtl"], s.direction, (v) => {
        s.direction = v as "ltr" | "rtl";
        emit();
      })
    )
  );
  // ---- 语言选择 ----
  body.appendChild(
    row(
      t("settings.language"),
      t("settings.language.desc"),
      createSelect(
        ["en", "zh-CN"],
        s.language,
        (v) => {
          s.language = v as Language;
          emit();
        }
      )
    )
  );

  // -- Font section --
  body.appendChild(sectionTitle(t("settings.font")));
  body.appendChild(
    row(
      t("settings.fontSize"),
      t("settings.fontSize.desc"),
      createNumberInput(s.fontSize, 10, 28, 1, (v) => {
        s.fontSize = v;
        emit();
      })
    )
  );
  body.appendChild(
    row(
      t("settings.bodyFont"),
      t("settings.bodyFont.desc"),
      createTextInput(s.fontFamily, "system-ui, sans-serif", (v) => {
        s.fontFamily = v;
        emit();
      })
    )
  );
  body.appendChild(
    row(
      t("settings.codeFont"),
      t("settings.codeFont.desc"),
      createTextInput(s.fontFamilyMono, "ui-monospace, monospace", (v) => {
        s.fontFamilyMono = v;
        emit();
      })
    )
  );

  // -- Behavior section --
  body.appendChild(sectionTitle(t("settings.behavior")));
  body.appendChild(
    row(
      t("settings.tabSize"),
      t("settings.tabSize.desc"),
      createNumberInput(s.tabSize, 1, 8, 1, (v) => {
        s.tabSize = v;
        emit();
      })
    )
  );

  dialog.append(header, body);
  backdrop.appendChild(dialog);

  // Close handlers
  const close = () => backdrop.remove();
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  const enterHandler = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) {
      close();
      document.removeEventListener("keydown", enterHandler);
    }
  };
  document.addEventListener("keydown", enterHandler);

  // Focus first control
  const firstControl = dialog.querySelector("select, input, button");
  if (firstControl) (firstControl as HTMLElement).focus();

  document.body.appendChild(backdrop);

  return {
    element: backdrop,
    destroy() {
      document.removeEventListener("keydown", escHandler);
      document.removeEventListener("keydown", enterHandler);
      close();
    },
  };
}