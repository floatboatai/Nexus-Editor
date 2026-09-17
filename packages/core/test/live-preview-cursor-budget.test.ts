import { describe, expect, it } from "vitest";

import { createEditor } from "../src/index";

/**
 * Regression budget for live-preview cursor latency (ROADMAP: benchmarks).
 *
 * The assertion is deliberately expressed as a *ratio* between cursor-move
 * latency on a large document and on a small one, not as an absolute
 * millisecond figure — ratios survive slower CI runners and noisy shared
 * machines, absolute times do not.
 *
 * Before per-range decoration reuse, a cursor move rebuilt every decoration
 * in the document, so latency grew linearly with document size (measured
 * ~5.2x from a 4KB to a 96KB document). With reuse, unaffected ranges are
 * re-pushed as-is and the ratio sits around ~2.5x — the remaining growth is
 * CM6's own decoration diff, not our build loop.
 */
const SMALL_SECTIONS = 20;
const LARGE_SECTIONS = 400;
const SAMPLES = 25;
const MAX_SCALING_RATIO = 3.5;

function section(index: number): string {
  return [
    `## Section ${index}`,
    "",
    `Some **bold ${index}** text with a [link ${index}](https://example.com/${index}) and \`inline code ${index}\`.`,
    "",
    `- item ${index}a`,
    `- [ ] task ${index}b`,
    "",
  ].join("\n");
}

function codeBlock(index: number): string {
  const lines = Array.from({ length: 20 }, (_, line) => `const value${line}_${index} = ${index} * ${line};`);
  return "```js\n" + lines.join("\n") + "\n```\n\n";
}

function buildDocument(blocks: number): string {
  let doc = "# Document\n\n";
  for (let i = 0; i < blocks; i++) {
    doc += section(i);
    if (i % 5 === 0) doc += codeBlock(i);
  }
  return doc;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function medianCursorMove(container: HTMLDivElement, doc: string): number {
  const editor = createEditor({ container, initialValue: doc, livePreview: true });
  try {
    const step = Math.max(1, Math.floor(doc.length / SAMPLES));
    const targets: number[] = [];
    for (let pos = 0; pos < doc.length; pos += step) targets.push(pos);

    // Warm-up: JIT, the highlight LRU and the range cache must be hot, exactly
    // like in a running editor where the user has already moved around.
    for (const pos of targets.slice(0, 5)) editor.setSelection(pos);

    const times: number[] = [];
    let index = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const target = targets[index % targets.length];
      index += 1;
      const start = performance.now();
      editor.setSelection(target);
      times.push(performance.now() - start);
    }
    return median(times);
  } finally {
    editor.destroy();
  }
}

describe("live-preview cursor latency budget", () => {
  it("keeps cursor-move latency from scaling linearly with document size", () => {
    const small = document.createElement("div");
    document.body.appendChild(small);
    const large = document.createElement("div");
    document.body.appendChild(large);

    const smallMedian = medianCursorMove(small, buildDocument(SMALL_SECTIONS));
    const largeMedian = medianCursorMove(large, buildDocument(LARGE_SECTIONS));
    const ratio = largeMedian / smallMedian;

    small.remove();
    large.remove();

    // Guard against a degenerate small-document measurement (e.g. a GC pause
    // right after mount) making the ratio meaninglessly large or ~0.
    expect(smallMedian).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(MAX_SCALING_RATIO);
  });
});
