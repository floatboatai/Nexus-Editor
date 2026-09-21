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
  autoFitWidth: string;

  // Fold
  foldCode: string;
  unfoldCode: string;
  foldHeading: string;
  unfoldHeading: string;

  // Link
  openLink: string;

  // Misc
  codeBlockLabel: string;
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
  autoFitWidth: "Auto-fit width",
  foldCode: "Fold code block",
  unfoldCode: "Unfold code block",
  foldHeading: "Fold section",
  unfoldHeading: "Unfold section",
  openLink: "Open link",
  codeBlockLabel: "Code",
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
  autoFitWidth: "自适应宽度",
  foldCode: "折叠代码块",
  unfoldCode: "展开代码块",
  foldHeading: "折叠章节",
  unfoldHeading: "展开章节",
  openLink: "打开链接",
  codeBlockLabel: "代码",
};

/** Merge a partial locale with English defaults. */
export function resolveLocale(locale?: Partial<NexusLocale>): NexusLocale {
  if (!locale) return enLocale;
  return { ...enLocale, ...locale };
}
