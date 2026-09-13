import { createEditor, type EditorAPI, type EditorContributionRegistration } from "@floatboat/nexus-core";
import { history } from "@codemirror/commands";
import { createBlockDragExtension } from "../src";

const container = document.querySelector<HTMLElement>("#editor")!;
const output = document.querySelector<HTMLElement>("#output")!;
const live = document.querySelector<HTMLInputElement>("#live")!;
const enabled = document.querySelector<HTMLInputElement>("#enabled")!;
const readonly = document.querySelector<HTMLInputElement>("#readonly")!;
const sample = document.querySelector<HTMLSelectElement>("#sample")!;
const samples: Record<string, string> = {
  basic: "# 整理思路\n\n第一段：先记录想法，再调整顺序。\n\n第二段：拖动左侧手柄，可以移动完整段落。\n\n- 下载软件\n- 配置环境\n  - 设置路径\n\n> 引用是一整个块。\n>\n> 内部结构保持原样。\n\n```ts\nconst message = 'Hello';\nconsole.log(message);\n```\n\n| 项目 | 状态 |\n| --- | --- |\n| 块移动 | 待验证 |\n| 撤销 | 待验证 |\n\n---\n\n最后一段：继续写作。",
  long: Array.from({ length: 60 }, (_, index) => `第 ${index + 1} 段：长文档测试，拖到编辑器边缘会自动滚动。`).join("\n\n"),
  lists: "- 第一份列表\n\n中间段落\n\n- 第二份列表\n\n结尾段落",
};
let editor: EditorAPI;
let registration: EditorContributionRegistration | null = null;

function mount(source: string): void {
  editor?.destroy();
  editor = createEditor({
    container, initialValue: source, livePreview: live.checked, readOnly: readonly.checked,
    parseDelayMs: 0, multiCursor: true,
    plugins: [{ name: "history", cmExtensions: [history()] }],
    onChange: (value) => { output.textContent = value; },
  });
  output.textContent = source;
  registration = null;
  if (enabled.checked) enable();
}

function enable(): void {
  registration = editor.getContributionSink().registerExtension("block-drag-demo", createBlockDragExtension({ label: "拖动以移动" }));
}

enabled.addEventListener("change", () => {
  if (enabled.checked) enable();
  else { void registration?.dispose(); registration = null; }
});
live.addEventListener("change", () => mount(editor.getDocument()));
readonly.addEventListener("change", () => mount(editor.getDocument()));
sample.addEventListener("change", () => mount(samples[sample.value]));
document.querySelector("#undo")!.addEventListener("click", () => editor.undo());
document.querySelector("#redo")!.addEventListener("click", () => editor.redo());
mount(samples.basic);
