export type Locale = "en" | "zh";

const translations = {
  en: {
    // Toolbar
    "toolbar.vault": "Vault",
    "toolbar.open": "Open",
    "toolbar.save": "Save",
    "toolbar.saveAs": "Save As",
    "toolbar.vault.title": "Open a folder as a vault",
    "toolbar.toggleVault.title": "Toggle vault panel",
    "toolbar.toggleOutline.title": "Toggle outline",
    "toolbar.toggleBacklinks.title": "Toggle backlinks panel",
    "toolbar.search.title": "Search (Ctrl+F)",
    "toolbar.settings.title": "Settings",

    // Status line
    "status.modified": " [modified]",
    "status.untitled": "Untitled",
    "status.words": "words",
    "status.lines": "lines",
    "status.vault": "Vault",
    "status.error": "Error",

    // Vault panel
    "vault.title": "Vault",
    "vault.open.title": "Open vault…",
    "vault.newFile.title": "New file at root",
    "vault.newFolder.title": "New folder at root",
    "vault.empty": "No files",
    "vault.noVaultOpened": "No vault opened. Click 📁 to choose a folder.",
    "vault.vaultEmpty": "Vault is empty. Click + to create a note.",

    // Outline panel
    "outline.title": "Outline",
    "outline.empty": "No headings",

    // Backlinks panel
    "backlinks.title": "Backlinks",
    "backlinks.noActiveFile": "No active file",
    "backlinks.linked": "linked",
    "backlinks.mention": "mention",
    "backlinks.mentions": "mentions",
    "backlinks.scanningUnlinked": "Unlinked mentions — scanning…",
    "backlinks.empty": "(empty)",

    // Search bar
    "search.findPlaceholder": "Find...",
    "search.replacePlaceholder": "Replace...",
    "search.replace": "Replace",
    "search.replaceAll": "All",
    "search.noResults": "0 results",
    "search.resultOf": "/",

    // Settings panel
    "settings.title": "Settings",
    "settings.close": "Close",
    "settings.section.display": "Display",
    "settings.section.font": "Font",
    "settings.section.behavior": "Behavior",
    "settings.colorScheme.label": "Color scheme",
    "settings.colorScheme.desc": "Light or dark theme",
    "settings.lineNumbers.label": "Line numbers",
    "settings.lineNumbers.desc": "Show line numbers in the gutter",
    "settings.livePreview.label": "Live preview",
    "settings.livePreview.desc": "Render markdown in real-time",
    "settings.indentGuides.label": "Indent guides",
    "settings.indentGuides.desc": "Show indentation guide lines",
    "settings.contentMaxWidth.label": "Content max width",
    "settings.contentMaxWidth.desc": "Limit line width for readability (e.g. 720px)",
    "settings.textDirection.label": "Text direction",
    "settings.textDirection.desc": "Left-to-right or right-to-left",
    "settings.fontSize.label": "Font size",
    "settings.fontSize.desc": "Editor text size in pixels",
    "settings.bodyFont.label": "Body font",
    "settings.bodyFont.desc": "Font for prose content",
    "settings.codeFont.label": "Code font",
    "settings.codeFont.desc": "Monospace font for code blocks",
    "settings.tabSize.label": "Tab size",
    "settings.tabSize.desc": "Number of spaces per tab",
    "settings.language.label": "Language",
    "settings.language.desc": "Interface language",
  },
  zh: {
    // Toolbar
    "toolbar.vault": "文库",
    "toolbar.open": "打开",
    "toolbar.save": "保存",
    "toolbar.saveAs": "另存为",
    "toolbar.vault.title": "打开文件夹作为文库",
    "toolbar.toggleVault.title": "切换文库面板",
    "toolbar.toggleOutline.title": "切换大纲",
    "toolbar.toggleBacklinks.title": "切换反向链接面板",
    "toolbar.search.title": "搜索 (Ctrl+F)",
    "toolbar.settings.title": "设置",

    // Status line
    "status.modified": " [已修改]",
    "status.untitled": "未命名",
    "status.words": "字",
    "status.lines": "行",
    "status.vault": "文库",
    "status.error": "错误",

    // Vault panel
    "vault.title": "文库",
    "vault.open.title": "打开文库…",
    "vault.newFile.title": "在根目录新建文件",
    "vault.newFolder.title": "在根目录新建文件夹",
    "vault.empty": "没有文件",
    "vault.noVaultOpened": "未打开文库，点击 📁 选择文件夹。",
    "vault.vaultEmpty": "文库为空，点击 + 创建笔记。",

    // Outline panel
    "outline.title": "大纲",
    "outline.empty": "没有标题",

    // Backlinks panel
    "backlinks.title": "反向链接",
    "backlinks.noActiveFile": "未打开文件",
    "backlinks.linked": "已链接",
    "backlinks.mention": "处提及",
    "backlinks.mentions": "处提及",
    "backlinks.scanningUnlinked": "正在扫描未链接提及…",
    "backlinks.empty": "（空）",

    // Search bar
    "search.findPlaceholder": "查找...",
    "search.replacePlaceholder": "替换...",
    "search.replace": "替换",
    "search.replaceAll": "全部",
    "search.noResults": "无结果",
    "search.resultOf": "/",

    // Settings panel
    "settings.title": "设置",
    "settings.close": "关闭",
    "settings.section.display": "显示",
    "settings.section.font": "字体",
    "settings.section.behavior": "行为",
    "settings.colorScheme.label": "颜色方案",
    "settings.colorScheme.desc": "浅色或深色主题",
    "settings.lineNumbers.label": "行号",
    "settings.lineNumbers.desc": "在行号槽显示行号",
    "settings.livePreview.label": "实时预览",
    "settings.livePreview.desc": "实时渲染 Markdown",
    "settings.indentGuides.label": "缩进参考线",
    "settings.indentGuides.desc": "显示缩进参考线",
    "settings.contentMaxWidth.label": "内容最大宽度",
    "settings.contentMaxWidth.desc": "限制行宽以提升可读性（如 720px）",
    "settings.textDirection.label": "文字方向",
    "settings.textDirection.desc": "从左到右或从右到左",
    "settings.fontSize.label": "字号",
    "settings.fontSize.desc": "编辑器文字大小（像素）",
    "settings.bodyFont.label": "正文字体",
    "settings.bodyFont.desc": "正文内容使用的字体",
    "settings.codeFont.label": "代码字体",
    "settings.codeFont.desc": "代码块使用的等宽字体",
    "settings.tabSize.label": "Tab 宽度",
    "settings.tabSize.desc": "每个 Tab 等于几个空格",
    "settings.language.label": "语言",
    "settings.language.desc": "界面显示语言",
  },
} as const;

export type TranslationKey = keyof typeof translations.en;

let currentLocale: Locale = "en";
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  listeners.forEach((fn) => fn());
}

/** 订阅语言切换事件，返回取消订阅函数。 */
export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 获取当前语言的翻译文本。 */
export function t(key: TranslationKey): string {
  return (translations[currentLocale] as Record<string, string>)[key] ?? key;
}
