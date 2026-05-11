import { lightTheme, darkTheme, type NexusTheme } from "@floatboat/nexus-core";
import { t, subscribeLocale } from "./i18n/runtime";
import type { MessageId } from "./i18n/messages";

export interface EditorSettings {
  /** "light" | "dark" */
  colorScheme: "light" | "dark";
  /** `"system"` follows OS/browser; otherwise a BCP 47 tag (e.g. `en`, `zh-CN`). */
  language: string;
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
    language: "system",
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

const UI_LANGUAGE_VALUES = ["system", "en", "zh-CN", "zh-TW", "ja", "ko", "fr", "de", "es"] as const;

const LANG_VALUE_TO_MSG: Record<string, MessageId> = {
  system: "lang_system",
  en: "lang_en",
  "zh-CN": "lang_zh_cn",
  "zh-TW": "lang_zh_tw",
  ja: "lang_ja",
  ko: "lang_ko",
  fr: "lang_fr",
  de: "lang_de",
  es: "lang_es",
};

function uiLanguageOptions(): { value: string; label: string }[] {
  return UI_LANGUAGE_VALUES.map((value) => ({
    value,
    label: t(LANG_VALUE_TO_MSG[value] ?? "lang_en"),
  }));
}

/** Resolved BCP 47 language tag for `<html lang>` (after applying "system"). */
export function effectiveUiLanguage(settings: EditorSettings): string {
  const raw = String(settings.language ?? "system").trim();
  if (!raw || raw === "system") {
    try {
      return navigator.language || "en";
    } catch {
      return "en";
    }
  }
  return raw;
}

/** Sync `<html lang>` with settings (spellcheck, screen readers, font selection). */
export function applyUiLanguage(settings: EditorSettings): void {
  document.documentElement.lang = effectiveUiLanguage(settings);
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
  width: 520px; max-height: 80vh;
  overflow-y: auto;
  padding: 0;
`;

const HEADER_STYLES = `
  display: flex; align-items: center; justify-content: space-between;
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

function createLabeledSelect(
  options: { value: string; label: string }[],
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const sel = document.createElement("select");
  sel.style.cssText = `
    padding: 4px 8px; border-radius: 6px; font-size: 13px;
    border: 1px solid var(--nexus-border, #ddd);
    background: var(--nexus-bg, #fff);
    color: var(--nexus-text, #24292e);
    cursor: pointer; flex-shrink: 0;
  `;
  for (const { value: v, label } of options) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = label;
    if (v === value) o.selected = true;
    sel.appendChild(o);
  }
  if (!options.some((o) => o.value === value)) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = value;
    o.selected = true;
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

interface I18nPart {
  element: HTMLElement;
  update(): void;
}

function rowI18n(titleId: MessageId, descId: MessageId, control: HTMLElement): I18nPart {
  const el = document.createElement("div");
  el.style.cssText = ROW_STYLES;

  const labelWrap = document.createElement("div");
  labelWrap.style.cssText = LABEL_STYLES;

  const titleEl = document.createElement("div");
  titleEl.style.cssText = LABEL_TITLE_STYLES;

  const descEl = document.createElement("div");
  descEl.style.cssText = LABEL_DESC_STYLES;

  labelWrap.append(titleEl, descEl);
  el.append(labelWrap, control);

  return {
    element: el,
    update() {
      titleEl.textContent = t(titleId);
      descEl.textContent = t(descId);
    },
  };
}

function sectionTitleI18n(id: MessageId): I18nPart {
  const el = document.createElement("div");
  el.style.cssText = SECTION_TITLE_STYLES;
  return {
    element: el,
    update() {
      el.textContent = t(id);
    },
  };
}

export function createSettingsPanel(settings: EditorSettings, onChange: OnChange): SettingsPanelResult {
  const backdrop = document.createElement("div");
  backdrop.style.cssText = PANEL_STYLES;

  const dialog = document.createElement("div");
  dialog.style.cssText = DIALOG_STYLES;

  const header = document.createElement("div");
  header.style.cssText = HEADER_STYLES;
  const titleEl = document.createElement("span");
  const closeBtn = document.createElement("button");
  closeBtn.style.cssText = CLOSE_BTN_STYLES;
  closeBtn.innerHTML = "&times;";
  header.append(titleEl, closeBtn);

  const body = document.createElement("div");
  body.style.cssText = SECTION_STYLES;

  const s = { ...settings };
  const i18nParts: I18nPart[] = [];
  const push = (part: I18nPart) => {
    i18nParts.push(part);
    body.appendChild(part.element);
  };

  const emit = () => { saveSettings(s); onChange(s); };

  push(sectionTitleI18n("settings_section_display"));

  const langSelect = createLabeledSelect(uiLanguageOptions(), String(s.language), (v) => {
    s.language = v;
    emit();
  }) as HTMLSelectElement;
  push(rowI18n("settings_language", "settings_language_desc", langSelect));

  const schemeSelect = createLabeledSelect(
    [
      { value: "light", label: t("settings_scheme_light") },
      { value: "dark", label: t("settings_scheme_dark") },
    ],
    s.colorScheme,
    (v) => { s.colorScheme = v as "light" | "dark"; emit(); },
  ) as HTMLSelectElement;
  push(rowI18n("settings_color_scheme", "settings_color_scheme_desc", schemeSelect));

  push(rowI18n("settings_line_numbers", "settings_line_numbers_desc", createToggle(s.lineNumbers, (v) => { s.lineNumbers = v; emit(); })));
  push(rowI18n("settings_live_preview", "settings_live_preview_desc", createToggle(s.livePreview, (v) => { s.livePreview = v; emit(); })));
  push(rowI18n("settings_indent_guides", "settings_indent_guides_desc", createToggle(s.indentGuides, (v) => { s.indentGuides = v; emit(); })));

  const maxWidthInput = createTextInput(s.contentMaxWidth, t("settings_max_width_ph"), (v) => { s.contentMaxWidth = v; emit(); }) as HTMLInputElement;
  push(rowI18n("settings_max_width", "settings_max_width_desc", maxWidthInput));

  const dirSelect = createLabeledSelect(
    [
      { value: "ltr", label: t("settings_dir_ltr") },
      { value: "rtl", label: t("settings_dir_rtl") },
    ],
    s.direction,
    (v) => { s.direction = v as "ltr" | "rtl"; emit(); },
  ) as HTMLSelectElement;
  push(rowI18n("settings_text_direction", "settings_text_direction_desc", dirSelect));

  push(sectionTitleI18n("settings_section_font"));
  push(rowI18n("settings_font_size", "settings_font_size_desc", createNumberInput(s.fontSize, 10, 28, 1, (v) => { s.fontSize = v; emit(); })));

  const bodyFontInput = createTextInput(s.fontFamily, t("settings_body_font_ph"), (v) => { s.fontFamily = v; emit(); }) as HTMLInputElement;
  push(rowI18n("settings_body_font", "settings_body_font_desc", bodyFontInput));

  const codeFontInput = createTextInput(s.fontFamilyMono, t("settings_code_font_ph"), (v) => { s.fontFamilyMono = v; emit(); }) as HTMLInputElement;
  push(rowI18n("settings_code_font", "settings_code_font_desc", codeFontInput));

  push(sectionTitleI18n("settings_section_behavior"));
  push(rowI18n("settings_tab_size", "settings_tab_size_desc", createNumberInput(s.tabSize, 1, 8, 1, (v) => { s.tabSize = v; emit(); })));

  function syncLangSelectLabels(): void {
    for (let i = 0; i < langSelect.options.length; i++) {
      const o = langSelect.options[i];
      const mid = LANG_VALUE_TO_MSG[o.value];
      if (mid) o.textContent = t(mid);
    }
  }

  function syncSchemeAndDirLabels(): void {
    if (schemeSelect.options[0]) schemeSelect.options[0].textContent = t("settings_scheme_light");
    if (schemeSelect.options[1]) schemeSelect.options[1].textContent = t("settings_scheme_dark");
    if (dirSelect.options[0]) dirSelect.options[0].textContent = t("settings_dir_ltr");
    if (dirSelect.options[1]) dirSelect.options[1].textContent = t("settings_dir_rtl");
  }

  function syncAllText(): void {
    titleEl.textContent = t("settings_title");
    closeBtn.title = t("settings_close_tip");
    for (const p of i18nParts) p.update();
    syncLangSelectLabels();
    syncSchemeAndDirLabels();
    maxWidthInput.placeholder = t("settings_max_width_ph");
    bodyFontInput.placeholder = t("settings_body_font_ph");
    codeFontInput.placeholder = t("settings_code_font_ph");
  }

  syncAllText();
  const unsubLocale = subscribeLocale(syncAllText);

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
      unsubLocale();
      document.removeEventListener("keydown", handleEsc);
      close();
    },
  };
}
