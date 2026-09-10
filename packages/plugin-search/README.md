# 搜索插件与无界面服务

默认 `createSearchPlugin()` 保留原有文内搜索面板、快捷键、替换、历史选项和表格高亮。下面的服务均显式启用，不会自动创建侧栏、弹层、文件系统访问或后台 Worker。

## 公共入口

| 入口 | 用途 |
| --- | --- |
| `@floatboat/nexus-plugin-search` | 原有插件、`findSearchMatches`、`replaceAllMatches`；新增 `ui: "headless"` 选项 |
| `@floatboat/nexus-plugin-search/fuzzy` | 纯函数 `rankNavigationItems`，稳定排序并保留原候选对象 |
| `@floatboat/nexus-plugin-search/workspace` | `SearchController`、`SearchSource`、查询/命中/执行器类型及默认限制 |
| `@floatboat/nexus-plugin-search/browser-worker` | `createBrowserSearchExecutor`，浏览器模块 Worker 适配 |
| `@floatboat/nexus-plugin-search/node-worker` | `createNodeSearchExecutor`，Node `worker_threads` 适配 |
| `@floatboat/nexus-plugin-search/headless` | 绑定指定 `EditorAPI` 的 `createDocumentSearchController` |

纯排序与 workspace 入口可以在没有 DOM 的 Node 中导入。Node Worker 入口与浏览器入口分开发布，不要在浏览器构建中导入 Node 适配器。Worker 脚本和共享模块随 `dist` 发布；构建工具若没有保留相对资源 URL，浏览器工厂可传入 `createWorker`，返回宿主创建的模块 Worker。

`@floatboat/nexus-plugin-search/search-worker` 是可交给打包器的 Worker 资源入口，不应直接在页面主线程导入执行。例如 Vite 可导入 `@floatboat/nexus-plugin-search/search-worker?worker`，并以 `createBrowserSearchExecutor({ createWorker: () => new SearchWorker() })` 接入；`?worker` 的类型由 Vite 提供。

## 多文档搜索

```ts
import { SearchController } from "@floatboat/nexus-plugin-search/workspace";
import { createBrowserSearchExecutor } from "@floatboat/nexus-plugin-search/browser-worker";

const search = new SearchController({
  source: {
    async list(signal) {
      // 由宿主返回已获授权的文档元数据，不在这里捕获被过滤文档的输入。
      return [{ id: "note-1", path: "Notes/Example.md", version: "revision-1" }];
    },
    async read(document, signal) {
      // 内容和版本必须属于同一份原子快照；示例固定返回同一版本。
      return { content: "Example text", version: "revision-1" };
    },
  },
  executor: createBrowserSearchExecutor(),
});
const unsubscribe = search.subscribe((state) => {
  // 宿主按需呈现 state.hits / state.status / state.error。
});
await search.search({ text: "example", include: "Notes/**", wholeWord: true });
if (search.getState().hasMore) await search.loadMore();
unsubscribe();
await search.destroy();
```

Node 使用同一个控制器，只需显式传入 `createNodeSearchExecutor()`。一个执行器归一个控制器所有，不要把同一串行执行器共享给多个同时运行的控制器；销毁控制器会释放该执行器。

查询支持 `regex`、`caseSensitive`、`wholeWord`、`include` 和 `exclude`。路径过滤支持逗号分隔的 glob、`*`、`**`、`**/`、`?`，末尾 `/` 表示目录后代；不包含 `/` 的模式匹配文件名。过滤区分大小写，不是完整的 glob 语言。查询与过滤各限制为 4096 字符。

整词采用 Unicode 字母、数字、组合符及下划线边界，连续中文视为一个词段。正则采用 JavaScript `gmu`，不区分大小写时增加 `i`；跨行的点匹配需要显式使用相应表达式。旧的单文档纯函数保留原来的 `regexp` 参数和边界语义，不会被新算法静默替换。

命中的 `from/to`、`column` 和 `snippetFrom` 均为原文 UTF-16 坐标；`line/column` 从零开始。结果携带文件身份和实际内容版本，宿主跳转或修改前必须重新校验，不能只比较旧保存基准版本。

默认限制可通过 `limits` 覆盖：

- `maxFileBytes`：2 MiB；已知超限文件在读取前跳过，读取后还会检查 UTF-8 大小。
- `pageSize`：200 条；匹配以最多 50 条的小批次发布。
- `maxResults`：5,000 条；到达上限且仍有未扫描内容时标记 `truncated`。
- `regexBudgetMs`：每文件 250ms；累加匹配耗时，并由执行器在超时或取消时终止 Worker。

`hasMore` 表示仍有未扫描内容，不是精确的剩余命中数。`hits.length` 是已返回数量，不是尚未完成搜索的总数。超时不是精确实时承诺，还受 Worker 启动和调度影响。

数据源负责文件授权、读取、未保存内容覆盖及版本；路径过滤不是权限边界。宿主观察到内容、身份、授权或范围变化时调用 `invalidate()`，清除旧命中并重新查询。继续分页前控制器会重新读取当前文档核对版本，但不会轮询所有已返回结果的来源。控制器取消会丢弃迟到结果并及时结束等待；底层 IO 是否实际停止，取决于数据源是否响应 `AbortSignal`。

`list` 应返回元数据，不应为了列举候选而提前读取全部正文。宿主确认某个文件已删除或无法读取、但其余来源仍可搜索时，可以在 `read` 中明确抛出 `new SearchError("file-unavailable", message)`；控制器会计入 `skippedFiles` 并继续。其他异常仍使查询失败，不会静默当作空文档；逐文件诊断和来源权限由宿主保留。

不要把任意正则放入同线程执行器：Promise 或定时器不能打断正在执行的 `RegExp.exec`。本包的两种 Worker 适配器提供可终止隔离；内部同步 matcher 的计时不是超时保护。

## 替换默认 UI 的文内控制器

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";
import { createDocumentSearchController } from "@floatboat/nexus-plugin-search/headless";
import { createBrowserSearchExecutor } from "@floatboat/nexus-plugin-search/browser-worker";

const editor = createEditor({
  container,
  initialValue: "One document",
  plugins: [createSearchPlugin({ ui: "headless" })],
});
const search = createDocumentSearchController(editor, {
  executor: createBrowserSearchExecutor(),
});
await search.ready;
search.open(); // 仅改变逻辑状态；宿主决定如何显示自己的输入框。
await search.setQuery({ text: "document" });
await search.findNext();
await search.replaceNext("note");
await search.dispose();
editor.destroy();
```

控制器通过指定 editor 的公开贡献接口绑定内部视图，不查找全局 DOM，也不使用“最近编辑器”。同一 editor 只能绑定一个控制器。未安装 headless 插件时 `ready` 会拒绝，避免同时驱动两套搜索 UI。

公开动作包含 `setQuery`、`loadMore`、`findNext`、`findPrevious`、`selectMatch(hit)`、`selectAll`、`replaceNext`、`replaceAll`、`open/close` 和 `dispose`。状态通过 `getState/subscribe` 获取。headless 快捷键只驱动逻辑动作；无效查询不会打开 CodeMirror 默认面板。界面文案、焦点策略和命令面板由宿主提供。

表格待提交输入或活动交互期间返回 `busy`，不把有效快照的偏移应用到旧 CodeMirror 文档，也不强制失焦。自然提交后重新查询。异步结果应用前校验原文和修订号；旧命中返回 `conflict`。旧 editor 缺少可选修订号或只读查询方法时仍可查询，但位置应用/替换失败关闭为 `unsupported`。

替换在 Worker 中计算：字面量模式把替换字符串原样插入；正则模式支持 JavaScript `$1`、`$&`、`$<name>` 等替换符。替换文本及单文档展开后的插入文本累计也受 `maxFileBytes` 限制，避免引用整篇前缀/后缀时产生无界消息。应用通过公开事务接口，一次替换操作隔离为一个撤销步骤，并遵循只读和事务过滤器。超过结果上限时不会执行部分的“全部替换”。`selectAll` 要求编辑器启用 `multiCursor`，否则明确返回 `unsupported`。

`replaceNext` 按需翻页到当前选区或其后的匹配，只有确认文档末尾没有后续匹配时才回绕。若结果上限截断了尚未扫描的范围，返回 `unavailable`，不会误替换开头的匹配；已经确认的当前匹配仍可替换。

显示多少候选、怎样导航到文件、文件存储及附件资源均不属于该控制器。`close()` 只关闭逻辑显示，`dispose()` 才清理订阅和执行器；编辑器销毁也会自动释放控制器。

## 验证

在仓库声明的 Node 与 pnpm 环境下执行包的 `test`、`typecheck`、`build`，构建后运行 `check:api`。公共检查包含真实 Node Worker 的超时、取消和恢复；`scripts/browser-worker-smoke.cjs` 使用 Electron 的隐藏隔离窗口验证已发布浏览器 Worker 资产，不访问真实用户文档。
