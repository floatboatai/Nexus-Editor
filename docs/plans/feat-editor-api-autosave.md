# Plan: feat(core): add cursor/scroll query APIs + plugin-autosave

## B: EditorAPI 状态查询补充

`getDocumentStats()` 已存在（types.ts:183 / editor.ts:811），补两个缺失的查询 API。

### `getCursorPosition()`

```typescript
getCursorPosition(): { line: number; column: number; offset: number }
```

- `line`: 1-based 行号
- `column`: 1-based UTF-16 code unit 列号
- `offset`: 0-based 文档绝对偏移

### `getScrollInfo()`

```typescript
getScrollInfo(): { scrollTop: number; scrollLeft: number; scrollHeight: number; clientHeight: number } | null
```

- 无 view 时返回 null
- 值直接从 `view.scrollDOM` 和 `view.dom` 读取

### 文件变更

| 文件 | 变更 | 行数 |
|------|------|------|
| `packages/core/src/types.ts` | EditorAPI 新增 2 个方法签名 | +10 |
| `packages/core/src/editor.ts` | 实现 2 个方法 | +25 |
| `packages/core/test/editor.test.ts` | 新增测试：光标位置、滚动信息 | +80 |

**小计**：~115 行

---

## C: `plugin-autosave`

### 架构原则（vs 第一版错误设计）

| 错误 | 修正 |
|------|------|
| 布尔 `dirty: boolean` → 保存异步期间被新编辑覆盖 | `lastSavedDoc: Text` 快照比较。`isDirty = !view.state.doc.eq(lastSavedDoc)`。保存期间的新编辑自然保持 dirty |
| 有状态插件实例 → 分屏/React 重载时状态串扰 | 运行时状态全部挂在 CM6 ViewPlugin 上。查询 API 是纯函数，传入 `editor` 句柄 |
| `beforeunload` 只能拦截浏览器关闭 → SPA 路由导航无保护 | 提供 `forceSave(editor)` 给宿主在路由卸载时调用 |

### API

```typescript
// --- 配置（无状态） ---

export function createAutosavePlugin(options: AutosaveOptions): NexusPlugin;

export interface AutosaveOptions {
  /** 保存回调。宿主在此执行异步 IO。 */
  onSave(document: string): Promise<void>;
  /** 去抖延迟 ms，默认 1000 */
  debounceMs?: number;
}

// --- 查询（纯函数，传入 editor 句柄） ---

/** 是否有未保存的更改 */
export function isDirty(editor: EditorAPI): boolean;

/** 立即触发保存（跳过 debounce），SPA 路由卸载前调用 */
export function forceSave(editor: EditorAPI): void;
```

### 使用方式

```typescript
import { createAutosavePlugin, isDirty, forceSave } from "@floatboat/nexus-plugin-autosave";

// React 组件
function MyEditor() {
  const [editor, setEditor] = useState(null);

  useEffect(() => {
    return () => {
      // SPA 路由离开：立即保存，不等 timer
      if (editor && isDirty(editor)) {
        forceSave(editor);
      }
    };
  }, [editor]);

  return <Editor
    ref={setEditor}
    plugins={[createAutosavePlugin({
      debounceMs: 2000,
      onSave: async (doc) => { await fs.writeFile("/note.md", doc); },
    })]}
  />;
}

// 浏览器关闭保护
window.addEventListener("beforeunload", (e) => {
  if (editor && isDirty(editor)) {
    e.preventDefault(); // 触发浏览器原生确认框
  }
});
```

### 内部实现要点

```typescript
// ViewPlugin 承载全部运行时状态
const autosavePlugin = ViewPlugin.fromClass(
  class {
    lastSavedDoc: Text;
    timer: ReturnType<typeof setTimeout> | null = null;
    onSave: (doc: string) => Promise<void>;

    constructor(view: EditorView) {
      this.lastSavedDoc = view.state.doc;
    }

    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(async () => {
        // 1. 同步捕获不可变快照（在 await 之前！）
        const snapshot = this.view.state.doc;
        try {
          // 2. 把快照转成字符串传给宿主保存
          await this.onSave(snapshot.toString());
          // 3. 赋值的是之前捕获的快照，不是 await 之后的 view.state.doc
          //    await 期间的新编辑让 view.state.doc !== snapshot → isDirty 保持 true
          this.lastSavedDoc = snapshot;
        } catch {
          // 保存失败 → 不更新 lastSavedDoc，isDirty 保持 true，下个周期重试
        }
      }, this.debounceMs);
    }

    forceSave(): void {
      if (this.timer) clearTimeout(this.timer);
      const snapshot = this.view.state.doc;
      // 不等待 Promise — SPA 路由卸载时等不起异步 IO；
      // 宿主的 onSave 实现应配合 sendBeacon 或同步 XHR
      this.onSave(snapshot.toString()).then(() => {
        this.lastSavedDoc = snapshot;
      }).catch(() => {});
    }

    destroy() {
      if (this.timer) clearTimeout(this.timer);
    }
  },
);
```

**关键设计**：
- `isDirty(editor)` 通过 `editor` 句柄拿到 CM6 view → `view.plugin(autosavePlugin)` → 读取 `lastSavedDoc`，比较 `view.state.doc.eq(lastSavedDoc)`
- **异步快照必须在 `await` 之前同步捕获**：先用 `const snapshot = this.view.state.doc` 攥住不可变快照，再 `await this.onSave(snapshot.toString())`。成功后 `this.lastSavedDoc = snapshot`（不是 `this.view.state.doc`）。这样 `await` 期间的并发编辑会让 `view.state.doc` 不等于 `snapshot`，`isDirty` 自然保持 true
- `forceSave(editor)` 同步捕获快照，`clearTimeout(timer)`，**不等待** Promise 完成——SPA 路由卸载时宿主等不起异步 IO。宿主应配合 `navigator.sendBeacon` 或在 `beforeunload` 中使用同步 XHR
- `beforeunload` 不内置注册——宿主自己管理生命周期（用 `isDirty` + `window.addEventListener`）

### 文件结构

```
packages/plugin-autosave/
├── src/
│   └── index.ts                 ~180 行  配置函数 + ViewPlugin + 查询函数
├── test/
│   └── plugin-autosave.test.ts  ~140 行  单元测试
├── package.json                   ~20 行
├── tsconfig.json                  ~10 行
└── README.md                      ~40 行
```

### 测试大纲

| 测试用例 | 覆盖 |
|---------|------|
| 文档变更 debounceMs 后调用 onSave | 核心逻辑 |
| 连续编辑仅触发一次 onSave（debounce 重置） | 去抖 |
| isDirty() 在首个变更后为 true | 快照比较 |
| onSave 成功后 isDirty() 为 false | 快照更新 |
| 保存期间有新编辑，isDirty() 保持 true | 竞态安全 |
| forceSave() 立即调用 onSave 并清除 timer | flush |
| forceSave() 在无变更时调用 onSave（传当前文档） | 边界 |
| destroy() 清理 timer | 资源泄漏 |
| 空文档无变更不触发 onSave | 边界 |
| debounceMs=0 时同步触发 onSave | 边界 |

---

## 总览

| 部分 | 文件 | 行数 |
|------|------|------|
| B (API) | `types.ts` + `editor.ts` + `editor.test.ts` | ~115 |
| C (plugin-autosave) | 新建 5 文件（src + test + package.json + tsconfig + README） | ~390 |
| **合计** | **7 文件（5 新 + 2 改）** | **~505 行** |

## 验证

```
pnpm typecheck   → 0 errors
pnpm test        → 全部通过
pnpm build       → 全部包 + plugin-autosave 构建成功
```
