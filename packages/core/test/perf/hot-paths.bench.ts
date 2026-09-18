/**
 * 作者：tobegold574（2026/9/17）
 * 原因：核心编辑器更新循环的热路径端到端基准。
 * 在仓库根目录运行：pnpm vitest bench --run packages/core/test/perf/hot-paths.bench.ts
 *
 * 场景模拟主要用户交互回路：
 *  1. open+destroy  —— 在约 1MB 文档上 createEditor（StateField.create 成本）
 *  2. cursor-move   —— 纯 selection 事务（方向键/点击路径）
 *  3. keystroke     —— 文档变更事务（打字路径）
 *
 * 合成文档混合了 Electron demo 的真实内容形态：标题、行内格式、围栏代码块、
 * GFM 表格、wiki 链接、图片与引用。注册了一个没有任何 slashMenuChange
 * 监听者的 slash 插件并启用 wikilinks（与 demo 接线一致），使测量的正是
 * "无监听者"路径。
 *
 * cursor-move / keystroke 两个场景共享一个长生命周期编辑器实例（稳态、
 * 缓存已热），使单次耗时只反映更新循环本身。
 *
 * NEXUS_PERF 已关闭：可选择的性能打点控制台输出不参与测量；对比双方
 * （基线/优化后）设置一致，保证公平。
 */
import { bench, describe } from "vitest";

import { createGfmPreset } from "../../../preset-gfm/src/index";
import { createEditor, createWikilinksPlugin, type EditorAPI } from "../../src/index";

(globalThis as { NEXUS_PERF?: boolean }).NEXUS_PERF = false;

const TARGET_DOC_LENGTH = 1_000_000;
const SCRATCH_MARKER = "SCRATCH";
const SCRATCH_BODY_LENGTH = 200;
const MOVES_PER_OP = 10;

function generateDoc(): string {
  const parts: string[] = [];
  let i = 0;
  while (parts.join("").length < TARGET_DOC_LENGTH) {
    parts.push(`## Section ${i}\n\n`);
    parts.push(
      "Plain text with **bold**, *italic*, `inline code`, [a link](https://example.com/x) and some filler prose.\n\n"
    );
    parts.push(`See [[Note ${i}]] and [[Topic/Deep ${i}|alias]].\n\n`);
    parts.push("- list item **one**\n- list item two\n- list item three\n\n");
    const codeLines: string[] = [];
    for (let n = 0; n < 10; n++) {
      codeLines.push(`const value${n} = compute(${n}, ${i});`);
    }
    parts.push("```js\n" + codeLines.join("\n") + "\n```\n\n");
    parts.push("| Col A | Col B | Col C | Col D |\n| --- | --- | --- | --- |\n");
    for (let r = 0; r < 8; r++) {
      parts.push(`| a${r} | **b${r}** | c${r} | [[Ref ${i}-${r}]] |\n`);
    }
    parts.push("\n");
    parts.push(`![chart](https://example.com/img${i}.png)\n\n`);
    parts.push("> quoted text with **emphasis**\n\n");
    i++;
  }
  parts.push(`${SCRATCH_MARKER} ${"a".repeat(SCRATCH_BODY_LENGTH)}\n`);
  return parts.join("");
}

const DOC = generateDoc();
const SCRATCH_START = DOC.indexOf(SCRATCH_MARKER) + SCRATCH_MARKER.length + 1;

const CURSOR_POSITIONS: number[] = [];
for (let p = 500; p < DOC.length; p += 3_000) {
  CURSOR_POSITIONS.push(p);
}

const slashPlugin = {
  name: "bench-slash",
  slashCommands: Array.from({ length: 12 }, (_, k) => ({
    id: `cmd-${k}`,
    title: `Command ${k}`,
    keywords: [`keyword${k}`],
  })),
};

function createBenchEditor(): EditorAPI {
  return createEditor({
    container: document.createElement("div"),
    initialValue: DOC,
    livePreview: true,
    plugins: [createGfmPreset(), createWikilinksPlugin(), slashPlugin],
  });
}

let sharedEditor: EditorAPI | null = null;

function requireSharedEditor(): EditorAPI {
  if (!sharedEditor) sharedEditor = createBenchEditor();
  return sharedEditor;
}

describe(`editor hot paths (~${(DOC.length / 1024).toFixed(0)}KB doc)`, () => {
  bench(
    "open+destroy",
    () => {
      const editor = createBenchEditor();
      editor.destroy();
    },
    { iterations: 4, time: 10000 }
  );

  bench(
    `cursor-move x${MOVES_PER_OP}`,
    () => {
      const editor = requireSharedEditor();
      for (let k = 0; k < MOVES_PER_OP; k++) {
        editor.setSelection(CURSOR_POSITIONS[k % CURSOR_POSITIONS.length]);
      }
    },
    { iterations: 4, time: 10000 }
  );

  bench(
    `keystroke x${MOVES_PER_OP}`,
    () => {
      const editor = requireSharedEditor();
      for (let k = 0; k < MOVES_PER_OP; k++) {
        const at = SCRATCH_START + (k % SCRATCH_BODY_LENGTH);
        editor.replaceRange(at, at + 1, String.fromCharCode(97 + (k % 26)));
      }
    },
    { iterations: 4, time: 10000 }
  );
});
