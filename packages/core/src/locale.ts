/** All user-visible strings in the editor. */
export interface NexusLocale {
  // Table widget
  addColumn: string;
  addRow: string;
  deleteColumn: string;
  deleteRow: string;
  insertColumnBefore: string;
  insertColumnAfter: string;
  insertRowAbove: string;
  insertRowBelow: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;

  // Fold
  foldCode: string;
  unfoldCode: string;
  foldHeading: string;
  unfoldHeading: string;

  // Link
  openLink: string;

  // Misc
  codeBlockLabel: string;

  // Toolbar
  toolbarUndo: string;
  toolbarRedo: string;
  toolbarInsertLink: string;
  toolbarMoreHeadings: string;
  toolbarHeading1: string;
  toolbarHeading2: string;
  toolbarHeading3: string;
  toolbarHeading4: string;
  toolbarHeading5: string;
  toolbarHeading6: string;
  toolbarNormalText: string;
  toolbarBold: string;
  toolbarItalic: string;
  toolbarStrikethrough: string;
  toolbarUnderline: string;
  toolbarInlineCode: string;
  toolbarBlockquote: string;
  toolbarCodeBlock: string;
  toolbarOrderedList: string;
  toolbarUnorderedList: string;
  toolbarTextColor: string;
  toolbarHighlight: string;
  toolbarInsertImage: string;
  toolbarFullscreen: string;

  // Slash menu chrome
  slashMenuLabel: string;
  slashNoMatches: string;

  // Slash commands
  slashHeading1: string;
  slashHeading1Description: string;
  slashHeading2: string;
  slashHeading2Description: string;
  slashHeading3: string;
  slashHeading3Description: string;
  slashBold: string;
  slashBoldDescription: string;
  slashItalic: string;
  slashItalicDescription: string;
  slashStrikethrough: string;
  slashStrikethroughDescription: string;
  slashInlineCode: string;
  slashInlineCodeDescription: string;
  slashCodeBlock: string;
  slashCodeBlockDescription: string;
  slashBlockquote: string;
  slashBlockquoteDescription: string;
  slashBulletedList: string;
  slashBulletedListDescription: string;
  slashNumberedList: string;
  slashNumberedListDescription: string;
  slashLink: string;
  slashLinkDescription: string;
  slashImage: string;
  slashImageDescription: string;
  slashDivider: string;
  slashDividerDescription: string;

  // Math
  mathEditFormula: string;

  // Search
  searchFind: string;
  searchReplace: string;
  searchShowReplace: string;
  searchHideReplace: string;
  searchNext: string;
  searchPrevious: string;
  searchAll: string;
  searchMatchCase: string;
  searchRegexp: string;
  searchByWord: string;
  searchReplaceNext: string;
  searchReplaceAll: string;
  searchClose: string;

  // Word count
  wordcountWords: string;
  wordcountCharacters: string;
  wordcountCharactersNoSpaces: string;
  wordcountReadingTime: string;
  wordcountReadingTimeShort: string;
  wordcountSelection: string;
}

export const enLocale: NexusLocale = {
  addColumn: "Add column",
  addRow: "Add row",
  deleteColumn: "Delete column",
  deleteRow: "Delete row",
  insertColumnBefore: "Insert column before",
  insertColumnAfter: "Insert column after",
  insertRowAbove: "Insert row above",
  insertRowBelow: "Insert row below",
  alignLeft: "Align left",
  alignCenter: "Align center",
  alignRight: "Align right",
  foldCode: "Fold code block",
  unfoldCode: "Unfold code block",
  foldHeading: "Fold section",
  unfoldHeading: "Unfold section",
  openLink: "Open link",
  codeBlockLabel: "Code",

  toolbarUndo: "Undo",
  toolbarRedo: "Redo",
  toolbarInsertLink: "Insert link",
  toolbarMoreHeadings: "More headings",
  toolbarHeading1: "Heading 1",
  toolbarHeading2: "Heading 2",
  toolbarHeading3: "Heading 3",
  toolbarHeading4: "Heading 4",
  toolbarHeading5: "Heading 5",
  toolbarHeading6: "Heading 6",
  toolbarNormalText: "Normal text",
  toolbarBold: "Bold",
  toolbarItalic: "Italic",
  toolbarStrikethrough: "Strikethrough",
  toolbarUnderline: "Underline",
  toolbarInlineCode: "Inline code",
  toolbarBlockquote: "Blockquote",
  toolbarCodeBlock: "Code block",
  toolbarOrderedList: "Ordered list",
  toolbarUnorderedList: "Unordered list",
  toolbarTextColor: "Text color",
  toolbarHighlight: "Highlight",
  toolbarInsertImage: "Insert image",
  toolbarFullscreen: "Fullscreen",

  slashMenuLabel: "Slash commands",
  slashNoMatches: "No matches",

  slashHeading1: "Heading 1",
  slashHeading1Description: "Big section heading",
  slashHeading2: "Heading 2",
  slashHeading2Description: "Medium section heading",
  slashHeading3: "Heading 3",
  slashHeading3Description: "Small section heading",
  slashBold: "Bold",
  slashBoldDescription: "Strong emphasis around the selection",
  slashItalic: "Italic",
  slashItalicDescription: "Italic emphasis around the selection",
  slashStrikethrough: "Strikethrough",
  slashStrikethroughDescription: "Strike through the selection",
  slashInlineCode: "Inline code",
  slashInlineCodeDescription: "Wrap the selection in backticks",
  slashCodeBlock: "Code block",
  slashCodeBlockDescription: "Insert a fenced code block",
  slashBlockquote: "Blockquote",
  slashBlockquoteDescription: "Quote the current line",
  slashBulletedList: "Bulleted list",
  slashBulletedListDescription: "Start an unordered list",
  slashNumberedList: "Numbered list",
  slashNumberedListDescription: "Start an ordered list",
  slashLink: "Link",
  slashLinkDescription: "Insert a markdown link",
  slashImage: "Image",
  slashImageDescription: "Insert a markdown image",
  slashDivider: "Divider",
  slashDividerDescription: "Insert a horizontal rule",

  mathEditFormula: "Edit formula",

  searchFind: "Find",
  searchReplace: "Replace",
  searchShowReplace: "Show replace",
  searchHideReplace: "Hide replace",
  searchNext: "Next",
  searchPrevious: "Previous",
  searchAll: "All",
  searchMatchCase: "Match case",
  searchRegexp: "Regexp",
  searchByWord: "By word",
  searchReplaceNext: "Replace",
  searchReplaceAll: "Replace all",
  searchClose: "Close",

  wordcountWords: "words",
  wordcountCharacters: "chars",
  wordcountCharactersNoSpaces: "chars (no spaces)",
  wordcountReadingTime: "min read",
  wordcountReadingTimeShort: "< 1 min read",
  wordcountSelection: "Selected",
};

export const zhLocale: NexusLocale = {
  addColumn: "添加列",
  addRow: "添加行",
  deleteColumn: "删除列",
  deleteRow: "删除行",
  insertColumnBefore: "在左侧插入列",
  insertColumnAfter: "在右侧插入列",
  insertRowAbove: "在上方插入行",
  insertRowBelow: "在下方插入行",
  alignLeft: "左对齐",
  alignCenter: "居中对齐",
  alignRight: "右对齐",
  foldCode: "折叠代码块",
  unfoldCode: "展开代码块",
  foldHeading: "折叠章节",
  unfoldHeading: "展开章节",
  openLink: "打开链接",
  codeBlockLabel: "代码",

  toolbarUndo: "撤销",
  toolbarRedo: "重做",
  toolbarInsertLink: "插入链接",
  toolbarMoreHeadings: "更多标题",
  toolbarHeading1: "标题 1",
  toolbarHeading2: "标题 2",
  toolbarHeading3: "标题 3",
  toolbarHeading4: "标题 4",
  toolbarHeading5: "标题 5",
  toolbarHeading6: "标题 6",
  toolbarNormalText: "正文",
  toolbarBold: "加粗",
  toolbarItalic: "斜体",
  toolbarStrikethrough: "删除线",
  toolbarUnderline: "下划线",
  toolbarInlineCode: "行内代码",
  toolbarBlockquote: "引用",
  toolbarCodeBlock: "代码块",
  toolbarOrderedList: "有序列表",
  toolbarUnorderedList: "无序列表",
  toolbarTextColor: "文字颜色",
  toolbarHighlight: "高亮",
  toolbarInsertImage: "插入图片",
  toolbarFullscreen: "全屏",

  slashMenuLabel: "斜杠命令",
  slashNoMatches: "无匹配结果",

  slashHeading1: "一级标题",
  slashHeading1Description: "大章节标题",
  slashHeading2: "二级标题",
  slashHeading2Description: "中等章节标题",
  slashHeading3: "三级标题",
  slashHeading3Description: "小章节标题",
  slashBold: "加粗",
  slashBoldDescription: "将选中内容加粗强调",
  slashItalic: "斜体",
  slashItalicDescription: "将选中内容设为斜体",
  slashStrikethrough: "删除线",
  slashStrikethroughDescription: "为选中内容添加删除线",
  slashInlineCode: "行内代码",
  slashInlineCodeDescription: "用反引号包裹选中内容",
  slashCodeBlock: "代码块",
  slashCodeBlockDescription: "插入围栏代码块",
  slashBlockquote: "引用",
  slashBlockquoteDescription: "引用当前行",
  slashBulletedList: "无序列表",
  slashBulletedListDescription: "开始一个无序列表",
  slashNumberedList: "有序列表",
  slashNumberedListDescription: "开始一个有序列表",
  slashLink: "链接",
  slashLinkDescription: "插入 Markdown 链接",
  slashImage: "图片",
  slashImageDescription: "插入 Markdown 图片",
  slashDivider: "分割线",
  slashDividerDescription: "插入水平分割线",

  mathEditFormula: "编辑公式",

  searchFind: "查找",
  searchReplace: "替换",
  searchShowReplace: "显示替换",
  searchHideReplace: "隐藏替换",
  searchNext: "下一个",
  searchPrevious: "上一个",
  searchAll: "全部",
  searchMatchCase: "区分大小写",
  searchRegexp: "正则表达式",
  searchByWord: "整词匹配",
  searchReplaceNext: "替换",
  searchReplaceAll: "全部替换",
  searchClose: "关闭",

  wordcountWords: "词",
  wordcountCharacters: "字符",
  wordcountCharactersNoSpaces: "字符（不含空格）",
  wordcountReadingTime: "分钟阅读",
  wordcountReadingTimeShort: "< 1 分钟阅读",
  wordcountSelection: "已选",
};

/** Supported built-in locales. */
export type NexusLocaleCode = "en" | "zh";

/** Built-in locales keyed by code. */
export const LOCALES: Record<NexusLocaleCode, NexusLocale> = {
  en: enLocale,
  zh: zhLocale,
};

/** Merge a partial locale with English defaults. */
export function resolveLocale(locale?: Partial<NexusLocale>): NexusLocale {
  if (!locale) return enLocale;
  return { ...enLocale, ...locale };
}

// ── Runtime locale store ────────────────────────────────────────────────
// A module-level "current language" so plugin UIs (toolbar, slash menu,
// search, math, word count) can read the same resolved locale without each
// caller threading a `locale` option through every factory. Call
// `setLocale` / `setLocaleCode` before constructing plugins and the editor.

let currentLocale: NexusLocale = enLocale;

/** Return the currently active resolved locale. */
export function getLocale(): NexusLocale {
  return currentLocale;
}

/** Set the active locale (partial overrides merge with English). */
export function setLocale(locale?: Partial<NexusLocale>): NexusLocale {
  currentLocale = resolveLocale(locale);
  return currentLocale;
}

/** Set the active locale from a built-in language code. */
export function setLocaleCode(code: NexusLocaleCode): NexusLocale {
  return setLocale(LOCALES[code]);
}

/**
 * Detect a built-in language code from the runtime environment. Returns
 * `null` when the environment has no `navigator.language` (e.g. SSR) or the
 * detected language has no built-in locale.
 */
export function detectLocaleCode(): NexusLocaleCode | null {
  if (typeof navigator === "undefined" || !navigator.language) return null;
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith("zh")) return "zh";
  if (lang.startsWith("en")) return "en";
  return null;
}
