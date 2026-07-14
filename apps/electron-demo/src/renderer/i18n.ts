import type { SearchPluginLabels } from "@floatboat/nexus-plugin-search";
import type { WordCountLabels } from "@floatboat/nexus-plugin-wordcount";

export type AppLanguage = "en" | "zh";
export type LanguagePreference = "system" | AppLanguage;

const LANGUAGE_STORAGE_KEY = "nexus-editor-language";

export function resolveAppLanguage(systemLanguage: string): AppLanguage {
  return systemLanguage.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function resolvePreferredLanguage(
  preference: LanguagePreference,
  systemLanguage: string
): AppLanguage {
  return preference === "system" ? resolveAppLanguage(systemLanguage) : preference;
}

export function loadLanguagePreference(): LanguagePreference {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return stored === "en" || stored === "zh" ? stored : "system";
}

export function saveLanguagePreference(preference: LanguagePreference): void {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
}

const en = {
  appTitle: "Nexus Editor Demo",
  toolbar: {
    vault: "Vault",
    vaultTitle: "Open a folder as a vault",
    open: "Open",
    save: "Save",
    saveAs: "Save As",
    toggleVault: "Toggle vault panel",
    toggleOutline: "Toggle outline",
    toggleBacklinks: "Toggle backlinks panel",
    search: "Search (Ctrl+F)",
    settings: "Settings",
  },
  status: {
    untitled: "Untitled",
    modified: "modified",
    stats: (words: number, lines: number) => `${words} words, ${lines} lines`,
    vault: "Vault",
    error: "Error",
  },
  confirmDiscard: "You have unsaved changes. Discard them and switch files?",
  confirmLanguageChange: "Changing the language reloads the app and discards unsaved changes. Continue?",
  openVaultBeforeWikiLink: "Open a vault before following wiki links.",
  editor: {
    viewSource: "View source",
    viewImageSource: "View image markdown source",
    dragToResize: "Drag to resize",
    imageNotFound: (url: string) => `⚠ image not found: ${url}`,
  },
  searchBar: {
    find: "Find...",
    replace: "Replace...",
    previous: "Previous match",
    next: "Next match",
    replaceButton: "Replace",
    all: "All",
    replaceAll: "Replace all",
    close: "Close (Esc)",
    noResults: "0 results",
  },
  outline: {
    title: "Outline",
    empty: "No headings",
  },
  backlinks: {
    title: "Backlinks",
    emptySnippet: "(empty)",
    noActiveFile: "No active file",
    summaryPending: (linked: number) => `Backlinks · ${linked} linked · … mentions`,
    summary: (linked: number, mentions: number) =>
      `Backlinks · ${linked} linked · ${mentions} mention${mentions === 1 ? "" : "s"}`,
    linked: "Linked mentions",
    noLinked: "No linked mentions",
    unlinked: "Unlinked mentions",
    scanning: "Unlinked mentions — scanning…",
    noUnlinked: "No unlinked mentions",
  },
  vault: {
    title: "Vault",
    open: "Open vault…",
    newFileRoot: "New file at root",
    newFolderRoot: "New folder at root",
    noVault: "No vault opened. Click 📁 to choose a folder.",
    empty: "Vault is empty. Click + to create a note.",
    newFileHere: "New file here",
    newFolderHere: "New folder here",
    openFile: "Open",
    newFileSameFolder: "New file in same folder",
    rename: "Rename",
    delete: "Delete",
    untitledFile: "untitled.md",
    newFolder: "new-folder",
    movedToTrash: (name: string) => `Moved ${name} to Trash`,
  },
  settings: {
    title: "Settings",
    close: "Close",
    display: "Display",
    language: "Interface language",
    languageDescription: "Follow the system language or choose manually",
    languageSystem: "Follow system",
    languageChinese: "中文",
    languageEnglish: "English",
    colorScheme: "Color scheme",
    colorSchemeDescription: "Light or dark theme",
    light: "Light",
    dark: "Dark",
    lineNumbers: "Line numbers",
    lineNumbersDescription: "Show line numbers in the gutter",
    livePreview: "Live preview",
    livePreviewDescription: "Render markdown in real-time",
    indentGuides: "Indent guides",
    indentGuidesDescription: "Show indentation guide lines",
    contentMaxWidth: "Content max width",
    contentMaxWidthDescription: "Limit line width for readability (e.g. 720px)",
    contentMaxWidthPlaceholder: "e.g. 720px",
    textDirection: "Text direction",
    textDirectionDescription: "Left-to-right or right-to-left",
    leftToRight: "Left to right",
    rightToLeft: "Right to left",
    font: "Font",
    fontSize: "Font size",
    fontSizeDescription: "Editor text size in pixels",
    bodyFont: "Body font",
    bodyFontDescription: "Font for prose content",
    codeFont: "Code font",
    codeFontDescription: "Monospace font for code blocks",
    behavior: "Behavior",
    tabSize: "Tab size",
    tabSizeDescription: "Number of spaces per tab",
  },
  toolbarActions: {
    undo: "Undo",
    redo: "Redo",
    link: "Insert link",
    h2: "Heading 2",
    h3: "Heading 3",
    headingMenu: "More headings",
    bold: "Bold",
    italic: "Italic",
    strikethrough: "Strikethrough",
    underline: "Underline",
    inlineCode: "Inline code",
    blockquote: "Blockquote",
    codeBlock: "Code block",
    orderedList: "Ordered list",
    unorderedList: "Unordered list",
    textColor: "Text color",
    highlight: "Highlight",
    image: "Insert image",
    fullscreen: "Fullscreen",
  },
  slashCommands: {
    h1: ["Heading 1", "Big section heading"],
    h2: ["Heading 2", "Medium section heading"],
    h3: ["Heading 3", "Small section heading"],
    bold: ["Bold", "Strong emphasis around the selection"],
    italic: ["Italic", "Italic emphasis around the selection"],
    strikethrough: ["Strikethrough", "Strike through the selection"],
    inlineCode: ["Inline code", "Wrap the selection in backticks"],
    codeBlock: ["Code block", "Insert a fenced code block"],
    blockquote: ["Blockquote", "Quote the current line"],
    ulist: ["Bulleted list", "Start an unordered list"],
    olist: ["Numbered list", "Start an ordered list"],
    link: ["Link", "Insert a markdown link"],
    image: ["Image", "Insert a markdown image"],
    hr: ["Divider", "Insert a horizontal rule"],
  },
} as const;

type MessageShape<T> = {
  readonly [K in keyof T]: T[K] extends (...args: infer Args) => string
    ? (...args: Args) => string
    : T[K] extends readonly [string, string]
      ? readonly [string, string]
      : T[K] extends object
        ? MessageShape<T[K]>
        : string;
};

const zh: MessageShape<typeof en> = {
  appTitle: "Nexus 编辑器演示",
  toolbar: {
    vault: "仓库",
    vaultTitle: "选择一个文件夹作为仓库",
    open: "打开",
    save: "保存",
    saveAs: "另存为",
    toggleVault: "显示或隐藏仓库面板",
    toggleOutline: "显示或隐藏大纲",
    toggleBacklinks: "显示或隐藏反向链接面板",
    search: "搜索（Ctrl+F）",
    settings: "设置",
  },
  status: {
    untitled: "未命名",
    modified: "已修改",
    stats: (words, lines) => `${words} 个词，${lines} 行`,
    vault: "仓库",
    error: "错误",
  },
  confirmDiscard: "当前有未保存的更改，是否放弃更改并切换文件？",
  confirmLanguageChange: "切换语言会刷新应用并放弃未保存的更改，是否继续？",
  openVaultBeforeWikiLink: "请先打开仓库，再访问 Wiki 链接。",
  editor: {
    viewSource: "查看源码",
    viewImageSource: "查看图片 Markdown 源码",
    dragToResize: "拖动调整大小",
    imageNotFound: (url) => `⚠ 找不到图片：${url}`,
  },
  searchBar: {
    find: "查找...",
    replace: "替换...",
    previous: "上一个匹配项",
    next: "下一个匹配项",
    replaceButton: "替换",
    all: "全部",
    replaceAll: "全部替换",
    close: "关闭（Esc）",
    noResults: "0 个结果",
  },
  outline: {
    title: "大纲",
    empty: "没有标题",
  },
  backlinks: {
    title: "反向链接",
    emptySnippet: "（空）",
    noActiveFile: "没有打开的文件",
    summaryPending: (linked) => `反向链接 · ${linked} 个链接 · … 个提及`,
    summary: (linked, mentions) => `反向链接 · ${linked} 个链接 · ${mentions} 个提及`,
    linked: "链接提及",
    noLinked: "没有链接提及",
    unlinked: "未链接提及",
    scanning: "正在扫描未链接提及…",
    noUnlinked: "没有未链接提及",
  },
  vault: {
    title: "仓库",
    open: "打开仓库…",
    newFileRoot: "在根目录新建文件",
    newFolderRoot: "在根目录新建文件夹",
    noVault: "尚未打开仓库。点击 📁 选择文件夹。",
    empty: "仓库为空。点击 + 新建笔记。",
    newFileHere: "在此处新建文件",
    newFolderHere: "在此处新建文件夹",
    openFile: "打开",
    newFileSameFolder: "在同一文件夹新建文件",
    rename: "重命名",
    delete: "删除",
    untitledFile: "未命名.md",
    newFolder: "新建文件夹",
    movedToTrash: (name) => `已将 ${name} 移到废纸篓`,
  },
  settings: {
    title: "设置",
    close: "关闭",
    display: "显示",
    language: "界面语言",
    languageDescription: "跟随系统语言或手动选择",
    languageSystem: "跟随系统",
    languageChinese: "中文",
    languageEnglish: "English",
    colorScheme: "配色方案",
    colorSchemeDescription: "使用浅色或深色主题",
    light: "浅色",
    dark: "深色",
    lineNumbers: "行号",
    lineNumbersDescription: "在编辑器边栏显示行号",
    livePreview: "实时预览",
    livePreviewDescription: "实时渲染 Markdown",
    indentGuides: "缩进参考线",
    indentGuidesDescription: "显示缩进参考线",
    contentMaxWidth: "内容最大宽度",
    contentMaxWidthDescription: "限制行宽以提升可读性（例如 720px）",
    contentMaxWidthPlaceholder: "例如 720px",
    textDirection: "文字方向",
    textDirectionDescription: "从左到右或从右到左",
    leftToRight: "从左到右",
    rightToLeft: "从右到左",
    font: "字体",
    fontSize: "字号",
    fontSizeDescription: "编辑器文字大小（像素）",
    bodyFont: "正文字体",
    bodyFontDescription: "正文内容使用的字体",
    codeFont: "代码字体",
    codeFontDescription: "代码块使用的等宽字体",
    behavior: "行为",
    tabSize: "Tab 宽度",
    tabSizeDescription: "每个 Tab 对应的空格数",
  },
  toolbarActions: {
    undo: "撤销",
    redo: "重做",
    link: "插入链接",
    h2: "二级标题",
    h3: "三级标题",
    headingMenu: "更多标题",
    bold: "粗体",
    italic: "斜体",
    strikethrough: "删除线",
    underline: "下划线",
    inlineCode: "行内代码",
    blockquote: "引用",
    codeBlock: "代码块",
    orderedList: "有序列表",
    unorderedList: "无序列表",
    textColor: "文字颜色",
    highlight: "高亮",
    image: "插入图片",
    fullscreen: "全屏",
  },
  slashCommands: {
    h1: ["一级标题", "插入一级标题"],
    h2: ["二级标题", "插入二级标题"],
    h3: ["三级标题", "插入三级标题"],
    bold: ["粗体", "将选中内容设为粗体"],
    italic: ["斜体", "将选中内容设为斜体"],
    strikethrough: ["删除线", "为选中内容添加删除线"],
    inlineCode: ["行内代码", "用反引号包裹选中内容"],
    codeBlock: ["代码块", "插入围栏代码块"],
    blockquote: ["引用", "将当前行设为引用"],
    ulist: ["无序列表", "开始无序列表"],
    olist: ["有序列表", "开始有序列表"],
    link: ["链接", "插入 Markdown 链接"],
    image: ["图片", "插入 Markdown 图片"],
    hr: ["分隔线", "插入水平分隔线"],
  },
};

export const languagePreference = loadLanguagePreference();
export const language = resolvePreferredLanguage(languagePreference, navigator.language);
export function getMessages(appLanguage: AppLanguage): MessageShape<typeof en> {
  return appLanguage === "zh" ? zh : en;
}

export const messages = getMessages(language);

export const searchPluginLabels: Partial<SearchPluginLabels> = {
  find: messages.searchBar.find,
  replace: messages.searchBar.replace,
  showReplace: language === "zh" ? "显示替换" : "Show replace",
  hideReplace: language === "zh" ? "隐藏替换" : "Hide replace",
  next: messages.searchBar.next,
  previous: messages.searchBar.previous,
  all: messages.searchBar.all,
  matchCase: language === "zh" ? "区分大小写" : "Match case",
  regexp: language === "zh" ? "正则表达式" : "Regexp",
  byWord: language === "zh" ? "全词匹配" : "By word",
  replaceNext: messages.searchBar.replaceButton,
  replaceAll: messages.searchBar.replaceAll,
  close: messages.settings.close,
};

export const wordCountLabels: Partial<WordCountLabels> = {
  words: language === "zh" ? "个词" : "words",
  characters: language === "zh" ? "个字符" : "chars",
  charactersNoSpaces: language === "zh" ? "个字符（不含空格）" : "chars (no spaces)",
  readingTime: language === "zh" ? "分钟阅读" : "min read",
  readingTimeShort: language === "zh" ? "少于 1 分钟阅读" : "< 1 min read",
  selection: language === "zh" ? "已选择" : "Selected",
};
