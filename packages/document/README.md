# @floatboat/nexus-document

按需使用的文档转换、完整静态渲染与离线 HTML。主入口仅提供公共类型、内存附件提供者和限额错误类型，不加载 DOCX/PDF 解析器，不创建界面或 Worker，不保存文件。

## 入口与范围

| 子入口 | 能力 |
| --- | --- |
| `/html` | `convertHtml`：HTML/片段转换为 Markdown，移除活动内容 |
| `/csv` | `convertCsv`：引号、换行、不同列数及显式分隔符；默认首行表头 |
| `/docx` | `convertDocx`：DOCX 结构和内嵌图片，需要可终止 executor |
| `/pdf-text` | `extractPdfText`：按页提取文本，需要可终止 executor，不提供 OCR |
| `/node-worker`、`/browser-worker` | 创建显式、可清理的转换执行器 |
| `/worker-browser` | 预编译独立浏览器 Worker，不应作为主线程模块执行 |
| `/render` | `renderDocument`：输出属于指定 Document 的完整、未挂载 DOM |
| `/export-html` | `exportHtml`：生成 HTML 字符串、UTF-8 字节和诊断，不写文件 |
| `/assets` | `rewriteAssetReferences`：宿主提交附件后重写 Markdown 引用 |
| `/gfm`、`/math`、`/mermaid`、`/runtime` | 显式启用 GFM、MathML、图表和已有 runtime 后处理器 |

HTML/CSV 输入为已解码字符串。字节解码和原编码/EOL 保存策略交给宿主或 text-codec，转换器不重复猜编码。DOCX/PDF 输入为 `Uint8Array`，不会转移或改写调用方缓冲区。

## HTML 与附件

```ts
import { createConversionAssetProvider } from "@floatboat/nexus-document";
import { convertHtml } from "@floatboat/nexus-document/html";
import { exportHtml } from "@floatboat/nexus-document/export-html";

const converted = await convertHtml("<h1>Example</h1><img src='image.png'>", {
  assetProvider: hostAssets,
  sourcePath: "imports/source.html",
  signal,
});
const assets = createConversionAssetProvider(converted, hostAssets);
const artifact = await exportHtml(converted.markdown, {
  title: "Example",
  assetProvider: assets,
  signal,
});
// artifact.bytes 交给宿主下载、上传或授权保存。
```

`ConversionResult` 包含 `markdown`、`assetPlan`、`diagnostics`。每个附件计划项有逻辑 `source`、建议文件名 `suggestedName`、`resource: {bytes, mimeType} | null` 和可选 `originalSource`。逻辑引用只在本次 artifact 中有效，不是文件权限，不应直接写入最终 Markdown 文件。

同一个 `AssetProvider.read(source, options)` 用于导入、预览与导出。内嵌 data 图片/DOCX 图片转为字节；相对图片只能通过调用方提供者读取。转换器默认不下载远程图片、不信任 HTML `base` 标签，也不把绝对路径变成文件读取。缺少字节时保留未解决计划与诊断，而不隐式联网。

宿主应先用已有 FileManager/Vault 能力分配并提交附件，再调用 `rewriteAssetReferences(markdown, { [logicalSource]: relativeDestination })`。未映射或不安全的目标会拒绝；不要在附件失败时把仍有逻辑引用的文档报告为保存成功。内存提供者返回字节副本，不拥有或销毁宿主 fallback 提供者。

## DOCX/PDF 与硬取消

```ts
import { createNodeConversionExecutor } from "@floatboat/nexus-document/node-worker";
import { convertDocx } from "@floatboat/nexus-document/docx";

const executor = createNodeConversionExecutor();
try {
  const result = await convertDocx(bytes, { executor, signal });
  // 消费 result.markdown、result.assetPlan 和 result.diagnostics。
} finally {
  await executor.dispose();
}
```

浏览器使用 `createBrowserConversionExecutor(() => new Worker(workerUrl, {type: "module"}))`；`workerUrl` 应指向发布包的预编译 `/worker-browser` 文件。不要把它重定向到 `src/worker-browser.ts`：部分解析器的浏览器条件导出依赖 DOM，而发布 Worker 已在构建时使用纯数据解码器。Worker 文件和主入口均可由宿主自行托管，不依赖 CDN。

Node PDF 入口要求 Node ≥22.13；项目使用 Node 22 验证。每个重格式任务拥有独立 Worker，取消/超时终止 Worker，`dispose()` 等待所有任务释放。每个 executor 默认最多同时执行两个任务，超额请求明确拒绝；可通过创建选项 `maxConcurrent` 调整。Node `resourceLimits` 限制 JS 堆，但不是操作系统 RSS/ArrayBuffer 的硬上限；ZIP 展开和输入输出还会分别检查字节预算。浏览器没有可移植的 Worker 堆硬上限，不能承诺进程级内存隔离。

DOCX 使用 Mammoth 模块与受限 ZIP 预检，不启用外部文件读取或文档自带 style map，不执行宏。PDF 只提取文本层，不复刻多栏/表格排版；无文字页会诊断，全无文本或需要密码时拒绝并提供 `no-text-layer` / `password-required` 错误代码。可显式传入临时 `password`，不会存储。PDF 内嵌脚本/XFA 不执行，转换 Worker 不授予网络读取。

## 渲染与可替换样式

```ts
import { renderDocument } from "@floatboat/nexus-document/render";
import { createGfmRenderExtension } from "@floatboat/nexus-document/gfm";

const rendered = renderDocument(snapshot, {
  document: targetDocument,
  assetProvider: hostAssets,
  extensions: [createGfmRenderExtension()],
  signal,
});
try {
  await rendered.ready;
  targetContainer.replaceChildren(rendered.element);
  // 完成使用后 await rendered.dispose()。
} catch (error) {
  await rendered.dispose();
  throw error;
}
```

DOM 默认没有应用样式，不依赖 CodeMirror 视口。传入已有快照 AST 时不会再次运行 remark 转换；只给 Markdown 时才运行显式启用的解析扩展。未知扩展节点保留源码并诊断，不能保证任意交互 Widget 都有静态表示。原始 HTML 默认省略，受控 `<br>` 用于保留 CSV 多行单元格。

Wiki 位置映射复用一次解析得到的源码 token，不逐链接重新解析前缀。宿主自定义文本 compiler handler 时优先保留其语义：无法可靠映射的 Wiki 语法保持文本，并给出一次 `unsupported-content` 诊断；不会覆盖宿主 handler。快照或 remark 转换已改变的文本也不会再套用旧源码位置。

`createMathRenderExtension()` 输出 KaTeX 生成的原生 MathML，不隐式加载 CSS/字体。`createMermaidRenderExtension()` 在指定 Document 中准备图表，输出净化 SVG；可替换 `render(source, target, signal)`。Mermaid/DOM 回调采用协作取消，不能强行抢占同步 JS 或不遵守 signal 的回调；硬隔离用于转换 Worker。`createRuntimeRenderExtension(registry)` 适配已有注册表及子资源生命周期，不另建 registry。

渲染扩展属于受信任宿主代码，不是沙箱。DOM 后处理器新增图片时必须用 `data-resource-src` 声明资源，交给统一 AssetProvider 处理，不应直接设置联网 `src`。末尾仍会重新检查资源、严格模式和净化策略，但不能倒过来阻止回调已经自行发出的请求；不以新 iframe 或更换 Document 身份伪装隔离。回调还应遵守 signal，并通过 `addCleanup` 登记自己创建的资源。

`exportHtml` 在没有 DOM 扩展时可直接用于无 DOM 的 Node。启用 Mermaid 或其他 DOM 回调时必须传 `document`。输出使用 CSP、净化后的资源与链接，不残留内部协议、逻辑附件引用或本地文件地址；跨文档双链降为文字，单文档导出不打包其他笔记。缺图默认占位诊断，`strictAssets: true` 可要求失败。

`styles` 是宿主显式提供的 CSS。离线导出会拒绝外部 CSS/import；其中相对字体/图片 URL 通过同一个 AssetProvider 读取并内嵌。不默认附带品牌主题或桌面页面边距。最终 HTML 大小按 UTF-8 编码后的全部字节计算，而非仅计算原始图片。

## 默认限额

输入 16 MiB、输出 32 MiB、单附件 10 MiB、附件总量 24 MiB、ZIP 展开 64 MiB、1000 个 ZIP 条目、200 倍压缩比、200 页 PDF、200000 个节点/CSV 单元格、任务 30 秒；可通过 `limits` 显式调整，数值必须为正安全整数。HTML/CSV 同步解析不能被计时器抢占；限额检查与资源等待支持协作取消，不冒充 Worker 硬取消。

## 可选依赖与验证

DOCX/PDF 对应可选 peer 为 Mammoth 1.12.2、PDF.js 6.3.289；数学为 KaTeX 0.16.45 与 remark-math 6；Mermaid 使用本次验证的 11.17.2。仓库锁定 Mammoth 的 `@xmldom/xmldom` 为 0.8.15；使用方也应确认没有复用较旧的易受影响锁定版本，并按自己的锁文件持续审计。浏览器 Worker 从模块依赖构建，而非使用携带旧依赖的 Mammoth 预捆绑文件。

`build` 生成 ESM、声明和自包含浏览器 Worker；`check:api` 验证发布入口、声明消费者和无 DOM HTML 路径；`smoke:browser` 使用独立临时 Electron profile 和本机回环服务验证真实 DOCX/PDF Worker、附件导出、数学、Mermaid 与取消，结束自动清理，不打开用户文件。运行浏览器 smoke 需要宿主安装 Electron 并允许启动 GUI 进程。
