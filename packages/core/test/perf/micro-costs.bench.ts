/**
 * 作者：tobegold574（2026/9/17）
 * 原因：微成本基准，逐项度量热路径优化所消除的确切工作量。这些操作都是
 * 纯 JS（无 CodeMirror view、无 DOM），数字稳定且可直接归因：
 *
 *   每次光标移动，原实现要执行：
 *     - 1 次 collectLivePreviewRanges（全 AST 遍历 + 2 次全文档正则扫描
 *       + 排序）            → 现在走缓存，0 次
 *     - 2 次 state.doc.toString()（全文档物化）
 *                           → 现在按 Text 身份缓存，命中时 0 次
 *     - 1 次 scanWikiLinks（wikilinks StateField 重建）
 *                           → 现在由 Text 键扫描缓存供给
 *
 *   每次击键还额外为每个未变更的围栏代码块重新分配 rebase 后的高亮 token，
 *   并让每个块从下标 0 重扫全局 token 数组（O(块数 × token 总数)）。
 *
 * 在仓库根目录运行：pnpm vitest bench --run packages/core/test/perf/micro-costs.bench.ts
 */
import { EditorState } from "@codemirror/state";
import { bench, describe } from "vitest";

import { lezerStringToMdast } from "../../src/lezer-mdast-adapter";
import { collectLivePreviewRanges } from "../../src/live-preview-ranges";
import { highlightCodeBlock } from "../../src/live-preview-highlight";
import { scanWikiLinks } from "../../src/wikilinks";

(globalThis as { NEXUS_PERF?: boolean }).NEXUS_PERF = false;

const TARGET_DOC_LENGTH = 1_000_000;

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
  return parts.join("");
}

const DOC = generateDoc();
const AST = lezerStringToMdast(DOC);
const EMPTY_SELECTION = [] as never[];

describe(`micro-costs of eliminated work (~${(DOC.length / 1024).toFixed(0)}KB doc)`, () => {
  bench("collectLivePreviewRanges [per cursor-move, now cached]", () => {
    collectLivePreviewRanges(AST, DOC, EMPTY_SELECTION);
  });

  bench("state.doc.toString [x2 per update, now 0x on cache hit]", () => {
    void EditorState.create({ doc: DOC }).doc.toString();
  });

  bench("scanWikiLinks [per wikilinks rebuild, now cached on cursor-move]", () => {
    scanWikiLinks(DOC);
  });

  bench("highlightCodeBlock rebase-map [per unchanged code block, now memoized]", () => {
    highlightCodeBlock("js", "const value0 = compute(0, 0);\nconst value1 = compute(1, 0);", 12_345);
  });
});
