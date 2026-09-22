import type { EditorAPI } from "./types";

export interface StandaloneHTMLOptions {
  /** Page title for the HTML `<title>` tag */
  title?: string;
  /** Custom additional CSS styles to inject into `<style>` */
  customStyles?: string;
  /** Whether to include print styles for Save as PDF. Defaults to true. */
  includePrintStyles?: boolean;
}

export interface ExportWordOptions {
  /** Document title */
  title?: string;
}

export interface PrintOptions {
  /** Document title when printing */
  title?: string;
}

const DEFAULT_MARKDOWN_STYLES = `
  :root {
    --text-color: #24292f;
    --bg-color: #ffffff;
    --border-color: #d0d7de;
    --code-bg: #f6f8fa;
    --accent-color: #0969da;
    --quote-border: #d0d7de;
    --quote-color: #57606a;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --text-color: #e6edf3;
      --bg-color: #0d1117;
      --border-color: #30363d;
      --code-bg: #161b22;
      --accent-color: #2f81f7;
      --quote-border: #30363d;
      --quote-color: #8b949e;
    }
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    color: var(--text-color);
    background-color: var(--bg-color);
    max-width: 860px;
    margin: 0 auto;
    padding: 32px 24px;
    word-wrap: break-word;
  }
  h1, h2, h3, h4, h5, h6 {
    margin-top: 24px;
    margin-bottom: 16px;
    font-weight: 600;
    line-height: 1.25;
  }
  h1 { font-size: 2em; border-bottom: 1px solid var(--border-color); padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid var(--border-color); padding-bottom: 0.3em; }
  h3 { font-size: 1.25em; }
  h4 { font-size: 1em; }
  p { margin-top: 0; margin-bottom: 16px; }
  a { color: var(--accent-color); text-decoration: none; }
  a:hover { text-decoration: underline; }
  blockquote {
    margin: 0 0 16px;
    padding: 0 1em;
    color: var(--quote-color);
    border-left: 0.25em solid var(--quote-border);
  }
  ul, ol { margin-top: 0; margin-bottom: 16px; padding-left: 2em; }
  li + li { margin-top: 0.25em; }
  code {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 85%;
    background-color: var(--code-bg);
    padding: 0.2em 0.4em;
    border-radius: 6px;
  }
  pre {
    background-color: var(--code-bg);
    padding: 16px;
    overflow: auto;
    font-size: 85%;
    line-height: 1.45;
    border-radius: 6px;
    margin-top: 0;
    margin-bottom: 16px;
  }
  pre code {
    background: transparent;
    padding: 0;
    border-radius: 0;
    font-size: 100%;
  }
  table {
    border-spacing: 0;
    border-collapse: collapse;
    width: 100%;
    margin-top: 0;
    margin-bottom: 16px;
    display: block;
    overflow: auto;
  }
  table th, table td {
    padding: 6px 13px;
    border: 1px solid var(--border-color);
  }
  table tr:nth-child(2n) {
    background-color: var(--code-bg);
  }
  img {
    max-width: 100%;
    box-sizing: content-box;
  }
  hr {
    height: 0.25em;
    padding: 0;
    margin: 24px 0;
    background-color: var(--border-color);
    border: 0;
  }
`;

const PRINT_STYLES = `
  @media print {
    body {
      max-width: 100%;
      padding: 0;
      color: #000 !important;
      background: #fff !important;
    }
    h1, h2, h3, h4, h5, h6 {
      page-break-after: avoid;
    }
    table, figure, pre {
      page-break-inside: avoid;
    }
  }
`;

/**
 * Exports the current editor document as a standalone, styled HTML document.
 */
export function exportStandaloneHTML(editor: EditorAPI, options: StandaloneHTMLOptions = {}): string {
  const content = editor.exportHTML();
  const title = options.title ?? "Nexus Document";
  const customStyles = options.customStyles ?? "";
  const printStyles = options.includePrintStyles !== false ? PRINT_STYLES : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
${DEFAULT_MARKDOWN_STYLES}
${printStyles}
${customStyles}
  </style>
</head>
<body>
${content}
</body>
</html>`;
}

/**
 * Exports the document in Microsoft Word (.doc) compatible HTML format,
 * which opens seamlessly in Microsoft Word, WPS Office, and Google Docs.
 */
export function exportWordDocument(editor: EditorAPI, options: ExportWordOptions = {}): string {
  const content = editor.exportHTML();
  const title = options.title ?? "Document";

  return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.5;
      color: #333333;
    }
    h1 { font-size: 20pt; font-weight: bold; color: #1f497d; }
    h2 { font-size: 16pt; font-weight: bold; color: #1f497d; }
    h3 { font-size: 13pt; font-weight: bold; color: #1f497d; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 12pt; }
    th, td { border: 1pt solid #b0c4de; padding: 5pt 8pt; }
    th { background-color: #f2f5f9; font-weight: bold; }
    blockquote { border-left: 3pt solid #1f497d; padding-left: 10pt; color: #555555; }
    pre, code { font-family: Consolas, 'Courier New', monospace; font-size: 9.5pt; background-color: #f7f7f7; }
  </style>
</head>
<body>
${content}
</body>
</html>`;
}

/**
 * Triggers the browser/system print dialog for the current document,
 * enabling direct "Save as PDF" with print styling.
 */
export function printDocument(editor: EditorAPI, options: PrintOptions = {}): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const html = exportStandaloneHTML(editor, { title: options.title });
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";
  iframe.style.visibility = "hidden";

  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  try {
    iframe.contentWindow?.focus();
  } catch {}

  setTimeout(() => {
    try {
      iframe.contentWindow?.print();
    } catch {} finally {
      setTimeout(() => iframe.remove(), 1000);
    }
  }, 150);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
