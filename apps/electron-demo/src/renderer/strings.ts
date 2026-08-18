import type { NexusLocaleCode } from "@floatboat/nexus-core";

/**
 * Demo-app chrome strings (top toolbar, settings panel, search bar, panels).
 * Kept separate from the editor's `NexusLocale` — these are host scaffolding,
 * not editor UI. The language is set once at boot and rebuilt on reload.
 */
export interface DemoStrings {
  appVault: string;
  appOpenVault: string;
  appOpen: string;
  appSave: string;
  appSaveAs: string;
  appToggleVault: string;
  appToggleOutline: string;
  appToggleBacklinks: string;
  appSearch: string;
  appSettings: string;

  settingsTitle: string;
  settingsClose: string;
  settingsDisplay: string;
  settingsFont: string;
  settingsBehavior: string;
  settingsLanguage: string;
  settingsColorScheme: string;
  settingsColorSchemeDesc: string;
  settingsLineNumbers: string;
  settingsLineNumbersDesc: string;
  settingsLivePreview: string;
  settingsLivePreviewDesc: string;
  settingsIndentGuides: string;
  settingsIndentGuidesDesc: string;
  settingsContentMaxWidth: string;
  settingsContentMaxWidthDesc: string;
  settingsTextDirection: string;
  settingsTextDirectionDesc: string;
  settingsFontSize: string;
  settingsFontSizeDesc: string;
  settingsBodyFont: string;
  settingsBodyFontDesc: string;
  settingsCodeFont: string;
  settingsCodeFontDesc: string;
  settingsTabSize: string;
  settingsTabSizeDesc: string;
  settingsLanguageDesc: string;
  settingsLight: string;
  settingsDark: string;
  settingsLtr: string;
  settingsRtl: string;
  settingsEnglish: string;
  settingsChinese: string;
  settingsRuntimeTabName: string;

  searchFind: string;
  searchReplace: string;
  searchPreviousMatch: string;
  searchNextMatch: string;
  searchReplaceButton: string;
  searchReplaceAllButton: string;
  searchReplaceAllTitle: string;
  searchCloseTitle: string;
  searchNoResults: string;

  outlineTitle: string;
  outlineNoHeadings: string;

  backlinksTitle: string;
  backlinksNoActiveFile: string;
  backlinksHeaderFormat: string;
  backlinksLinkedMentions: string;
  backlinksNoLinkedMentions: string;
  backlinksUnlinkedMentions: string;
  backlinksUnlinkedScanning: string;
  backlinksHeaderCompleteFormat: string;
  backlinksNoUnlinkedMentions: string;

  vaultTitle: string;
  vaultOpen: string;
  vaultNewFile: string;
  vaultNewFolder: string;
  vaultOpenLabel: string;
  vaultNoVaultOpen: string;
  vaultEmptyClickPlus: string;
  vaultNewFileHere: string;
  vaultNewFolderHere: string;
  vaultNewFileSameFolder: string;
  vaultRename: string;
  vaultDelete: string;
  vaultMovedToTrash: string;

  imageViewSource: string;
  imageViewSourceAria: string;
  imageDragResize: string;
  imageNotFound: string;

  statusUntitled: string;
  statusModified: string;
  statusStats: string;
  statusVault: string;
  statusError: string;
  confirmDiscardSwitchFiles: string;
  confirmDiscardSwitchLanguage: string;
  promptFileName: string;
  errorOpenVaultBeforeSave: string;
  errorOpenVaultForWikilink: string;
}

const en: DemoStrings = {
  appVault: "Vault",
  appOpenVault: "Open a folder as a vault",
  appOpen: "Open",
  appSave: "Save",
  appSaveAs: "Save As",
  appToggleVault: "Toggle vault panel",
  appToggleOutline: "Toggle outline",
  appToggleBacklinks: "Toggle backlinks panel",
  appSearch: "Search (Ctrl+F)",
  appSettings: "Settings",

  settingsTitle: "Settings",
  settingsClose: "Close",
  settingsDisplay: "Display",
  settingsFont: "Font",
  settingsBehavior: "Behavior",
  settingsLanguage: "Language",
  settingsColorScheme: "Color scheme",
  settingsColorSchemeDesc: "Light or dark theme",
  settingsLineNumbers: "Line numbers",
  settingsLineNumbersDesc: "Show line numbers in the gutter",
  settingsLivePreview: "Live preview",
  settingsLivePreviewDesc: "Render markdown in real-time",
  settingsIndentGuides: "Indent guides",
  settingsIndentGuidesDesc: "Show indentation guide lines",
  settingsContentMaxWidth: "Content max width",
  settingsContentMaxWidthDesc: "Limit line width for readability (e.g. 720px)",
  settingsTextDirection: "Text direction",
  settingsTextDirectionDesc: "Left-to-right or right-to-left",
  settingsFontSize: "Font size",
  settingsFontSizeDesc: "Editor text size in pixels",
  settingsBodyFont: "Body font",
  settingsBodyFontDesc: "Font for prose content",
  settingsCodeFont: "Code font",
  settingsCodeFontDesc: "Monospace font for code blocks",
  settingsTabSize: "Tab size",
  settingsTabSizeDesc: "Number of spaces per tab",
  settingsLanguageDesc: "UI language; reloads the app to apply",
  settingsLight: "Light",
  settingsDark: "Dark",
  settingsLtr: "Left to right",
  settingsRtl: "Right to left",
  settingsEnglish: "English",
  settingsChinese: "中文",
  settingsRuntimeTabName: "Editor settings",

  searchFind: "Find...",
  searchReplace: "Replace...",
  searchPreviousMatch: "Previous match",
  searchNextMatch: "Next match",
  searchReplaceButton: "Replace",
  searchReplaceAllButton: "All",
  searchReplaceAllTitle: "Replace all",
  searchCloseTitle: "Close (Esc)",
  searchNoResults: "0 results",

  outlineTitle: "Outline",
  outlineNoHeadings: "No headings",

  backlinksTitle: "Backlinks",
  backlinksNoActiveFile: "No active file",
  backlinksHeaderFormat: "Backlinks · {linked} linked · … mentions",
  backlinksLinkedMentions: "Linked mentions",
  backlinksNoLinkedMentions: "No linked mentions",
  backlinksUnlinkedMentions: "Unlinked mentions",
  backlinksUnlinkedScanning: "Unlinked mentions — scanning…",
  backlinksHeaderCompleteFormat: "Backlinks · {linked} linked · {unlinked} mentions",
  backlinksNoUnlinkedMentions: "No unlinked mentions",

  vaultTitle: "Vault",
  vaultOpen: "Open vault…",
  vaultNewFile: "New file at root",
  vaultNewFolder: "New folder at root",
  vaultOpenLabel: "Open",
  vaultNoVaultOpen: "No vault opened. Click 📁 to choose a folder.",
  vaultEmptyClickPlus: "Vault is empty. Click + to create a note.",
  vaultNewFileHere: "New file here",
  vaultNewFolderHere: "New folder here",
  vaultNewFileSameFolder: "New file in same folder",
  vaultRename: "Rename",
  vaultDelete: "Delete",
  vaultMovedToTrash: "Moved {name} to Trash",

  imageViewSource: "View source",
  imageViewSourceAria: "View image markdown source",
  imageDragResize: "Drag to resize",
  imageNotFound: "⚠ image not found: {url}",

  statusUntitled: "Untitled",
  statusModified: " [modified]",
  statusStats: " | {words} words, {lines} lines",
  statusVault: " | Vault: {name}",
  statusError: " — Error: {message}",
  confirmDiscardSwitchFiles: "You have unsaved changes. Discard them and switch files?",
  confirmDiscardSwitchLanguage: "You have unsaved changes. Discard them and switch language?",
  promptFileName: "File name",
  errorOpenVaultBeforeSave: "Open a Vault before saving a runtime document",
  errorOpenVaultForWikilink: "Open a vault before following wiki links.",
};

const zh: DemoStrings = {
  appVault: "仓库",
  appOpenVault: "打开文件夹作为仓库",
  appOpen: "打开",
  appSave: "保存",
  appSaveAs: "另存为",
  appToggleVault: "切换仓库面板",
  appToggleOutline: "切换大纲",
  appToggleBacklinks: "切换反向链接面板",
  appSearch: "搜索 (Ctrl+F)",
  appSettings: "设置",

  settingsTitle: "设置",
  settingsClose: "关闭",
  settingsDisplay: "显示",
  settingsFont: "字体",
  settingsBehavior: "行为",
  settingsLanguage: "语言",
  settingsColorScheme: "配色方案",
  settingsColorSchemeDesc: "浅色或深色主题",
  settingsLineNumbers: "行号",
  settingsLineNumbersDesc: "在侧边栏显示行号",
  settingsLivePreview: "实时预览",
  settingsLivePreviewDesc: "实时渲染 Markdown",
  settingsIndentGuides: "缩进参考线",
  settingsIndentGuidesDesc: "显示缩进参考线",
  settingsContentMaxWidth: "内容最大宽度",
  settingsContentMaxWidthDesc: "限制行宽以提升可读性（如 720px）",
  settingsTextDirection: "文字方向",
  settingsTextDirectionDesc: "从左到右或从右到左",
  settingsFontSize: "字体大小",
  settingsFontSizeDesc: "编辑器文字大小（像素）",
  settingsBodyFont: "正文字体",
  settingsBodyFontDesc: "正文内容字体",
  settingsCodeFont: "代码字体",
  settingsCodeFontDesc: "代码块等宽字体",
  settingsTabSize: "制表符宽度",
  settingsTabSizeDesc: "每个制表符对应的空格数",
  settingsLanguageDesc: "界面语言；切换后重新加载生效",
  settingsLight: "浅色",
  settingsDark: "深色",
  settingsLtr: "从左到右",
  settingsRtl: "从右到左",
  settingsEnglish: "English",
  settingsChinese: "中文",
  settingsRuntimeTabName: "编辑器设置",

  searchFind: "查找...",
  searchReplace: "替换...",
  searchPreviousMatch: "上一个匹配",
  searchNextMatch: "下一个匹配",
  searchReplaceButton: "替换",
  searchReplaceAllButton: "全部",
  searchReplaceAllTitle: "全部替换",
  searchCloseTitle: "关闭 (Esc)",
  searchNoResults: "无结果",

  outlineTitle: "大纲",
  outlineNoHeadings: "无标题",

  backlinksTitle: "反向链接",
  backlinksNoActiveFile: "无活动文件",
  backlinksHeaderFormat: "反向链接 · {linked} 条链接 · … 处提及",
  backlinksLinkedMentions: "已链接提及",
  backlinksNoLinkedMentions: "无已链接提及",
  backlinksUnlinkedMentions: "未链接提及",
  backlinksUnlinkedScanning: "未链接提及 — 扫描中…",
  backlinksHeaderCompleteFormat: "反向链接 · {linked} 条链接 · {unlinked} 处提及",
  backlinksNoUnlinkedMentions: "无未链接提及",

  vaultTitle: "仓库",
  vaultOpen: "打开仓库…",
  vaultNewFile: "在根目录新建文件",
  vaultNewFolder: "在根目录新建文件夹",
  vaultOpenLabel: "打开",
  vaultNoVaultOpen: "尚未打开仓库。点击 📁 选择文件夹。",
  vaultEmptyClickPlus: "仓库为空。点击 + 新建笔记。",
  vaultNewFileHere: "在此新建文件",
  vaultNewFolderHere: "在此新建文件夹",
  vaultNewFileSameFolder: "在同一文件夹新建文件",
  vaultRename: "重命名",
  vaultDelete: "删除",
  vaultMovedToTrash: "已将 {name} 移至废纸篓",

  imageViewSource: "查看源码",
  imageViewSourceAria: "查看图片 Markdown 源码",
  imageDragResize: "拖动调整大小",
  imageNotFound: "⚠ 图片未找到：{url}",

  statusUntitled: "未命名",
  statusModified: " [已修改]",
  statusStats: " | {words} 词，{lines} 行",
  statusVault: " | 仓库：{name}",
  statusError: " — 错误：{message}",
  confirmDiscardSwitchFiles: "有未保存的更改。放弃更改并切换文件？",
  confirmDiscardSwitchLanguage: "有未保存的更改。放弃更改并切换语言？",
  promptFileName: "文件名",
  errorOpenVaultBeforeSave: "保存运行时文档前请先打开仓库",
  errorOpenVaultForWikilink: "跳转 Wiki 链接前请先打开仓库。",
};

const DEMO_STRINGS: Record<NexusLocaleCode, DemoStrings> = { en, zh };

let current: NexusLocaleCode = "en";

/** Set the demo-chrome language. Call once at boot before building chrome. */
export function setDemoLanguage(code: NexusLocaleCode): void {
  current = code;
}

/** Current demo-chrome strings. */
export function uiStrings(): DemoStrings {
  return DEMO_STRINGS[current];
}
