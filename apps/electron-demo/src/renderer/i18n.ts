/**
 * Lightweight i18n for the Electron demo app.
 *
 * Supports English (`en`) and Simplified Chinese (`zh`). The locale is
 * persisted in localStorage and applied live: `setLocale` dispatches a
 * DOM event and every registered binding / listener refreshes, so static
 * labels flip without rebuilding the app.
 */

export type Locale = "en" | "zh";

const STORAGE_KEY = "nexus-locale";
const LOCALE_EVENT = "nexus-locale-change";

type Messages = Record<string, string>;

const en: Messages = {
  // Toolbar
  "toolbar.vault": "Vault",
  "toolbar.vault.title": "Open a folder as a vault",
  "toolbar.open": "Open",
  "toolbar.open.title": "Open a file",
  "toolbar.save": "Save",
  "toolbar.save.title": "Save the current file",
  "toolbar.saveAs": "Save As",
  "toolbar.saveAs.title": "Save the current document to a new file",
  "toolbar.vaultPanel.title": "Toggle vault panel",
  "toolbar.outline.title": "Toggle outline",
  "toolbar.backlinks.title": "Toggle backlinks panel",
  "toolbar.search.title": "Search (Ctrl+F)",
  "toolbar.settings.title": "Settings",
  "toolbar.language.title": "Switch language / 切换语言",

  // Status line
  "status.untitled": "Untitled",
  "status.modified": "[modified]",
  "status.stats": "{words} words, {lines} lines",
  "status.vault": "Vault: {name}",
  "status.error": "— Error: {message}",

  // Dialogs
  "confirm.unsavedChanges": "You have unsaved changes. Discard them and switch files?",
  "prompt.fileName": "File name",
  "error.openVaultFirst": "Open a vault before following wiki links.",
  "error.openVaultBeforeSave": "Open a Vault before saving a runtime document",

  // Vault panel
  "vault.title": "Vault",
  "vault.open.title": "Open vault…",
  "vault.newFile.title": "New file at root",
  "vault.newFolder.title": "New folder at root",
  "vault.empty": "Vault is empty. Click + to create a note.",
  "vault.noVault": "No vault opened. Click 📁 to choose a folder.",
  "vault.menu.newFileHere": "New file here",
  "vault.menu.newFolderHere": "New folder here",
  "vault.menu.newFileSameFolder": "New file in same folder",
  "vault.menu.rename": "Rename",
  "vault.menu.delete": "Delete",

  // Outline panel
  "outline.title": "Outline",
  "outline.noHeadings": "No headings",

  // Backlinks panel
  "backlinks.title": "Backlinks",
  "backlinks.summary": "Backlinks · {linked} linked · {unlinked} mentions",
  "backlinks.linkedMentions": "Linked mentions",
  "backlinks.unlinkedMentions": "Unlinked mentions",
  "backlinks.unlinkedScanning": "Unlinked mentions — scanning…",
  "backlinks.noActiveFile": "No active file",
  "backlinks.noLinked": "No linked mentions",
  "backlinks.noUnlinked": "No unlinked mentions",
  "backlinks.empty": "(empty)",

  // Search bar
  "search.findPlaceholder": "Find...",
  "search.replacePlaceholder": "Replace...",
  "search.prev.title": "Previous match",
  "search.next.title": "Next match",
  "search.replace": "Replace",
  "search.replaceAll": "All",
  "search.replaceAll.title": "Replace all",
  "search.close.title": "Close (Esc)",
  "search.noResults": "0 results",

  // Editor shell
  "shell.viewSource.title": "View source",
  "shell.resize.title": "Drag to resize",
  "shell.imageNotFound": "⚠ image not found: {url}",

  // Settings panel
  "settings.title": "Settings",
  "settings.close.title": "Close",
  "settings.section.display": "Display",
  "settings.section.font": "Font",
  "settings.section.behavior": "Behavior",
  "settings.section.language": "Language",
  "settings.colorScheme": "Color scheme",
  "settings.colorScheme.desc": "Light or dark theme",
  "settings.colorScheme.light": "light",
  "settings.colorScheme.dark": "dark",
  "settings.lineNumbers": "Line numbers",
  "settings.lineNumbers.desc": "Show line numbers in the gutter",
  "settings.livePreview": "Live preview",
  "settings.livePreview.desc": "Render markdown in real-time",
  "settings.indentGuides": "Indent guides",
  "settings.indentGuides.desc": "Show indentation guide lines",
  "settings.contentMaxWidth": "Content max width",
  "settings.contentMaxWidth.desc": "Limit line width for readability (e.g. 720px)",
  "settings.direction": "Text direction",
  "settings.direction.desc": "Left-to-right or right-to-left",
  "settings.direction.ltr": "Left to right",
  "settings.direction.rtl": "Right to left",
  "settings.fontSize": "Font size",
  "settings.fontSize.desc": "Editor text size in pixels",
  "settings.fontFamily": "Body font",
  "settings.fontFamily.desc": "Font for prose content",
  "settings.fontFamilyMono": "Code font",
  "settings.fontFamilyMono.desc": "Monospace font for code blocks",
  "settings.tabSize": "Tab size",
  "settings.tabSize.desc": "Number of spaces per tab",
  "settings.language": "Language",
  "settings.language.desc": "Interface display language",
};

const zh: Messages = {
  // 工具栏
  "toolbar.vault": "仓库",
  "toolbar.vault.title": "打开一个文件夹作为仓库",
  "toolbar.open": "打开",
  "toolbar.open.title": "打开文件",
  "toolbar.save": "保存",
  "toolbar.save.title": "保存当前文件",
  "toolbar.saveAs": "另存为",
  "toolbar.saveAs.title": "将当前文档保存到新文件",
  "toolbar.vaultPanel.title": "显示/隐藏仓库面板",
  "toolbar.outline.title": "显示/隐藏大纲",
  "toolbar.backlinks.title": "显示/隐藏反向链接面板",
  "toolbar.search.title": "搜索 (Ctrl+F)",
  "toolbar.settings.title": "设置",
  "toolbar.language.title": "切换语言 / Switch language",

  // 状态栏
  "status.untitled": "未命名",
  "status.modified": "[已修改]",
  "status.stats": "{words} 词，{lines} 行",
  "status.vault": "仓库：{name}",
  "status.error": "— 错误：{message}",

  // 对话框
  "confirm.unsavedChanges": "有未保存的更改。放弃更改并切换文件吗？",
  "prompt.fileName": "文件名",
  "error.openVaultFirst": "请先打开仓库后再跳转 Wiki 链接。",
  "error.openVaultBeforeSave": "请先打开仓库再保存运行时文档",

  // 仓库面板
  "vault.title": "仓库",
  "vault.open.title": "打开仓库…",
  "vault.newFile.title": "在根目录新建文件",
  "vault.newFolder.title": "在根目录新建文件夹",
  "vault.empty": "仓库是空的。点击 + 创建一篇笔记。",
  "vault.noVault": "尚未打开仓库。点击 📁 选择一个文件夹。",
  "vault.menu.newFileHere": "在此新建文件",
  "vault.menu.newFolderHere": "在此新建文件夹",
  "vault.menu.newFileSameFolder": "在同一文件夹新建文件",
  "vault.menu.rename": "重命名",
  "vault.menu.delete": "删除",

  // 大纲面板
  "outline.title": "大纲",
  "outline.noHeadings": "暂无标题",

  // 反向链接面板
  "backlinks.title": "反向链接",
  "backlinks.summary": "反向链接 · {linked} 条链接 · {unlinked} 处提及",
  "backlinks.linkedMentions": "已链接提及",
  "backlinks.unlinkedMentions": "未链接提及",
  "backlinks.unlinkedScanning": "未链接提及 — 扫描中…",
  "backlinks.noActiveFile": "没有打开的文件",
  "backlinks.noLinked": "暂无已链接提及",
  "backlinks.noUnlinked": "暂无未链接提及",
  "backlinks.empty": "（空）",

  // 搜索栏
  "search.findPlaceholder": "查找...",
  "search.replacePlaceholder": "替换...",
  "search.prev.title": "上一个匹配",
  "search.next.title": "下一个匹配",
  "search.replace": "替换",
  "search.replaceAll": "全部",
  "search.replaceAll.title": "全部替换",
  "search.close.title": "关闭 (Esc)",
  "search.noResults": "0 个结果",

  // 编辑器外壳
  "shell.viewSource.title": "查看源码",
  "shell.resize.title": "拖拽调整大小",
  "shell.imageNotFound": "⚠ 图片未找到：{url}",

  // 设置面板
  "settings.title": "设置",
  "settings.close.title": "关闭",
  "settings.section.display": "显示",
  "settings.section.font": "字体",
  "settings.section.behavior": "行为",
  "settings.section.language": "语言",
  "settings.colorScheme": "配色方案",
  "settings.colorScheme.desc": "浅色或深色主题",
  "settings.colorScheme.light": "浅色",
  "settings.colorScheme.dark": "深色",
  "settings.lineNumbers": "行号",
  "settings.lineNumbers.desc": "在侧边栏显示行号",
  "settings.livePreview": "实时预览",
  "settings.livePreview.desc": "实时渲染 Markdown",
  "settings.indentGuides": "缩进参考线",
  "settings.indentGuides.desc": "显示缩进参考线",
  "settings.contentMaxWidth": "内容最大宽度",
  "settings.contentMaxWidth.desc": "限制行宽以提高可读性（如 720px）",
  "settings.direction": "文本方向",
  "settings.direction.desc": "从左到右或从右到左",
  "settings.direction.ltr": "从左到右",
  "settings.direction.rtl": "从右到左",
  "settings.fontSize": "字号",
  "settings.fontSize.desc": "编辑器文字大小（像素）",
  "settings.fontFamily": "正文字体",
  "settings.fontFamily.desc": "正文内容使用的字体",
  "settings.fontFamilyMono": "代码字体",
  "settings.fontFamilyMono.desc": "代码块使用的等宽字体",
  "settings.tabSize": "缩进宽度",
  "settings.tabSize.desc": "每个制表符的空格数",
  "settings.language": "界面语言",
  "settings.language.desc": "界面显示语言",
};

const messages: Record<Locale, Messages> = { en, zh };

export const AVAILABLE_LOCALES: ReadonlyArray<{ id: Locale; label: string }> = [
  { id: "en", label: "English" },
  { id: "zh", label: "简体中文" },
];

function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "zh";
}

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch { /* ignore */ }
  const language = typeof navigator !== "undefined" ? navigator.language : "en";
  return language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

let currentLocale: Locale = detectLocale();

export function getLocale(): Locale {
  return currentLocale;
}

/** Translate `key` in the active locale, falling back to English, then the key. */
export function t(key: string, params?: Record<string, string | number>): string {
  let text = messages[currentLocale][key] ?? messages.en[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

export function setLocale(locale: Locale): void {
  if (!isLocale(locale) || locale === currentLocale) return;
  currentLocale = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch { /* ignore */ }
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.dispatchEvent(new CustomEvent<Locale>(LOCALE_EVENT, { detail: locale }));
  }
}

export function toggleLocale(): Locale {
  const next: Locale = currentLocale === "en" ? "zh" : "en";
  setLocale(next);
  return next;
}

export function onLocaleChange(callback: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  const handler = () => callback();
  document.addEventListener(LOCALE_EVENT, handler);
  return () => document.removeEventListener(LOCALE_EVENT, handler);
}

/* ── Live bindings ─────────────────────────────────────────────────
   `bindText` / `bindTitle` translate an element now and refresh it on
   every locale change. Disconnected elements are pruned automatically. */

const bindings = new Set<() => void>();

type BindOptions = { readonly params?: Record<string, string | number> };

/** Translate and keep `el.textContent` in sync with the active locale. */
export function bindText(el: HTMLElement, key: string, options?: BindOptions): void {
  const render = () => { el.textContent = t(key, options?.params); };
  const update = () => {
    // Elements may be bound before they are attached; prune only once they
    // have been detached after a previous refresh.
    if (!el.isConnected && bindings.has(update)) {
      bindings.delete(update);
      return;
    }
    render();
  };
  render();
  bindings.add(update);
}

/** Translate and keep `el.title` in sync with the active locale. */
export function bindTitle(el: HTMLElement, key: string): void {
  const render = () => { el.title = t(key); };
  const update = () => {
    if (!el.isConnected && bindings.has(update)) {
      bindings.delete(update);
      return;
    }
    render();
  };
  render();
  bindings.add(update);
}

/** Translate and keep `input.placeholder` in sync with the active locale. */
export function bindPlaceholder(el: HTMLInputElement, key: string): void {
  const render = () => { el.placeholder = t(key); };
  const update = () => {
    if (!el.isConnected && bindings.has(update)) {
      bindings.delete(update);
      return;
    }
    render();
  };
  render();
  bindings.add(update);
}

/** Re-run every live binding; called on locale change. */
export function refreshBindings(): void {
  for (const update of [...bindings]) update();
}

if (typeof document !== "undefined") {
  document.addEventListener(LOCALE_EVENT, () => refreshBindings());
  document.documentElement.lang = currentLocale === "zh" ? "zh-CN" : "en";
}
