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
};

export const ruLocale: NexusLocale = {
  addColumn: "Добавить столбец",
  addRow: "Добавить строку",
  deleteColumn: "Удалить столбец",
  deleteRow: "Удалить строку",
  insertColumnBefore: "Вставить столбец слева",
  insertColumnAfter: "Вставить столбец справа",
  insertRowAbove: "Вставить строку выше",
  insertRowBelow: "Вставить строку ниже",
  alignLeft: "Выровнять по левому краю",
  alignCenter: "По центру",
  alignRight: "Выровнять по правому краю",
  foldCode: "Свернуть блок кода",
  unfoldCode: "Развернуть блок кода",
  foldHeading: "Свернуть раздел",
  unfoldHeading: "Развернуть раздел",
  openLink: "Открыть ссылку",
  codeBlockLabel: "Код",
};

export const jaLocale: NexusLocale = {
  addColumn: "列を追加",
  addRow: "行を追加",
  deleteColumn: "列を削除",
  deleteRow: "行を削除",
  insertColumnBefore: "左に列を挿入",
  insertColumnAfter: "右に列を挿入",
  insertRowAbove: "上に行を挿入",
  insertRowBelow: "下に行を挿入",
  alignLeft: "左揃え",
  alignCenter: "中央揃え",
  alignRight: "右揃え",
  foldCode: "コードブロックを折りたたむ",
  unfoldCode: "コードブロックを展開",
  foldHeading: "セクションを折りたたむ",
  unfoldHeading: "セクションを展開",
  openLink: "リンクを開く",
  codeBlockLabel: "コード",
};

export const koLocale: NexusLocale = {
  addColumn: "열 추가",
  addRow: "행 추가",
  deleteColumn: "열 삭제",
  deleteRow: "행 삭제",
  insertColumnBefore: "왼쪽에 열 삽입",
  insertColumnAfter: "오른쪽에 열 삽입",
  insertRowAbove: "위에 행 삽입",
  insertRowBelow: "아래에 행 삽입",
  alignLeft: "왼쪽 정렬",
  alignCenter: "가운데 정렬",
  alignRight: "오른쪽 정렬",
  foldCode: "코드 블록 접기",
  unfoldCode: "코드 블록 펼치기",
  foldHeading: "섹션 접기",
  unfoldHeading: "섹션 펼치기",
  openLink: "링크 열기",
  codeBlockLabel: "코드",
};

export const idLocale: NexusLocale = {
  addColumn: "Tambahkan kolom",
  addRow: "Tambahkan baris",
  deleteColumn: "Hapus kolom",
  deleteRow: "Hapus baris",
  insertColumnBefore: "Sisipkan kolom di kiri",
  insertColumnAfter: "Sisipkan kolom di kanan",
  insertRowAbove: "Sisipkan baris di atas",
  insertRowBelow: "Sisipkan baris di bawah",
  alignLeft: "Rata kiri",
  alignCenter: "Rata tengah",
  alignRight: "Rata kanan",
  foldCode: "Lipat blok kode",
  unfoldCode: "Buka lipatan blok kode",
  foldHeading: "Lipat bagian",
  unfoldHeading: "Buka lipatan bagian",
  openLink: "Buka tautan",
  codeBlockLabel: "Kode",
};

/** Merge a partial locale with English defaults. */
export function resolveLocale(locale?: Partial<NexusLocale>): NexusLocale {
  if (!locale) return enLocale;
  return { ...enLocale, ...locale };
}
