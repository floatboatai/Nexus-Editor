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

  // List
  /** Accessible label for list reorder handles. Optional for backward compatibility. */
  reorderListItem?: string;

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

export const enLocale = {
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
  reorderListItem: "Reorder list item",
  foldCode: "Fold code block",
  unfoldCode: "Unfold code block",
  foldHeading: "Fold section",
  unfoldHeading: "Unfold section",
  openLink: "Open link",
  codeBlockLabel: "Code",
} satisfies NexusLocale;

export const zhLocale = {
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
  reorderListItem: "重新排列列表项",
  foldCode: "折叠代码块",
  unfoldCode: "展开代码块",
  foldHeading: "折叠章节",
  unfoldHeading: "展开章节",
  openLink: "打开链接",
  codeBlockLabel: "代码",
} satisfies NexusLocale;

/** Merge a partial locale with English defaults. */
export function resolveLocale(locale?: Partial<NexusLocale>): Required<NexusLocale> {
  if (!locale) return enLocale;
  return {
    ...enLocale,
    ...locale,
    reorderListItem: locale.reorderListItem ?? enLocale.reorderListItem,
  };
}
