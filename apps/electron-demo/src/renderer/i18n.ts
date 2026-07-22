export type Locale = "zh" | "en";

type LocaleListener = (locale: Locale) => void;

const zh: Record<string, string> = {
  // ── Settings panel ──
  "settings.title": "设置",
  "settings.section.display": "显示",
  "settings.colorScheme": "配色方案",
  "settings.colorScheme.desc": "亮色或暗色主题",
  "settings.lineNumbers": "行号",
  "settings.lineNumbers.desc": "在编辑器中显示行号",
  "settings.livePreview": "实时预览",
  "settings.livePreview.desc": "实时渲染 Markdown",
  "settings.indentGuides": "缩进指引线",
  "settings.indentGuides.desc": "显示缩进辅助线",
  "settings.contentMaxWidth": "内容最大宽度",
  "settings.contentMaxWidth.desc": "限制行宽以提高可读性（如 720px）",
  "settings.textDirection": "文字方向",
  "settings.textDirection.desc": "从左到右或从右到左",
  "settings.section.font": "字体",
  "settings.fontSize": "字号",
  "settings.fontSize.desc": "编辑器文字大小（像素）",
  "settings.bodyFont": "正文字体",
  "settings.bodyFont.desc": "正文内容的字体",
  "settings.codeFont": "代码字体",
  "settings.codeFont.desc": "代码块等宽字体",
  "settings.section.behavior": "行为",
  "settings.tabSize": "Tab 大小",
  "settings.tabSize.desc": "每个 Tab 占用的空格数",
  "settings.language": "语言",
  "settings.language.desc": "界面语言",
  "settings.close": "关闭",

  // ── Toolbar ──
  "toolbar.vault": "仓库",
  "toolbar.vault.title": "选择一个文件夹作为仓库",
  "toolbar.open": "打开",
  "toolbar.save": "保存",
  "toolbar.saveAs": "另存为",
  "toolbar.vaultToggle.title": "切换仓库面板",
  "toolbar.outlineToggle.title": "切换大纲",
  "toolbar.backlinksToggle.title": "切换反向链接面板",
  "toolbar.search.title": "搜索（Ctrl+F）",
  "toolbar.settings.title": "设置",

  // ── Status line ──
  "status.modified": " [已修改]",
  "status.untitled": "未命名",
  "status.error": "错误",
  "status.words": "字",
  "status.lines": "行",
  "status.vault": "仓库",

  // ── Search bar ──
  "search.find": "查找...",
  "search.replace": "替换...",
  "search.replaceBtn": "替换",
  "search.allBtn": "全部",
  "search.replaceAll.title": "替换全部",
  "search.close.title": "关闭（Esc）",
  "search.prev.title": "上一个",
  "search.next.title": "下一个",
  "search.results.empty": "0 个结果",
  "search.results.count": "{current} / {total}",

  // ── Vault panel ──
  "vault.title": "仓库",
  "vault.open.title": "打开文件夹",
  "vault.newFile.title": "新建文件",
  "vault.newFolder.title": "新建文件夹",
  "vault.collapseAll.title": "全部折叠",
  "vault.expandAll.title": "全部展开",
  "vault.empty": "打开文件夹以开始",
  "vault.openBtnTitle": "打开仓库…",
  "vault.collapseAllFolders": "折叠所有文件夹",
  "vault.expandAllFolders": "展开所有文件夹",
  "vault.emptyHint": "（空）",
  "vault.context.newFile": "新建文件",

  "vault.context.open": "打开",
  "vault.context.newFileHere": "在此新建文件",
  "vault.context.newFolderHere": "在此新建文件夹",
  "vault.context.newFileSameFolder": "在同目录新建文件",
  "vault.openBtn.title": "新建文件（根目录）",
  "vault.newFolderBtn.title": "新建文件夹（根目录）",
  "vault.collapseAll": "全部折叠",
  "vault.expandAll": "全部展开",
  "vault.context.rename": "重命名",
  "vault.context.delete": "删除",
  "vault.context.moveTo": "移动到...",
  "vault.status.moved": "已将 {name} 移动到 {dest}",
  "vault.status.deleted": "已将 {name} 移到废纸篓",

  // ── Outline panel ──
  "outline.title": "大纲",
  "outline.empty": "无标题",

  // ── Backlinks panel ──
  "backlinks.title": "反向链接",
  "backlinks.header": "反向链接 · {linked} 条显式 · {total} 条引用",
  "backlinks.linkedMentions": "显式引用",
  "backlinks.unlinkedMentions": "隐式引用",
  "backlinks.noLinked": "无显式引用",
  "backlinks.noUnlinked": "无隐式引用",
  "backlinks.noActiveFile": "无活跃文件",
  "backlinks.scanning": "正在扫描隐式引用…",
  "backlinks.emptySnippet": "（空）",
};

const en: Record<string, string> = {
  // ── Settings panel ──
  "settings.title": "Settings",
  "settings.section.display": "Display",
  "settings.colorScheme": "Color scheme",
  "settings.colorScheme.desc": "Light or dark theme",
  "settings.lineNumbers": "Line numbers",
  "settings.lineNumbers.desc": "Show line numbers in the gutter",
  "settings.livePreview": "Live preview",
  "settings.livePreview.desc": "Render markdown in real-time",
  "settings.indentGuides": "Indent guides",
  "settings.indentGuides.desc": "Show indentation guide lines",
  "settings.contentMaxWidth": "Content max width",
  "settings.contentMaxWidth.desc": "Limit line width for readability (e.g. 720px)",
  "settings.textDirection": "Text direction",
  "settings.textDirection.desc": "Left-to-right or right-to-left",
  "settings.section.font": "Font",
  "settings.fontSize": "Font size",
  "settings.fontSize.desc": "Editor text size in pixels",
  "settings.bodyFont": "Body font",
  "settings.bodyFont.desc": "Font for prose content",
  "settings.codeFont": "Code font",
  "settings.codeFont.desc": "Monospace font for code blocks",
  "settings.section.behavior": "Behavior",
  "settings.tabSize": "Tab size",
  "settings.tabSize.desc": "Number of spaces per tab",
  "settings.language": "Language",
  "settings.language.desc": "Interface language",
  "settings.close": "Close",

  // ── Toolbar ──
  "toolbar.vault": "Vault",
  "toolbar.vault.title": "Open a folder as a vault",
  "toolbar.open": "Open",
  "toolbar.save": "Save",
  "toolbar.saveAs": "Save As",
  "toolbar.vaultToggle.title": "Toggle vault panel",
  "toolbar.outlineToggle.title": "Toggle outline",
  "toolbar.backlinksToggle.title": "Toggle backlinks panel",
  "toolbar.search.title": "Search (Ctrl+F)",
  "toolbar.settings.title": "Settings",

  // ── Status line ──
  "status.modified": " [modified]",
  "status.untitled": "Untitled",
  "status.error": "Error",
  "status.words": "words",
  "status.lines": "lines",
  "status.vault": "Vault",

  // ── Search bar ──
  "search.find": "Find...",
  "search.replace": "Replace...",
  "search.replaceBtn": "Replace",
  "search.allBtn": "All",
  "search.replaceAll.title": "Replace all",
  "search.close.title": "Close (Esc)",
  "search.prev.title": "Previous match",
  "search.next.title": "Next match",
  "search.results.empty": "0 results",
  "search.results.count": "{current} / {total}",

  // ── Vault panel ──
  "vault.title": "Vault",
  "vault.open.title": "Open folder",
  "vault.newFile.title": "New file",
  "vault.newFolder.title": "New folder",
  "vault.collapseAll.title": "Collapse all",
  "vault.expandAll.title": "Expand all",
  "vault.empty": "Open a folder to get started",
  "vault.openBtnTitle": "Open vault…",
  "vault.collapseAllFolders": "Collapse all folders",
  "vault.expandAllFolders": "Expand all folders",
  "vault.emptyHint": " (empty)",
  "vault.context.newFile": "New file",

  "vault.context.open": "Open",
  "vault.context.newFileHere": "New file here",
  "vault.context.newFolderHere": "New folder here",
  "vault.context.newFileSameFolder": "New file in same folder",
  "vault.openBtn.title": "New file at root",
  "vault.newFolderBtn.title": "New folder at root",
  "vault.collapseAll": "Collapse all",
  "vault.expandAll": "Expand all",
  "vault.context.rename": "Rename",
  "vault.context.delete": "Delete",
  "vault.context.moveTo": "Move to...",
  "vault.status.moved": "Moved {name} to {dest}",
  "vault.status.deleted": "Moved {name} to Trash",

  // ── Outline panel ──
  "outline.title": "Outline",
  "outline.empty": "No headings",

  // ── Backlinks panel ──
  "backlinks.title": "Backlinks",
  "backlinks.header": "Backlinks · {linked} linked · {total} mentions",
  "backlinks.linkedMentions": "Linked mentions",
  "backlinks.unlinkedMentions": "Unlinked mentions",
  "backlinks.noLinked": "No linked mentions",
  "backlinks.noUnlinked": "No unlinked mentions",
  "backlinks.noActiveFile": "No active file",
  "backlinks.scanning": "Unlinked mentions — scanning…",
  "backlinks.emptySnippet": "(empty)",
};

const dicts: Record<Locale, Record<string, string>> = { zh, en };

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
}

class LocaleManager {
  private locale: Locale;
  private listeners = new Set<LocaleListener>();

  constructor() {
    this.locale = this.detect();
  }

  get(): Locale {
    return this.locale;
  }

  set(locale: Locale): void {
    if (locale === this.locale) return;
    this.locale = locale;
    try {
      localStorage.setItem("nexus-editor-locale", locale);
    } catch { /* ignore */ }
    this.listeners.forEach((fn) => fn(locale));
  }

  t(key: string, params?: Record<string, string | number>): string {
    const text = dicts[this.locale][key];
    if (text === undefined) return key;
    return interpolate(text, params);
  }

  subscribe(fn: LocaleListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private detect(): Locale {
    try {
      const saved = localStorage.getItem("nexus-editor-locale");
      if (saved === "zh" || saved === "en") return saved;
    } catch { /* ignore */ }
    return navigator.language.startsWith("zh") ? "zh" : "en";
  }
}

export const i18n = new LocaleManager();
