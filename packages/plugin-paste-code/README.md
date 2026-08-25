# @floatboat/nexus-plugin-paste-code

Paste code auto-detection and Markdown conversion plugin for Nexus-Editor.

为 Nexus-Editor 提供粘贴代码自动检测并转换为 Markdown 代码块的功能。

## Features / 功能

- **HTML paste detection** / **HTML 粘贴检测**: Automatically detects `<pre><code>` blocks from HTML clipboard content (e.g., copied from GitHub, Stack Overflow, blogs) and converts them to Markdown fenced code blocks.
  - 自动检测剪贴板 HTML 内容中的 `<pre><code>` 代码块（如从 GitHub、Stack Overflow、博客复制的代码），转换为 Markdown 代码块格式。
- **Language auto-detection** / **语言自动识别**: Extracts language from `class="language-xxx"` or `class="lang-xxx"` attributes, with alias normalization (js→javascript, ts→typescript, py→python, etc.).
  - 从 `class="language-xxx"` 或 `class="lang-xxx"` 属性中自动提取语言，支持别名归一化（js→javascript、ts→typescript、py→python 等）。
- **Plain text code detection** / **纯文本代码检测**: When clipboard has no HTML, attempts to detect if the pasted text is code using keyword and feature matching, with support for 15+ languages.
  - 当剪贴板没有 HTML 格式时，通过关键字和特征匹配尝试检测粘贴的纯文本是否是代码，支持 15+ 种语言。
- **Mixed content support** / **混合内容支持**: Handles text + code mixed pastes, preserving plain text and converting code blocks.
  - 支持文字+代码混合粘贴，保留普通文字，转换代码块。
- **Formatting preservation** / **样式保留**: Optionally preserve formatting (bold, italic, headings, lists, tables, images, blockquotes) when pasting from rich text sources (Tencent Docs, Word, web pages).
  - 可选保留粘贴内容的样式（加粗、斜体、标题、列表、表格、图片、引用块），适用于从腾讯文档、Word、网页等富文本来源粘贴。
- **Configurable** / **可配置**: Options to disable plain text detection, adjust confidence threshold, and hook into the conversion process.
  - 可配置是否启用纯文本检测、置信度阈值，以及转换过程的回调钩子。

## Installation / 安装

```bash
pnpm add @floatboat/nexus-plugin-paste-code
# or
npm install @floatboat/nexus-plugin-paste-code
```

## Usage / 使用

```typescript
import { createEditor } from "@floatboat/nexus-core";
import { createPasteCodePlugin } from "@floatboat/nexus-plugin-paste-code";

const editor = createEditor({
  container: document.getElementById("editor")!,
  plugins: [
    createPasteCodePlugin({
      // Enable plain text code detection (default: true)
      detectPlainText: true,
      // Minimum confidence for plain text detection (default: 0.5)
      plainTextConfidenceThreshold: 0.5,
      // Preserve formatting when pasting from rich text sources (default: false)
      // Supports bold, italic, headings, lists, tables, images, blockquotes
      preserveFormatting: true,
      // Hook to modify or skip conversion
      beforeConvert: (markdown, codeBlocks) => {
        console.log(`Converting ${codeBlocks.length} code blocks`);
        return markdown; // return false to skip conversion
      },
    }),
  ],
});
```

## How it works / 工作原理

### HTML Paste Flow / HTML 粘贴流程

1. Intercept the `paste` event. / 拦截 `paste` 事件。
2. Read HTML from clipboard (`event.clipboardData.getData('text/html')`). / 从剪贴板读取 HTML。
3. Parse HTML with `DOMParser` and find all `<pre>` elements. / 用 `DOMParser` 解析 HTML，找到所有 `<pre>` 元素。
4. Extract language from `<code>` class attribute (`language-xxx`, `lang-xxx`). / 从 `<code>` 的 class 属性提取语言。
5. Decode HTML entities (`&lt;` → `<`, `&amp;` → `&`, etc.). / 反转义 HTML 实体。
6. Convert to Markdown: ` ```lang\ncode\n``` `. / 转换为 Markdown 格式。
7. Insert into editor and consume the event (prevent default paste). / 插入编辑器并消费事件（阻止默认粘贴）。

### Plain Text Detection Flow / 纯文本检测流程

1. If no HTML in clipboard, read plain text. / 如果剪贴板没有 HTML，读取纯文本。
2. Calculate code feature score (braces, semicolons, keywords, etc.). / 计算代码特征分数（括号、分号、关键字等）。
3. Match against 15+ language profiles (JavaScript, Python, Java, Go, Rust, C/C++, Bash, SQL, JSON, YAML, etc.). / 匹配 15+ 种语言特征（JavaScript、Python、Java、Go、Rust、C/C++、Bash、SQL、JSON、YAML 等）。
4. Apply language-specific heuristics (TypeScript `interface`/`type`, PHP `$var`, Bash `do`/`done`/`fi`, Go `package`/`func`, etc.). / 应用语言特有启发式规则（TypeScript 的 `interface`/`type`、PHP 的 `$var`、Bash 的 `do`/`done`/`fi`、Go 的 `package`/`func` 等）。
5. If confidence above threshold, convert to Markdown code block. / 如果置信度高于阈值，转换为 Markdown 代码块。

## API / 接口

### `createPasteCodePlugin(options?)`

Creates a NexusPlugin instance. / 创建 NexusPlugin 实例。

#### Options / 选项

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `detectPlainText` | `boolean` | `true` | Enable plain text code detection. / 是否启用纯文本代码检测。 |
| `plainTextConfidenceThreshold` | `number` | `0.5` | Minimum confidence (0-1) for plain text detection. / 纯文本检测的最低置信度（0-1）。 |
| `preserveFormatting` | `boolean` | `false` | Preserve formatting (bold, italic, headings, lists, tables, images, blockquotes) when pasting HTML. / 粘贴 HTML 时保留样式（加粗、斜体、标题、列表、表格、图片、引用块）。 |
| `beforeConvert` | `(markdown, codeBlocks) => string \| false` | - | Hook called before insertion. Return modified markdown or `false` to skip. / 插入前的回调钩子，返回修改后的 Markdown 或 `false` 跳过转换。 |

### Exported Utilities / 导出的工具函数

- `parseHtmlForCodeBlocks(html): ParseResult` — Parse HTML and extract code blocks. / 解析 HTML 并提取代码块。
- `convertHtmlToMarkdown(html): string` — Convert HTML to Markdown, preserving formatting (bold, italic, headings, lists, tables, images, blockquotes, code blocks). / 将 HTML 转换为 Markdown，保留样式（加粗、斜体、标题、列表、表格、图片、引用块、代码块）。
- `detectCodeLanguage(text): TextDetectionResult` — Detect if text is code and identify language. / 检测文本是否是代码并识别语言。
- `extractLanguageFromClass(className): string \| null` — Extract language from CSS class. / 从 CSS class 提取语言。
- `decodeHtmlEntities(text): string` — Decode HTML entities. / 反转义 HTML 实体。

## Supported Languages / 支持的语言

JavaScript, TypeScript, Python, Java, Go, Rust, C, C++, C#, PHP, Ruby, Swift, Kotlin, Bash, SQL, JSON, YAML, HTML, CSS.

## License / 许可证

MIT
