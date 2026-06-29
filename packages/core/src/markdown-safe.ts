// 文件上传插入 Markdown 链接时的安全编码纯函数（内部使用，不对外导出）。
// label 来自不可信的 file.name —— 需 Markdown 转义，防止闭合 `![…]` 注入兄弟链接。
// url 是宿主 onAssetUpload 的可信返回（如 nexus-vault://）—— 只做结构性百分号编码，
// 绝不检查 / 白名单 scheme，否则会丢掉自定义 scheme 的 URL。

const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

// 转义会破坏 [label](url) 结构的字符（`\` `[` `]` `(` `)` `<` `>`），并剔除控制字符。
// 关键是转义 `]`：阻止 label 提前闭合 `![…]` 注入新的链接目标；转义 `\` 防止反斜杠
// 在 CommonMark 下吃掉后续转义；转义 `<` `>` 防止构成 autolink。
export function escapeMarkdownLabel(s: string): string {
  return s.replace(CONTROL_CHARS, "").replace(/[\\[\]()<>]/g, "\\$&");
}

const DEST_ENCODE: Record<string, string> = {
  "(": "%28",
  ")": "%29",
  "[": "%5B",
  "]": "%5D",
  "<": "%3C",
  ">": "%3E",
  " ": "%20",
  "\\": "%5C",
};

// 仅做结构性百分号编码：转义会破坏 (url) 包裹结构的字符与空格，并剔除控制字符。
// 不检查 scheme —— url 是宿主可信返回，需原样保留自定义 scheme。
export function encodeMarkdownDestination(url: string): string {
  return url.replace(CONTROL_CHARS, "").replace(/[()[\]<> \\]/g, (c) => DEST_ENCODE[c]);
}
