# @floatboat/nexus-plugin-autosave

去抖自动保存插件，配合 dirty state 查询与立即保存（flush）能力。

## 安装

```bash
pnpm add @floatboat/nexus-plugin-autosave
```

## 使用

```typescript
import { createAutosavePlugin, isDirty, forceSave } from "@floatboat/nexus-plugin-autosave";

const editor = createEditor({
  container,
  initialValue: "# My Note",
  plugins: [
    createAutosavePlugin({
      debounceMs: 2000,
      onSave: async (document) => {
        await fs.writeFile("/path/to/note.md", document);
      },
    }),
  ],
});

// 查询 dirty 状态（供状态栏/导航守卫使用）
console.log(isDirty(editor));

// SPA 路由离开前立即保存
window.addEventListener("beforeunload", () => {
  if (isDirty(editor)) forceSave(editor);
});
```

## API

### `createAutosavePlugin(options)`

返回 `NexusPlugin`，传入 `createEditor({ plugins: [...] })`。

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `onSave` | `(document: string) => Promise<void>` | 必填 | 保存回调，宿主在此执行异步 IO |
| `debounceMs` | `number` | `1000` | 去抖延迟。设为 `0` 时每次变更立即保存 |

### `isDirty(editor)`

```typescript
function isDirty(editor: EditorAPI): boolean;
```

是否有未保存的更改。若未注册 autosave 插件，始终返回 `false`。

### `forceSave(editor)`

```typescript
function forceSave(editor: EditorAPI): void;
```

清除待处理 timer，立即向宿主发起保存。不等待 Promise 完成 — SPA 路由卸载时等不起异步 IO，宿主应配合 `navigator.sendBeacon` 或同步 XHR。
