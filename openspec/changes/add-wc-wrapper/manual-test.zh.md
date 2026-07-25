# Web Component 分支手工测试用例

适用分支：`feat/wc-add-web-component`
测试目标：验证 `@floatboat/nexus-wc` 新增能力和 review 修复项。

## 1. 测试前准备

```bash
pnpm install --frozen-lockfile
pnpm --dir apps/electron-demo exec vite ../../packages/wc/manual --host 127.0.0.1 --port 5173 --strictPort
```

浏览器打开 `http://127.0.0.1:5173/`。测试台位于 `packages/wc/manual/`，不会进入 npm 发布包。

跨源 iframe 测试需要在第二个终端启动：

```bash
pnpm --dir apps/electron-demo exec vite ../../packages/wc/manual --host 127.0.0.1 --port 5174 --strictPort
```

然后打开 `http://127.0.0.1:5173/?frameOrigin=http://127.0.0.1:5174`。

Electron smoke 前先构建 Apple Silicon 安装包：

```bash
pnpm --filter @floatboat/nexus-electron-demo dist:mac-arm64
```

产物位于被 Git 忽略的 `apps/electron-demo/release/`，不要加入提交。

> Electron demo 直接使用 Core，不使用 `<nexus-editor>`。WC 生命周期必须在浏览器测试台验证；Electron 只覆盖编辑器整体回归。

## 2. P0：必须通过

### WC-01 基础挂载和事件

前置条件：打开浏览器测试台。

步骤：

1. 在任意编辑器中点击并输入文本。
2. 打开浏览器控制台，确认没有 uncaught error。
3. 检查编辑器仍可聚焦、输入、选择文本。

预期：

- 编辑器正常显示并可编辑。
- 输入后内容立即更新。
- 页面和控制台没有异常。

### WC-01b nexus-ready 可被注册后的监听器收到

步骤：在浏览器控制台执行：

```js
const { NexusEditorElement } = await import("/packages/wc/src/index.ts");
document.body.insertAdjacentHTML("beforeend", '<probe-editor initial-value="# ready"></probe-editor>');
const el = document.querySelector("probe-editor");
customElements.define("probe-editor", class extends NexusEditorElement {});
let fired = 0;
el.addEventListener("nexus-ready", () => { fired += 1; });   // define 之后才订阅
await Promise.resolve();
({ fired, display: getComputedStyle(el).display, doc: el.editor?.getDocument() });
```

预期：`fired` 为 `1`，`display` 为 `"block"`，`doc` 为 `"# ready"`。

失败证据：`fired` 为 `0`（事件在 `connectedCallback` 内同步派发，宿主来不及订阅），或 `display` 为 `"inline"`。

### WC-01c 默认块级布局

步骤：在控制台执行 `getComputedStyle(document.querySelector("#parent-a nexus-editor")).display`。

预期：返回 `"block"`。测试台的 CSS 只设置 `min-height`，块级来自组件自带的 `:where()` 基础样式。

补充：执行 `document.querySelector("#parent-a nexus-editor").style.display = "flex"`，确认消费方样式能覆盖默认值。

### WC-02 注册前 property 保留

步骤：点击“升级前 property”区域的“检查初始值”。

预期：日志显示：

```text
PASS WC-02: document="# property before upgrade"
```

失败证据：文档为空或不是 `# property before upgrade`。

### WC-03 延迟受控同步不回滚

步骤：点击“运行 B → C 竞态”，等待至少 400ms。

预期：日志显示 `PASS WC-03`，并且 `value=C, document=C`。

失败证据：

- `value` 回退成 `B`；或
- property 与编辑器文档不一致。

### WC-04 同步 reparent 保留未受控内容

步骤：

1. 在“同步 reparent”编辑器中输入一段独特文本，例如 `move-2026`。
2. 点击“移动并检查”。
3. 再次点击，移动回原容器。

预期：

- 两次均显示 `PASS WC-04`。
- 文本、光标和编辑器实例保持可用。
- 不恢复成 `uncontrolled seed`。

### WC-05 事件穿过 Shadow DOM

步骤：点击“触发 shadow 内变更”。

预期：外层宿主收到事件，日志显示：

```text
PASS WC-05: nexus-change 已穿过 Shadow DOM
```

## 3. P1：功能完整性

### WC-06 Multi-cursor

步骤：点击“设置两个选区”。

预期：日志显示：

```text
PASS WC-06: selection ranges=2
```

### WC-07 永久断开后销毁

在浏览器控制台执行：

```js
const el = document.querySelector("#multi-mount nexus-editor");
const api = el.editor;
el.remove();
await Promise.resolve();
({ editorIsNull: el.editor === null, domRemoved: !el.querySelector(".cm-editor"), oldApi: api });
```

预期：`editorIsNull` 和 `domRemoved` 均为 `true`。

### WC-08 重复注册和外部标签冲突

在控制台执行：

```js
const { defineNexusEditor } = await import("/packages/wc/src/index.ts");
defineNexusEditor();
defineNexusEditor(); // 不抛错

customElements.define("foreign-editor", class extends HTMLElement {});
try {
  defineNexusEditor("foreign-editor");
  console.log("FAIL");
} catch (error) {
  console.log("PASS", error.message);
}
```

预期：同一 Nexus 标签重复注册无异常；外部构造器占用标签时打印 `PASS`。

### WC-09 初始配置只读取一次

步骤：

1. 在控制台取得任意已连接元素。
2. 记录当前 `.editor` 引用。
3. 修改 `readOnly`、`multiCursor` 或 `plugins`。
4. 尝试继续编辑。

预期：已经创建的 EditorAPI 不被重建，初始配置不会在连接期间动态切换。永久移除并重新添加后，新配置生效。

### WC-10 TypeScript DOM 类型

执行：

```bash
pnpm --filter @floatboat/nexus-wc exec tsc --noEmit
```

预期：退出码为 0；`document.querySelector("nexus-editor")`、`event.detail.doc` 无需手写类型断言。

## 4. iframe bridge

以下用例先在同源地址执行一遍，再使用 5173 → 5174 的跨源地址重复执行。

### IFRAME-01 握手与 ready

步骤：打开测试台并等待 iframe 加载。

预期：日志显示 `PASS IFRAME-01`，iframe 内出现可编辑的 Nexus 编辑器。

### IFRAME-02 iframe 用户变更

步骤：直接在 iframe 编辑器内输入文本。

预期：父页面日志显示 `PASS IFRAME-02`，并包含最新 Markdown。

### IFRAME-03/04 文档 set/get

步骤：

1. 点击 `setDocument`。
2. 确认 iframe 文档变为带时间戳的 `parent update`。
3. 点击 `getDocument`。

预期：日志依次显示 `PASS IFRAME-03` 和 `PASS IFRAME-04`；程序化 set 不额外产生 IFRAME-02 change。

### IFRAME-05 focus

步骤：点击 `focus` 后直接输入字符。

预期：日志显示 `PASS IFRAME-05`，键盘输入进入 iframe 编辑器。

### IFRAME-06 reload 使旧 controller 失效

步骤：点击 `reload 检测`，等待 iframe 重载。

预期：日志显示 `PASS IFRAME-06: error code=IFRAME_RELOADED`。随后点击“重新连接”，应再次出现 `PASS IFRAME-01`。

### IFRAME-07 错误 origin

步骤：点击“错误 origin”，等待约 500ms。

预期：错误 origin 无法完成握手，日志显示 `PASS IFRAME-07: error code=TIMEOUT`。

### IFRAME-08 destroy

步骤：点击 `destroy`，再点击 iframe 区域或父端 get。

预期：日志显示 `PASS IFRAME-08`，iframe 内编辑器被销毁。点击“重新连接”会重载 frame 并建立新 controller。

## 5. Electron smoke

### EL-01 安装与启动

步骤：

1. 打开 arm64 DMG。
2. 将 Nexus Editor 拖入“应用程序”。
3. 首次启动时，如 macOS 阻止未签名应用，右键应用并选择“打开”。

预期：应用启动，无白屏、崩溃或持续弹窗。

### EL-02 基础编辑回归

步骤：新建或打开 Markdown，依次测试普通输入、撤销/重做、搜索、斜杠菜单、表格和 live preview。

预期：所有操作正常；切换文档后不会晚到旧文档的 change 更新。

## 6. 通过标准与报告模板

合并门槛：全部 P0 和 iframe 用例通过；P1 无功能性失败；Electron 无启动或数据丢失问题。

建议报告格式：

```text
环境：macOS / 浏览器版本 / 芯片
提交：git rev-parse --short HEAD
用例：WC-03
结果：PASS / FAIL
实际现象：
控制台错误：
截图或录屏：
复现频率：N/N
```
