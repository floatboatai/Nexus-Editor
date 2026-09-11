import type { AssetProvider, AssetResource, EditorAPI } from "@floatboat/nexus-core";
import { createMathPlugin } from "@floatboat/nexus-plugin-math";
import { createTemplateCommandsPlugin } from "@floatboat/nexus-plugin-toolbar";
import {
  LEGACY_ENCODINGS,
  UNICODE_ENCODINGS,
  decodeDocumentBytes,
  encodeDocumentText,
  type DocumentTextFormat,
  type TextEncoding,
} from "@floatboat/nexus-text-codec";
import { legacyTextCodec } from "@floatboat/nexus-text-codec/legacy";
import {
  MemoryDocumentVersionStore,
  diffDocumentText,
  restoreDocumentVersion,
  type DocumentVersionStore,
} from "@floatboat/nexus-document-history";
import { rankNavigationItems } from "@floatboat/nexus-plugin-search/fuzzy";
import {
  SearchController,
  SearchError,
  type SearchDocument,
  type SearchExecutor,
  type SearchHit,
} from "@floatboat/nexus-plugin-search/workspace";
import {
  createDocumentSearchController,
  type DocumentSearchController,
} from "@floatboat/nexus-plugin-search/headless";
import { createBrowserSearchExecutor } from "@floatboat/nexus-plugin-search/browser-worker";
import { createBrowserConversionExecutor } from "@floatboat/nexus-document/browser-worker";
import { convertHtml } from "@floatboat/nexus-document/html";
import { convertCsv } from "@floatboat/nexus-document/csv";
import { convertDocx } from "@floatboat/nexus-document/docx";
import { extractPdfText } from "@floatboat/nexus-document/pdf-text";
import { renderDocument } from "@floatboat/nexus-document/render";
import { exportHtml } from "@floatboat/nexus-document/export-html";
import { createGfmRenderExtension } from "@floatboat/nexus-document/gfm";
import { createMathRenderExtension } from "@floatboat/nexus-document/math";
import { createMermaidRenderExtension } from "@floatboat/nexus-document/mermaid";
import type {
  ConversionExecutor,
  ConversionResult,
  DocumentRenderHandle,
  RenderDocumentOptions,
} from "@floatboat/nexus-document";
import SearchWorker from "@floatboat/nexus-plugin-search/search-worker?worker&inline";
import ConversionWorker from "@floatboat/nexus-document/worker-browser?worker&inline";
import type { PluginHostBridge, PluginVaultNode, PluginVaultSession } from "../shared/plugin-ipc";
import type {
  PublicCapabilitiesBridge,
  PublicDocumentRead,
  PublicDocumentSource,
  PublicImportedFile,
  PublicSaveAsset,
  PublicSearchDocumentInspection,
} from "../shared/public-capabilities-ipc";
import {
  PUBLIC_DOCUMENT_HISTORY_POLICY,
  PUBLIC_DOCUMENT_SEARCH_MAX_BYTES,
} from "../shared/public-capabilities-policy";
import { createEditorShell, type EditorShell } from "./editor-shell";
import { defaultSettings } from "./settings";
import { createState } from "./state";

const INITIAL_MARKDOWN = "# 公共能力演示\n\n这是 Nexus Editor 的公共能力演示。\n\n- 选择 Vault 后可搜索全部 Markdown。\n- 直接粘贴或拖入图片，附件先保存在内存，保存时落盘。\n- HTML / CSV / DOCX / 文本 PDF 导入会新建 Markdown 缓冲区。\n\n| 能力 | 状态 |\n| --- | --- |\n| 有效快照 | 可用 |\n\n公式：$x^2 + y^2$\n";
const DEFAULT_FORMAT: DocumentTextFormat = { encoding: "utf-8", bom: false, eol: "lf" };
const ASSET_LIMIT = 8 * 1024 * 1024;
const ASSET_TOTAL_LIMIT = 32 * 1024 * 1024;
const STATIC_STYLE = "article{max-width:900px;margin:24px auto;padding:0 20px;font:16px/1.6 system-ui;color:#222}img,svg{max-width:100%}pre{white-space:pre-wrap;padding:12px;background:#f5f5f5}table{border-collapse:collapse}th,td{border:1px solid #bbb;padding:6px}blockquote{border-left:3px solid #bbb;padding-left:12px}";

interface BufferedAsset extends PublicSaveAsset {
  readonly operationId?: string;
}
interface BufferContext {
  readonly id: string;
  readonly lifetime: AbortController;
  readonly assets: Map<string, BufferedAsset>;
  readonly uploads: Set<string>;
  readonly memoryHistory: MemoryDocumentVersionStore;
  source: PublicDocumentSource | null;
  assetSource: PublicDocumentSource | null;
  name: string;
  version?: string;
  format: DocumentTextFormat;
  savedFormat: DocumentTextFormat;
  savedContent: string;
  cleanRevision: string;
  formatRevision: number;
}
interface DemoBuffer {
  readonly context: BufferContext;
  readonly shell: EditorShell;
  readonly search: DocumentSearchController;
}

interface ReplacementTicket {
  readonly buffer: DemoBuffer;
  readonly revision: string;
  readonly formatRevision: number;
  readonly signal: AbortSignal;
}

interface PendingEncoding {
  readonly file: PublicImportedFile;
  readonly ticket: ReplacementTicket;
  readonly importing: boolean;
}
type DemoVaultBridge = Pick<PluginHostBridge["vault"], "pick" | "commit" | "close" | "list" | "onChanged">;

interface SearchSourceBinding {
  readonly source: PublicDocumentSource;
  readonly encoding?: TextEncoding;
}

export interface PublicCapabilitiesDemoState {
  readonly name: string;
  readonly source: PublicDocumentSource | null;
  readonly version?: string;
  readonly format: DocumentTextFormat;
  readonly dirty: boolean;
  readonly saving: boolean;
}

export interface PublicCapabilitiesDemoOptions {
  readonly root?: HTMLElement;
  readonly bridge?: PublicCapabilitiesBridge;
  readonly plugins?: { readonly vault: DemoVaultBridge };
  readonly confirmDiscard?: (message: string) => boolean;
  /** Explicit executor seams keep renderer tests independent of real Worker creation. */
  readonly createSearchExecutor?: () => SearchExecutor;
  readonly conversionExecutor?: ConversionExecutor;
  /** The embedding app may coordinate shutdown when this is mounted in its UI. */
  readonly manageShutdown?: boolean;
}

function sourceId(source: PublicDocumentSource): string {
  return source.kind === "selected" ? `selected:${source.id}` : `vault:${source.sessionId}:${source.path}`;
}

function sameFormat(left: DocumentTextFormat, right: DocumentTextFormat): boolean {
  return left.encoding === right.encoding && left.bom === right.bom && left.eol === right.eol;
}

function searchObservation(metadataVersion: string, encoding?: TextEncoding): string {
  return `${metadataVersion}:encoding=${encoding ?? "auto"}`;
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("操作已取消", "AbortError");
}

function markdownFiles(nodes: readonly PluginVaultNode[]): PluginVaultNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === "folder") return markdownFiles(node.children ?? []);
    return /\.md$/i.test(node.path) ? [node] : [];
  });
}

/** A deliberately small host demonstration, not a document workspace or product SDK. */
export class PublicCapabilitiesDemo {
  private readonly root: HTMLElement;
  private readonly bridge: PublicCapabilitiesBridge;
  private readonly plugins?: { readonly vault: DemoVaultBridge };
  private readonly confirmDiscard: (message: string) => boolean;
  private readonly createSearchExecutor: () => SearchExecutor;
  private readonly conversion: ConversionExecutor;
  private readonly workspaceSearch: SearchController;
  private readonly editorHost: HTMLElement;
  private readonly title: HTMLElement;
  private readonly status: HTMLElement;
  private readonly searchStatus: HTMLElement;
  private readonly results: HTMLElement;
  private readonly searchDiagnostics: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly previewDetails: HTMLDetailsElement;
  private readonly encoding: HTMLSelectElement;
  private readonly eol: HTMLSelectElement;
  private readonly bom: HTMLInputElement;
  private readonly query: HTMLInputElement;
  private readonly replacement: HTMLInputElement;
  private readonly regex: HTMLInputElement;
  private readonly historyEnabled: HTMLInputElement;
  private readonly versions: HTMLSelectElement;
  private readonly files: HTMLSelectElement;
  private readonly fileQuery: HTMLInputElement;
  private readonly sourceButtons: HTMLButtonElement[] = [];
  private readonly cleanups: Array<() => void> = [];
  private readonly encodings = new Map<string, TextEncoding>();
  private readonly searchSources = new Map<string, SearchSourceBinding>();
  private readonly searchIssues = new Map<string, string>();
  private metadataUnavailableCount = 0;
  private buffer: DemoBuffer | null = null;
  private vault: PluginVaultSession | null = null;
  private vaultFiles: PluginVaultNode[] = [];
  private operation: AbortController | null = null;
  private pendingEncoding: PendingEncoding | null = null;
  private saving: Promise<void> | null = null;
  private previewHandle: DocumentRenderHandle | null = null;
  private disposed = false;
  private closing = false;
  private installSequence = 0;

  constructor(options: PublicCapabilitiesDemoOptions = {}) {
    const root = options.root ?? document.getElementById("app");
    if (!root) throw new Error("缺少应用根节点");
    const bridge = options.bridge ?? window.nexusPublicCapabilities;
    if (!bridge) throw new Error("公共能力演示未启用");
    this.root = root;
    this.bridge = bridge;
    this.plugins = options.plugins ?? window.nexusPlugins;
    this.confirmDiscard = options.confirmDiscard ?? ((message) => window.confirm(message));
    this.createSearchExecutor = options.createSearchExecutor ?? (() => createBrowserSearchExecutor({
      createWorker: () => new SearchWorker(),
    }));
    this.conversion = options.conversionExecutor ?? createBrowserConversionExecutor(() => new ConversionWorker());
    root.replaceChildren();
    const row = (): HTMLDivElement => {
      const value = this.element("div", "toolbar");
      value.style.flexWrap = "wrap";
      value.style.alignItems = "center";
      root.append(value);
      return value;
    };
    const fileRow = row();
    this.title = this.element("strong");
    fileRow.append(this.title);
    this.sourceButtons.push(this.button(fileRow, "打开 Markdown", () => this.openDocument()));
    this.sourceButtons.push(this.button(fileRow, "选择 Vault", () => this.chooseVault()));
    this.button(fileRow, "保存", () => this.save());
    this.sourceButtons.push(this.button(fileRow, "导入 HTML/CSV/DOCX/PDF", () => this.importDocument()));
    this.button(fileRow, "取消任务", () => this.cancelOperation());
    this.encoding = this.select(fileRow, "文本编码", ["", ...UNICODE_ENCODINGS, ...LEGACY_ENCODINGS]);
    this.encoding.options[0].textContent = "请选择编码";
    this.button(fileRow, "确认读取编码", () => this.confirmEncoding());
    this.bom = this.checkbox(fileRow, "BOM");
    this.eol = this.select(fileRow, "换行", ["lf", "crlf", "cr", "mixed", "none"]);
    const formatChanged = () => {
      if (this.pendingEncoding) return;
      const buffer = this.requireBuffer();
      if (!this.encoding.value) return;
      const encoding = this.encoding.value as TextEncoding;
      if (LEGACY_ENCODINGS.some((value) => value === encoding)) this.bom.checked = false;
      buffer.context.format = {
        encoding,
        bom: this.bom.checked,
        eol: this.eol.value as DocumentTextFormat["eol"],
      };
      buffer.context.formatRevision += 1;
      this.renderStatus();
    };
    this.encoding.addEventListener("change", formatChanged);
    this.bom.addEventListener("change", formatChanged);
    this.eol.addEventListener("change", formatChanged);

    const commandRow = row();
    for (const [label, id] of [
      ["插入表格", "table"],
      ["块公式", "math-block"],
      ["行内公式", "inline-math"],
      ["Mermaid", "mermaid"],
    ]) {
      this.button(commandRow, label, () => {
        if (!this.editor.runCommand(`template:insert-${id}`)) {
          this.notify("当前只读或输入/表格交互尚未结束，未插入模板。");
        }
      });
    }
    this.button(commandRow, "有效快照", () => this.showSnapshot());
    this.button(commandRow, "完整预览", () => this.showPreview());
    this.button(commandRow, "离线 HTML", () => this.exportDocument());
    this.button(commandRow, "授权图片目录", () => this.grantResourceDirectory());
    const assetHint = this.element("span");
    assetHint.textContent = "图片：直接粘贴或拖入编辑器（先存内存，保存时落盘）";
    commandRow.append(assetHint);

    const searchRow = row();
    this.query = this.input(searchRow, "查找内容");
    this.replacement = this.input(searchRow, "替换内容");
    this.regex = this.checkbox(searchRow, "正则");
    this.button(searchRow, "文内查找", () => this.findInDocument());
    this.button(searchRow, "下一个", async () => {
      const result = await this.requireBuffer().search.findNext();
      this.notify(`查找：${result.status}`);
    });
    this.button(searchRow, "全部替换", async () => {
      const buffer = this.requireBuffer();
      const result = await buffer.search.replaceAll(this.replacement.value);
      if (this.current(buffer)) this.notify(`替换：${result.status}（${result.count}）`);
    });
    this.button(searchRow, "跨文档搜索", () => this.searchWorkspace());
    this.button(searchRow, "更多结果", () => this.workspaceSearch.loadMore());
    this.searchStatus = this.element("span");
    searchRow.append(this.searchStatus);
    this.fileQuery = this.input(searchRow, "模糊查找文件");
    this.files = this.select(searchRow, "Vault 文档", []);
    this.fileQuery.addEventListener("input", () => this.renderFiles());
    this.sourceButtons.push(this.button(searchRow, "打开所选文档", () => this.openSelectedFile()));

    const historyRow = row();
    this.historyEnabled = this.checkbox(historyRow, "显式启用保存历史");
    this.versions = this.select(historyRow, "内容版本", []);
    this.button(historyRow, "读取历史", () => this.loadHistory());
    this.button(historyRow, "记录快照", () => this.checkpoint());
    this.button(historyRow, "比较版本", () => this.compareVersion());
    this.button(historyRow, "恢复到缓冲区", () => this.restoreVersion());
    this.historyEnabled.addEventListener("change", () => {
      if (this.historyEnabled.checked) this.run(() => this.loadHistory());
    });
    this.status = this.element("p");
    this.status.setAttribute("role", "status");
    this.status.style.cssText = "padding:6px 12px;white-space:pre-wrap;flex-shrink:0";
    root.append(this.status);
    this.results = this.element("div");
    this.results.setAttribute("aria-label", "跨文档搜索结果");
    this.results.style.cssText = "max-height:160px;overflow:auto;padding:0 12px;flex-shrink:0";
    root.append(this.results);
    this.searchDiagnostics = this.element("div");
    this.searchDiagnostics.setAttribute("aria-label", "跨文档搜索诊断");
    this.searchDiagnostics.setAttribute("aria-live", "polite");
    this.searchDiagnostics.style.cssText = "max-height:80px;overflow:auto;padding:0 12px;white-space:pre-wrap;flex-shrink:0";
    root.append(this.searchDiagnostics);
    this.editorHost = this.element("div", "editor-container");
    root.append(this.editorHost);
    this.previewDetails = this.element("details");
    const summary = this.element("summary");
    summary.textContent = "预览 / 差异输出";
    this.preview = this.element("div");
    this.preview.style.cssText = "max-height:35vh;overflow:auto;padding:12px";
    this.previewDetails.append(summary, this.preview);
    root.append(this.previewDetails);
    this.workspaceSearch = new SearchController({
      executor: this.createSearchExecutor(),
      limits: { maxFileBytes: PUBLIC_DOCUMENT_SEARCH_MAX_BYTES },
      source: {
        list: (signal) => this.listSearchDocuments(signal),
        read: (item, signal) => this.readSearchDocument(item, signal),
      },
    });
    this.cleanups.push(this.workspaceSearch.subscribe((state) => {
      if (this.disposed) return;
      this.results.replaceChildren();
      for (const hit of state.hits) {
        this.button(this.results, `${hit.path}:${hit.line} ${hit.snippet}`, () => this.openSearchHit(hit));
      }
      const skippedFiles = state.skippedFiles + this.metadataUnavailableCount;
      this.searchStatus.textContent = `${state.status} · ${state.hits.length} 个结果 · 跳过 ${skippedFiles} 个文件${state.truncated ? "（已达上限）" : ""}${state.message ? ` · ${state.message}` : ""}`;
    }));
    if (this.plugins) this.cleanups.push(this.plugins.vault.onChanged((event) => {
      if (this.vault?.sessionId !== event.sessionId) return;
      this.workspaceSearch.invalidate();
      this.run(async () => {
        const vault = this.vault;
        if (!vault) return;
        const files = await this.plugins?.vault.list(vault.sessionId);
        if (this.vault === vault && files) {
          this.vaultFiles = markdownFiles(files);
          this.renderFiles();
        }
      });
      // Watcher versions must never rebase an unsaved buffer's CAS token.
    }));
    if (window.nexusHost && options.manageShutdown !== false) {
      this.cleanups.push(window.nexusHost.onShutdown(() => this.run(() => this.requestClose())));
    }
  }

  get editor(): EditorAPI {
    return this.requireBuffer().shell.editor;
  }

  getState(): PublicCapabilitiesDemoState {
    const buffer = this.requireBuffer();
    const context = buffer.context;
    return {
      name: context.name,
      source: context.source ? { ...context.source } : null,
      version: context.version,
      format: { ...context.format },
      dirty: this.dirty(buffer),
      saving: this.saving !== null,
    };
  }

  async start(): Promise<void> {
    await this.installBuffer(INITIAL_MARKDOWN, "功能示例.md", null, undefined, DEFAULT_FORMAT, INITIAL_MARKDOWN);
  }

  private element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = "",
  ): HTMLElementTagNameMap[K] {
    const value = this.root.ownerDocument.createElement(tag);
    value.className = className;
    return value;
  }

  private button(
    parent: HTMLElement,
    label: string,
    action: () => void | Promise<void>,
  ): HTMLButtonElement {
    const value = this.element("button");
    value.type = "button";
    value.textContent = label;
    value.setAttribute("aria-label", label);
    value.addEventListener("click", () => this.run(action));
    parent.append(value);
    return value;
  }

  private input(parent: HTMLElement, label: string): HTMLInputElement {
    const value = this.element("input");
    value.type = "text";
    value.placeholder = label;
    value.setAttribute("aria-label", label);
    parent.append(value);
    return value;
  }

  private select(parent: HTMLElement, label: string, values: readonly string[]): HTMLSelectElement {
    const value = this.element("select");
    value.setAttribute("aria-label", label);
    for (const item of values) {
      const option = this.element("option");
      option.value = item;
      option.textContent = item;
      value.append(option);
    }
    parent.append(value);
    return value;
  }

  private checkbox(parent: HTMLElement, label: string): HTMLInputElement {
    const wrapper = this.element("label");
    const input = this.element("input");
    input.type = "checkbox";
    input.setAttribute("aria-label", label);
    wrapper.append(input, ` ${label}`);
    parent.append(wrapper);
    return input;
  }

  private run(action: () => void | Promise<void>): void {
    if (this.disposed) return;
    void Promise.resolve().then(action).catch((error: unknown) => {
      if (!(error instanceof Error && error.name === "AbortError")) {
        this.notify(error instanceof Error ? error.message : "操作失败");
      }
    });
  }

  private notify(message: string): void {
    if (!this.disposed) this.status.textContent = message;
  }

  private requireBuffer(): DemoBuffer {
    if (this.disposed || !this.buffer) throw new Error("编辑器已关闭");
    return this.buffer;
  }

  private current(buffer: DemoBuffer): boolean {
    return !this.disposed && this.buffer === buffer && !buffer.context.lifetime.signal.aborted;
  }

  private dirty(buffer: DemoBuffer): boolean {
    return buffer.shell.editor.getDocumentRevision?.() !== buffer.context.cleanRevision ||
      !sameFormat(buffer.context.format, buffer.context.savedFormat);
  }

  private renderStatus(): void {
    if (!this.buffer || this.disposed) return;
    this.title.textContent = `${this.buffer.context.name}${this.dirty(this.buffer) ? " ● 未保存" : ""}`;
    for (const button of this.sourceButtons) button.disabled = this.saving !== null;
  }
  private showFormat(format: DocumentTextFormat): void {
    this.encoding.value = format.encoding;
    this.eol.value = format.eol;
    this.bom.checked = format.bom;
  }

  private beginOperation(): AbortSignal {
    this.operation?.abort();
    this.operation = new AbortController();
    this.pendingEncoding = null;
    return this.operation.signal;
  }

  cancelOperation(): void {
    this.operation?.abort();
    this.pendingEncoding = null;
    this.workspaceSearch.cancel();
    this.buffer?.shell.editor.cancelAssetInput?.();
    if (this.buffer) this.showFormat(this.buffer.context.format);
    this.notify(this.saving ? "已取消可取消的读取；已经开始的磁盘写入仍需等待完成。" : "任务已取消。");
  }

  private async ticket(): Promise<ReplacementTicket> {
    if (this.saving) throw new Error("保存尚未完成，请稍后再切换文档。");
    const signal = this.beginOperation();
    const buffer = this.requireBuffer();
    const snapshot = await buffer.shell.editor.captureDocumentSnapshot({ signal });
    if (!this.current(buffer)) throw new DOMException("来源已关闭", "AbortError");
    if ((snapshot.markdown !== buffer.context.savedContent || !sameFormat(buffer.context.format, buffer.context.savedFormat)) &&
      !this.confirmDiscard(`放弃 ${buffer.context.name} 的未保存编辑并切换？`)) {
      throw new DOMException("用户取消", "AbortError");
    }
    return { buffer, revision: snapshot.revision ?? "", formatRevision: buffer.context.formatRevision, signal };
  }

  private assertTicket(ticket: ReplacementTicket): void {
    aborted(ticket.signal);
    if (!this.current(ticket.buffer)) throw new DOMException("来源已关闭", "AbortError");
    if (ticket.buffer.shell.editor.getDocumentRevision?.() !== ticket.revision ||
      ticket.buffer.context.formatRevision !== ticket.formatRevision) {
      throw new Error("等待期间有新的编辑或格式设置，操作未替换当前文档；请重试。");
    }
  }

  private provider(context: BufferContext): AssetProvider {
    return {
      read: async (reference, options) => {
        aborted(context.lifetime.signal);
        aborted(options?.signal);
        const memory = context.assets.get(reference);
        let resource: AssetResource | null = memory
          ? { bytes: memory.bytes.slice(), mimeType: memory.mimeType }
          : null;
        if (!memory && context.assetSource && !/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(reference)) {
          resource = await this.bridge.readAsset(context.assetSource, reference);
        }
        aborted(context.lifetime.signal);
        aborted(options?.signal);
        if (resource && resource.bytes.byteLength > (options?.maxBytes ?? ASSET_LIMIT)) {
          throw new Error("图片超过读取限额");
        }
        return resource;
      },
    };
  }

  private async installBuffer(
    markdown: string,
    name: string,
    source: PublicDocumentSource | null,
    version: string | undefined,
    format: DocumentTextFormat,
    savedContent: string,
    assets: readonly PublicSaveAsset[] = [],
    assetSource = source,
  ): Promise<void> {
    const sequence = ++this.installSequence;
    const previous = this.buffer;
    previous?.context.lifetime.abort();
    const retiringSearch = previous?.search.dispose();
    previous?.shell.destroy();
    previous?.context.assets.clear();
    await this.clearPreview();
    if (this.disposed || sequence !== this.installSequence) throw new DOMException("文档切换已取消", "AbortError");
    this.editorHost.replaceChildren();
    const context: BufferContext = {
      id: crypto.randomUUID(),
      lifetime: new AbortController(),
      assets: new Map(assets.map((asset) => [asset.source, asset])),
      uploads: new Set(),
      memoryHistory: new MemoryDocumentVersionStore(PUBLIC_DOCUMENT_HISTORY_POLICY),
      source,
      assetSource,
      name,
      version,
      format: { ...format },
      savedFormat: { ...format },
      savedContent,
      cleanRevision: "",
      formatRevision: 0,
    };
    const state = createState();
    state.content = markdown;
    const shell = createEditorShell({
      container: this.editorHost,
      state,
      settings: defaultSettings(),
      searchUI: "headless",
      contributionFeatures: { toolbar: false, slashMenu: false, wordCount: false },
      editorContributions: [createMathPlugin(), createTemplateCommandsPlugin()],
      assetProvider: this.provider(context),
      assetInput: {
        managed: true,
        onEvent: (event) => {
          if (event.status === "uploading") {
            context.uploads.add(event.operationId);
          } else if (event.status === "inserted" || event.status === "cancelled" || event.completed === event.total ||
            event.code === "target-changed" || event.code === "read-only" || event.code === "unsupported-target") {
            context.uploads.delete(event.operationId);
          }
          if (event.status === "cancelled" || event.code === "target-changed") {
            for (const [key, asset] of context.assets) {
              if (asset.operationId === event.operationId) context.assets.delete(key);
            }
          }
          if (this.buffer?.context === context) this.notify(`图片输入：${event.status}（${event.completed}/${event.total}）`);
        },
      },
      onAssetUpload: async (file, upload) => {
        aborted(context.lifetime.signal);
        aborted(upload?.signal);
        if (!/^image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml)$/i.test(file.type) || file.size > ASSET_LIMIT) {
          throw new Error("仅支持 8 MiB 以内的图片");
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        aborted(context.lifetime.signal);
        aborted(upload?.signal);
        const total = [...context.assets.values()].reduce((sum, asset) => sum + asset.bytes.byteLength, 0);
        if (bytes.byteLength > ASSET_LIMIT || total + bytes.byteLength > ASSET_TOTAL_LIMIT) {
          throw new Error("内存附件超过限额");
        }
        const key = `nexus-asset:${context.id}/${crypto.randomUUID()}`;
        context.assets.set(key, {
          source: key,
          suggestedName: file.name,
          bytes,
          mimeType: file.type,
          operationId: upload?.operationId,
        });
        return key;
      },
      onStateChange: () => {
        const buffer = this.buffer;
        if (buffer?.context !== context) return;
        this.run(async () => {
          const snapshot = await buffer.shell.editor.captureDocumentSnapshot({ signal: context.lifetime.signal });
          if (this.current(buffer) && snapshot.markdown === context.savedContent) {
            context.cleanRevision = snapshot.revision ?? "";
          }
          this.renderStatus();
        });
      },
    });
    const search = createDocumentSearchController(shell.editor, {
      executor: this.createSearchExecutor(),
      document: { id: context.id, path: name },
    });
    const buffer: DemoBuffer = { context, shell, search };
    this.buffer = buffer;
    context.cleanRevision = markdown === savedContent ? shell.editor.getDocumentRevision?.() ?? "" : "unsaved";
    const input = () => {
      if (this.current(buffer)) {
        this.renderStatus();
        this.workspaceSearch.invalidate();
      }
    };
    this.editorHost.addEventListener("input", input);
    const update = shell.editor.getContributionSink().registerUpdateListener("public-demo:dirty", input);
    const unsubscribe = search.subscribe((searchState) => {
      if (this.current(buffer)) this.searchStatus.textContent = `文内：${searchState.status} · ${searchState.hits.length} 个结果`;
    });
    context.lifetime.signal.addEventListener("abort", () => {
      this.editorHost.removeEventListener("input", input);
      unsubscribe();
      void update.dispose().catch(() => undefined);
    }, { once: true });
    this.versions.replaceChildren();
    this.pendingEncoding = null;
    this.showFormat(format);
    this.renderStatus();
    await Promise.all([retiringSearch, search.ready]);
    if (!this.current(buffer)) throw new DOMException("文档已关闭", "AbortError");
  }

  async openDocument(source?: PublicDocumentSource): Promise<void> {
    const ticket = await this.ticket();
    const file = source ? { source, name: "Markdown", bytes: new Uint8Array(), version: "" } : await this.bridge.pickImport();
    if (!file) return;
    this.assertTicket(ticket);
    if (!source && !/\.(?:md|markdown|txt)$/i.test(file.name)) throw new Error("请用导入按钮转换非 Markdown 文档。");
    await this.finishRead(file, ticket, false);
  }
  async importDocument(): Promise<void> {
    const ticket = await this.ticket();
    const file = await this.bridge.pickImport();
    if (!file) return;
    this.assertTicket(ticket);
    await this.finishRead(file, ticket, true);
  }
  private async finishRead(file: PublicImportedFile, ticket: ReplacementTicket, importing: boolean, encoding?: TextEncoding): Promise<void> {
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    if (importing && (extension === "docx" || extension === "pdf")) {
      const conversion = extension === "docx"
        ? await convertDocx(file.bytes, { executor: this.conversion, signal: ticket.signal })
        : await extractPdfText(file.bytes, { executor: this.conversion, signal: ticket.signal });
      await this.installConversion(file, conversion, ticket);
      return;
    }
    const read: PublicDocumentRead = importing
      ? { ...decodeDocumentBytes(file.bytes, { encoding, legacyCodec: legacyTextCodec }), name: file.name, version: file.version }
      : await this.bridge.readDocument(file.source, encoding ?? this.encodings.get(sourceId(file.source)));
    this.assertTicket(ticket);
    if (read.status === "needs-encoding") {
      this.pendingEncoding = { file, ticket, importing };
      this.encoding.value = "";
      this.notify(`需要明确选择编码，再点击“确认读取编码”。候选：${read.candidates.join("、")}；不会自动选第一个。`);
      return;
    }
    if (encoding) this.encodings.set(sourceId(file.source), encoding);
    if (!importing) {
      await this.installBuffer(read.text, read.name, { ...file.source }, read.version, read.format, read.text);
      this.notify(`已打开 ${read.name}；保存使用原始字节版本。`);
      return;
    }
    let conversion: ConversionResult;
    if (extension === "html" || extension === "htm") {
      if (/<img\b/i.test(read.text) && this.confirmDiscard("此 HTML 包含图片。是否显式授权图片资源目录？取消可继续导入，但未授权图片会显示缺失诊断。")) {
        await this.bridge.grantResourceDirectory(file.source);
        this.assertTicket(ticket);
      }
      conversion = await convertHtml(read.text, {
        signal: ticket.signal,
        documentId: crypto.randomUUID(),
        assetProvider: {
          read: async (reference, options) => {
            aborted(options?.signal);
            const resource = await this.bridge.readAsset(file.source, reference);
            aborted(options?.signal);
            return resource;
          },
        },
      });
    } else if (extension === "csv") {
      conversion = await convertCsv(read.text, { signal: ticket.signal });
    } else {
      throw new Error("支持 HTML、CSV、DOCX 和带文本层的 PDF；旧二进制 Office 与 OCR 不在本演示范围。");
    }
    await this.installConversion(file, conversion, ticket);
  }
  async confirmEncoding(): Promise<void> {
    const pending = this.pendingEncoding;
    if (!pending || !this.encoding.value) {
      this.notify("没有待读取文件，或尚未选择编码。");
      return;
    }
    this.assertTicket(pending.ticket);
    await this.finishRead(pending.file, pending.ticket, pending.importing, this.encoding.value as TextEncoding);
  }
  private async installConversion(file: PublicImportedFile, result: ConversionResult, ticket: ReplacementTicket): Promise<void> {
    this.assertTicket(ticket);
    if (!result.markdown.trim() && result.diagnostics.some((item) => item.code === "no-text-layer" || item.code === "password-required")) {
      throw new Error(result.diagnostics.map((item) => item.message).join("\n"));
    }
    const assets = result.assetPlan.flatMap((entry) => entry.resource ? [{ source: entry.source, suggestedName: entry.suggestedName, ...entry.resource }] : []);
    await this.installBuffer(result.markdown, file.name.replace(/\.[^.]+$/, ".md"), null, undefined, DEFAULT_FORMAT, "", assets, file.source);
    this.notify(`导入为新的未保存 Markdown，不会覆盖 ${file.name}。${result.diagnostics.length ? `\n${result.diagnostics.map((item) => item.message).join("\n")}` : ""}`);
  }

  save(): Promise<void> {
    if (this.saving) return this.saving;
    const buffer = this.requireBuffer();
    const context = buffer.context;
    const source = context.source ? { ...context.source } : null;
    const version = context.version;
    const format = { ...context.format };
    const formatRevision = context.formatRevision;
    const history = this.historyEnabled.checked;
    const name = context.name;
    const signal = this.beginOperation();
    this.saving = (async () => {
      const snapshot = await buffer.shell.editor.captureDocumentSnapshot({ signal });
      aborted(signal);
      if (!this.current(buffer)) throw new DOMException("来源已关闭", "AbortError");
      // Validate encoding before asking the host to create a target or write attachments.
      encodeDocumentText(snapshot.markdown, { format, legacyCodec: legacyTextCodec });
      const assets = [...context.assets.values()].filter((asset) => snapshot.markdown.includes(asset.source))
        .map(({ source, suggestedName, bytes, mimeType }) => ({ source, suggestedName, bytes: bytes.slice(), mimeType }));
      const saved = await this.bridge.saveDocument({ source, name, markdown: snapshot.markdown, format, expectedVersion: version, assets, history });
      if (!saved || !this.current(buffer)) {
        if (!saved && this.current(buffer)) this.notify("已取消保存。");
        return;
      }
      const unchanged = buffer.shell.editor.getDocumentRevision?.() === snapshot.revision;
      let synchronized = unchanged && saved.markdown === snapshot.markdown;
      if (unchanged && saved.markdown !== snapshot.markdown && context.uploads.size === 0) {
        buffer.shell.editor.setDocument(saved.markdown, { silent: true, preserveSelection: true });
        synchronized = true;
      }
      context.source = { ...saved.source };
      context.assetSource = context.source;
      context.name = saved.name;
      context.version = saved.version;
      context.savedContent = saved.markdown;
      context.savedFormat = { ...saved.format };
      if (context.formatRevision === formatRevision) {
        context.format = { ...saved.format };
        this.showFormat(context.format);
      }
      if (synchronized) context.cleanRevision = buffer.shell.editor.getDocumentRevision?.() ?? "";
      else if (unchanged) context.cleanRevision = "pending-resource-rewrite";
      this.workspaceSearch.invalidate();
      this.renderStatus();
      let warning = saved.historyWarning;
      if (history && this.historyEnabled.checked) {
        try {
          await this.loadHistory();
        } catch (error) {
          warning = [warning, error instanceof Error ? error.message : "历史刷新失败"].filter(Boolean).join("；");
        }
      }
      if (this.current(buffer)) this.notify(`已保存捕获版本${synchronized ? "" : "；当前缓冲区仍有未保存输入或资源引用"}。${warning ? `\n历史记录警告：${warning}` : ""}`);
    })().finally(() => {
      this.saving = null;
      this.renderStatus();
    });
    this.renderStatus();
    return this.saving;
  }

  async chooseVault(): Promise<void> {
    if (!this.plugins) throw new Error("当前宿主没有 Vault capability");
    const ticket = await this.ticket();
    const selected = await this.plugins.vault.pick();
    if (!selected) return;
    let committed = false;
    try {
      const nodes = await this.plugins.vault.list(selected.sessionId);
      this.assertTicket(ticket);
      await this.plugins.vault.commit(selected.sessionId);
      this.assertTicket(ticket);
      const previous = this.vault;
      this.vault = selected;
      this.vaultFiles = markdownFiles(nodes);
      committed = true;
      await this.installBuffer("", "未命名.md", null, undefined, DEFAULT_FORMAT, "");
      this.workspaceSearch.cancel();
      this.renderFiles();
      if (previous && previous.sessionId !== selected.sessionId) await this.plugins.vault.close(previous.sessionId);
      this.notify(`已授权 Vault：${selected.name}（${this.vaultFiles.length} 个 Markdown）。`);
    } finally {
      if (!committed) await this.plugins.vault.close(selected.sessionId);
    }
  }
  async grantResourceDirectory(): Promise<void> {
    const buffer = this.requireBuffer();
    const source = buffer.context.assetSource ?? buffer.context.source;
    if (!source) throw new Error("请先打开或导入一个文件；内存图片无需目录授权。");
    const granted = await this.bridge.grantResourceDirectory(source);
    if (this.current(buffer)) this.notify(granted ? "已授权资源读取；请重新生成完整预览。" : "未授予资源目录权限。");
  }
  private renderFiles(): void {
    const previous = this.files.value;
    const ranked = rankNavigationItems(this.vaultFiles.map((file) => ({ title: file.name, detail: file.path, path: file.path })), this.fileQuery.value);
    this.files.replaceChildren();
    for (const file of ranked) {
      const option = this.element("option");
      option.value = file.path;
      option.textContent = file.path;
      this.files.append(option);
    }
    if (ranked.some((file) => file.path === previous)) this.files.value = previous;
  }
  async openSelectedFile(): Promise<void> {
    if (!this.vault || !this.files.value) throw new Error("请先选择 Vault 和文档");
    await this.openDocument({ kind: "vault", sessionId: this.vault.sessionId, path: this.files.value });
  }
  async findInDocument(): Promise<void> {
    const buffer = this.requireBuffer();
    buffer.search.open();
    await buffer.search.setQuery({ text: this.query.value, regex: this.regex.checked });
  }
  async searchWorkspace(): Promise<void> {
    if (!this.vault) throw new Error("请选择 Vault，跨文档搜索不会扫描未授权目录。");
    await this.workspaceSearch.search({ text: this.query.value, regex: this.regex.checked });
  }
  private async inspectSearchDocument(
    binding: SearchSourceBinding,
    signal: AbortSignal,
    includeContent = false,
  ): Promise<PublicSearchDocumentInspection> {
    aborted(signal);
    if (!this.bridge.inspectSearchDocument) {
      throw new Error("当前宿主没有搜索元数据能力，请更新主进程；不会回退为全库正文预读。");
    }
    const result = await this.bridge.inspectSearchDocument(binding.source, {
      includeContent,
      encoding: binding.encoding,
    });
    aborted(signal);
    return result;
  }

  private reportSearchIssue(path: string, message: string): void {
    this.searchIssues.set(path, `${path}：${message}`);
    const entries = Array.from(this.searchIssues.values());
    const visible = entries.slice(0, 20);
    if (entries.length > visible.length) visible.push(`另有 ${entries.length - visible.length} 个文件未展示。`);
    this.searchDiagnostics.textContent = visible.join("\n");
  }

  private async readSearchDocument(item: SearchDocument, signal: AbortSignal): Promise<{ readonly content: string; readonly version: string }> {
    const buffer = this.requireBuffer();
    if (buffer.context.source && sourceId(buffer.context.source) === item.id) {
      const snapshot = await buffer.shell.editor.captureDocumentSnapshot({ signal });
      return { content: snapshot.markdown, version: `buffer:${buffer.context.id}:${snapshot.revision}` };
    }
    const binding = this.searchSources.get(item.id);
    if (!binding || binding.source.kind !== "vault" || binding.source.sessionId !== this.vault?.sessionId) {
      throw new SearchError("source-changed", "搜索的 Vault 来源已失效");
    }
    const result = await this.inspectSearchDocument(binding, signal, true);
    if (result.status === "unavailable") {
      this.reportSearchIssue(item.path, result.message);
      throw new SearchError("file-unavailable", `${item.path}：${result.message}`);
    }
    if (!result.document) throw new Error("主进程没有返回已请求的搜索正文");
    const content = result.document.text;
    if (content.length > PUBLIC_DOCUMENT_SEARCH_MAX_BYTES || new TextEncoder().encode(content).byteLength > PUBLIC_DOCUMENT_SEARCH_MAX_BYTES) {
      const message = "解码后的正文超过 2 MiB 搜索限额";
      this.reportSearchIssue(item.path, message);
      throw new SearchError("file-unavailable", `${item.path}：${message}`);
    }
    return { content, version: searchObservation(result.metadataVersion, binding.encoding) };
  }

  private async listSearchDocuments(signal: AbortSignal): Promise<readonly SearchDocument[]> {
    const vault = this.vault;
    if (!vault) return [];
    this.searchSources.clear();
    this.searchIssues.clear();
    this.searchDiagnostics.textContent = "";
    this.metadataUnavailableCount = 0;
    const files = [...this.vaultFiles];
    const results: SearchDocument[] = [];
    for (const file of files) {
      aborted(signal);
      const source: PublicDocumentSource = { kind: "vault", sessionId: vault.sessionId, path: file.path };
      const id = sourceId(source);
      const buffer = this.requireBuffer();
      if (buffer.context.source && sourceId(buffer.context.source) === id) {
        const snapshot = await buffer.shell.editor.captureDocumentSnapshot({ signal });
        const size = new TextEncoder().encode(snapshot.markdown).byteLength;
        results.push({ id, path: file.path, size, version: `buffer:${buffer.context.id}:${snapshot.revision}` });
        if (size > PUBLIC_DOCUMENT_SEARCH_MAX_BYTES) this.reportSearchIssue(file.path, "当前缓冲区超过 2 MiB 搜索限额");
      } else {
        const binding: SearchSourceBinding = { source, encoding: this.encodings.get(id) };
        const metadata = await this.inspectSearchDocument(binding, signal);
        if (metadata.status === "unavailable") {
          this.metadataUnavailableCount += 1;
          this.reportSearchIssue(file.path, metadata.message);
          continue;
        }
        this.searchSources.set(id, binding);
        results.push({ id, path: file.path, size: metadata.size, version: searchObservation(metadata.metadataVersion, binding.encoding) });
        if (metadata.size > PUBLIC_DOCUMENT_SEARCH_MAX_BYTES) this.reportSearchIssue(file.path, "文件超过 2 MiB 搜索限额，未读取正文");
      }
    }
    if (this.vault !== vault) throw new DOMException("Vault 已切换", "AbortError");
    return results;
  }
  private async openSearchHit(hit: SearchHit): Promise<void> {
    const buffer = this.requireBuffer();
    if (buffer.context.source && sourceId(buffer.context.source) === hit.fileId) {
      const snapshot = await buffer.shell.editor.captureDocumentSnapshot({ signal: buffer.context.lifetime.signal });
      if (!this.current(buffer)) return;
      if (hit.version !== `buffer:${buffer.context.id}:${snapshot.revision}` || snapshot.markdown !== buffer.shell.editor.getDocument() || buffer.shell.editor.getContributionSink().isInteractionActive()) {
        this.notify("命中已过期或表格输入尚未提交，请重新搜索。");
        this.workspaceSearch.invalidate();
        return;
      }
      buffer.shell.editor.setSelection(hit.from, hit.to);
      buffer.shell.editor.focus();
      return;
    }
    const vault = this.vault;
    if (!vault) return;
    const ticket = await this.ticket();
    const source: PublicDocumentSource = { kind: "vault", sessionId: vault.sessionId, path: hit.path };
    const encoding = this.encodings.get(sourceId(source));
    const inspection = await this.inspectSearchDocument({ source, encoding }, ticket.signal, true);
    this.assertTicket(ticket);
    if (inspection.status === "unavailable") {
      this.reportSearchIssue(hit.path, inspection.message);
      this.notify("命中目标已无法读取，未打开旧范围。");
      this.workspaceSearch.invalidate();
      return;
    }
    const read = inspection.document;
    if (this.vault !== vault || !read || hit.version !== searchObservation(inspection.metadataVersion, encoding)) {
      this.notify("磁盘版本已变化，未使用旧命中范围。");
      this.workspaceSearch.invalidate();
      return;
    }
    await this.installBuffer(read.text, read.name, source, read.version, read.format, read.text);
    this.editor.setSelection(hit.from, hit.to);
    this.editor.focus();
  }

  private async historyStore(buffer: DemoBuffer): Promise<{ documentKey: string; store: DocumentVersionStore }> {
    const source = buffer.context.source;
    if (!source) return { documentKey: `unsaved:${buffer.context.id}`, store: buffer.context.memoryHistory };
    const state = await this.bridge.history(source);
    const key = state.documentKey;
    const memory = async (documentKey: string) => {
      if (documentKey !== key) throw new Error("历史来源不匹配");
      const fresh = await this.bridge.history(source);
      if (fresh.documentKey !== key) throw new Error("历史来源已变更");
      return new MemoryDocumentVersionStore({ ...PUBLIC_DOCUMENT_HISTORY_POLICY, snapshot: fresh.snapshot });
    };
    return { documentKey: key, store: {
      list: async (documentKey, options) => (await memory(documentKey)).list(documentKey, options),
      read: async (documentKey, id, options) => (await memory(documentKey)).read(documentKey, id, options),
      append: async (documentKey, record, options) => {
        if (documentKey !== key || record.reason === "saved") throw new Error("历史来源或记录原因不匹配");
        aborted(options?.signal);
        return this.bridge.appendHistory(source, { markdown: record.markdown, reason: record.reason ?? "checkpoint", label: record.label }, options?.expectedHead);
      },
    } };
  }
  private requireHistory(): DemoBuffer {
    if (!this.historyEnabled.checked) throw new Error("请先显式启用保存历史");
    return this.requireBuffer();
  }
  async loadHistory(): Promise<void> {
    const buffer = this.requireHistory();
    const { documentKey, store } = await this.historyStore(buffer);
    const page = await store.list(documentKey, { limit: 100, signal: buffer.context.lifetime.signal });
    if (!this.current(buffer)) return;
    this.versions.replaceChildren();
    for (const item of page.items) {
      const option = this.element("option");
      option.value = item.id;
      option.textContent = `${new Date(item.createdAt).toLocaleString()} · ${item.reason}${item.label ? ` · ${item.label}` : ""}`;
      this.versions.append(option);
    }
    this.notify(`读取到 ${page.items.length} 个内容版本。`);
  }
  async checkpoint(): Promise<void> {
    const buffer = this.requireHistory();
    const snapshot = await buffer.shell.editor.captureDocumentSnapshot({ signal: buffer.context.lifetime.signal });
    const { documentKey, store } = await this.historyStore(buffer);
    if (!this.current(buffer)) return;
    const page = await store.list(documentKey, { limit: 1, signal: buffer.context.lifetime.signal });
    const result = await store.append(documentKey, { markdown: snapshot.markdown, reason: "checkpoint" }, { expectedHead: page.head, signal: buffer.context.lifetime.signal });
    if (result.status !== "appended") throw new Error("历史头已变化，请重试记录。");
    if (this.current(buffer)) await this.loadHistory();
  }
  async compareVersion(): Promise<void> {
    const buffer = this.requireHistory();
    const id = this.versions.value;
    if (!id) throw new Error("请选择历史版本");
    const snapshot = await buffer.shell.editor.captureDocumentSnapshot({ signal: buffer.context.lifetime.signal });
    const { documentKey, store } = await this.historyStore(buffer);
    const version = await store.read(documentKey, id, { signal: buffer.context.lifetime.signal });
    if (!this.current(buffer) || snapshot.revision !== buffer.shell.editor.getDocumentRevision?.()) throw new Error("比较期间内容已变化，请重试。");
    if (!version) throw new Error("历史版本不存在");
    const diff = diffDocumentText(version.markdown, snapshot.markdown);
    await this.clearPreview();
    if (!this.current(buffer) || snapshot.revision !== buffer.shell.editor.getDocumentRevision?.()) throw new DOMException("比较来源已变化", "AbortError");
    const pre = this.element("pre");
    if (diff.status === "limited") {
      pre.textContent = `差异超过限额：${diff.reason}`;
    } else if (diff.hunks.length) {
      pre.textContent = diff.hunks.slice(0, 20).map((hunk) => {
        const before = version.markdown.slice(hunk.before.from, hunk.before.to).slice(0, 1000);
        const after = snapshot.markdown.slice(hunk.after.from, hunk.after.to).slice(0, 1000);
        return `- ${before}\n+ ${after}`;
      }).join("\n\n");
    } else {
      pre.textContent = "内容相同";
    }
    this.preview.append(pre);
    this.previewDetails.open = true;
    this.notify(diff.status === "complete" ? `${diff.hunks.length} 处差异（界面最多展示前 20 处、每侧 1000 字符）。` : "差异未完成，不将限额结果当作无差异。");
  }
  async restoreVersion(): Promise<void> {
    const buffer = this.requireHistory();
    const versionId = this.versions.value;
    if (!versionId) throw new Error("请选择历史版本");
    const snapshot = await buffer.shell.editor.captureDocumentSnapshot({ signal: buffer.context.lifetime.signal });
    if (!snapshot.revision) throw new Error("编辑器缺少修订支持");
    const { documentKey, store } = await this.historyStore(buffer);
    if (!this.current(buffer)) return;
    const result = await restoreDocumentVersion(buffer.shell.editor, store, { documentKey, versionId, expectedRevision: snapshot.revision, signal: buffer.context.lifetime.signal });
    if (this.current(buffer)) {
      this.renderStatus();
      this.notify(`恢复：${result.status}；仅修改缓冲区，文件编码和磁盘版本不变。`);
    }
  }

  private renderOptions(buffer: DemoBuffer, signal: AbortSignal): RenderDocumentOptions {
    return {
      document: this.root.ownerDocument,
      documentId: buffer.context.id,
      title: buffer.context.name,
      signal,
      assetProvider: this.provider(buffer.context),
      styles: [STATIC_STYLE],
      extensions: [createGfmRenderExtension(), createMathRenderExtension(), createMermaidRenderExtension()],
    };
  }
  private async clearPreview(): Promise<void> {
    const handle = this.previewHandle;
    this.previewHandle = null;
    this.preview.replaceChildren();
    await handle?.dispose();
  }
  async showSnapshot(): Promise<void> {
    const buffer = this.requireBuffer();
    const snapshot = await buffer.shell.editor.captureDocumentSnapshot({
      signal: buffer.context.lifetime.signal,
      includeRenderAst: true,
    });
    if (!this.current(buffer)) return;
    this.notify(`有效快照：${snapshot.markdown.length} 个 UTF-16 单元，${snapshot.renderAst?.children.length ?? 0} 个顶层 AST 节点；修订 ${snapshot.revision}。`);
  }
  async showPreview(): Promise<void> {
    const buffer = this.requireBuffer();
    const signal = this.beginOperation();
    const snapshot = await buffer.shell.editor.captureDocumentSnapshot({ signal, includeRenderAst: true });
    const handle = renderDocument(snapshot, this.renderOptions(buffer, signal));
    let mounted = false;
    try {
      await handle.ready;
      aborted(signal);
      if (!this.current(buffer) || snapshot.revision !== buffer.shell.editor.getDocumentRevision?.()) throw new Error("预览期间内容已变化，请重试。");
      await this.clearPreview();
      aborted(signal);
      if (!this.current(buffer) || snapshot.revision !== buffer.shell.editor.getDocumentRevision?.()) throw new DOMException("预览来源已变化", "AbortError");
      this.previewHandle = handle;
      this.preview.append(handle.element);
      this.previewDetails.open = true;
      mounted = true;
      this.notify(`完整预览已生成${handle.diagnostics.length ? `；${handle.diagnostics.map((item) => item.message).join("；")}` : ""}。`);
    } finally {
      if (!mounted) await handle.dispose();
    }
  }
  async exportDocument(): Promise<void> {
    const buffer = this.requireBuffer();
    const signal = this.beginOperation();
    const snapshot = await buffer.shell.editor.captureDocumentSnapshot({ signal, includeRenderAst: true });
    const artifact = await exportHtml(snapshot, { ...this.renderOptions(buffer, signal), strictAssets: true, language: "zh" });
    aborted(signal);
    if (!this.current(buffer)) throw new DOMException("来源已关闭", "AbortError");
    const exported = await this.bridge.exportHtml({ bytes: artifact.bytes, name: buffer.context.name.replace(/\.[^.]+$/, "") + ".html" });
    if (this.current(buffer)) this.notify(exported ? "已导出捕获快照的离线 HTML。" : "已取消导出。");
  }
  private async requestClose(): Promise<void> {
    const closed = await this.requestShutdown();
    if (closed) await window.nexusHost.shutdownComplete();
  }

  async requestShutdown(): Promise<boolean> {
    if (this.closing || this.disposed) return true;
    this.closing = true;
    try {
      await this.saving;
      const buffer = this.requireBuffer();
      const signal = this.beginOperation();
      const snapshot = await buffer.shell.editor.captureDocumentSnapshot({ signal });
      if ((snapshot.markdown !== buffer.context.savedContent || !sameFormat(buffer.context.format, buffer.context.savedFormat)) && !this.confirmDiscard("当前有未保存内容，确认放弃并关闭演示？")) {
        await this.bridge.cancelShutdown();
        return false;
      }
      await this.destroy();
      return true;
    } catch (error) {
      await this.bridge.cancelShutdown();
      if (!(error instanceof Error && error.name === "AbortError")) this.notify(error instanceof Error ? error.message : "关闭失败");
      return false;
    } finally {
      this.closing = false;
    }
  }
  async destroy(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.installSequence += 1;
    this.operation?.abort();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    const buffer = this.buffer;
    this.buffer = null;
    buffer?.context.lifetime.abort();
    const search = buffer?.search.dispose();
    buffer?.shell.destroy();
    buffer?.context.assets.clear();
    await Promise.all([search, this.workspaceSearch.destroy(), this.conversion.dispose(), this.clearPreview()]);
    if (this.vault) await this.plugins?.vault.close(this.vault.sessionId);
    this.vault = null;
    this.root.replaceChildren();
  }
}

export async function bootPublicCapabilitiesDemo(options: PublicCapabilitiesDemoOptions = {}): Promise<PublicCapabilitiesDemo> {
  const demo = new PublicCapabilitiesDemo(options);
  try {
    await demo.start();
    return demo;
  } catch (error) {
    await demo.destroy();
    throw error;
  }
}
