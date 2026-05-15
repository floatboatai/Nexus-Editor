import { describe, expect, it } from "vitest";
import { createEditor } from "../src/index";

function generateDoc(lines: number, withMarkdown = false): string {
  const parts: string[] = [];
  for (let i = 0; i < lines; i++) {
    if (withMarkdown && i % 10 === 0) {
      parts.push(`## Section ${i / 10 + 1}`);
      continue;
    }
    if (withMarkdown && i % 7 === 0) {
      parts.push(`- list item ${i}`);
      continue;
    }
    if (withMarkdown && i % 13 === 0) {
      parts.push("```\ncode block line 1\ncode block line 2\n```");
      continue;
    }
    parts.push(`Line ${i + 1}: ${"word ".repeat(5)}`.trim());
  }
  return parts.join("\n");
}

function measure(fn: () => void, warmup = 3, runs = 10): { avg: number; min: number; max: number; p50: number } {
  for (let i = 0; i < warmup; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    avg: times.reduce((s, t) => s + t, 0) / runs,
    min: times[0],
    max: times[times.length - 1],
    p50: times[Math.floor(runs / 2)],
  };
}

describe("editor performance benchmarks", () => {
  it("createEditor with 100-line doc completes under 200ms (p50)", () => {
    const doc = generateDoc(100);
    const containers: HTMLElement[] = [];
    const result = measure(() => {
      const c = document.createElement("div");
      containers.push(c);
      createEditor({ container: c, initialValue: doc }).destroy();
    });
    expect(result.p50).toBeLessThan(200);
  });

  it("createEditor with 1000-line doc completes under 500ms (p50)", () => {
    const doc = generateDoc(1000);
    const containers: HTMLElement[] = [];
    const result = measure(() => {
      const c = document.createElement("div");
      containers.push(c);
      createEditor({ container: c, initialValue: doc }).destroy();
    });
    expect(result.p50).toBeLessThan(500);
  });

  it("createEditor with markdown content completes under 300ms (p50)", () => {
    const doc = generateDoc(200, true);
    const containers: HTMLElement[] = [];
    const result = measure(() => {
      const c = document.createElement("div");
      containers.push(c);
      createEditor({ container: c, initialValue: doc }).destroy();
    });
    expect(result.p50).toBeLessThan(300);
  });

  it("setDocument on 500-line doc completes under 200ms (p50)", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "start" });
    const doc = generateDoc(500);

    const result = measure(() => editor.setDocument(doc));
    expect(result.p50).toBeLessThan(200);
    editor.destroy();
  });

  it("getAst on 200-line markdown completes under 100ms (p50)", () => {
    const doc = generateDoc(200, true);
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: doc });

    const result = measure(() => { editor.getAst(); });
    expect(result.p50).toBeLessThan(100);
    editor.destroy();
  });

  it("getDocumentStats returns correct counts for large doc", () => {
    const doc = generateDoc(300);
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: doc });

    const stats = editor.getDocumentStats();
    expect(stats.lines).toBe(300);
    expect(stats.characters).toBeGreaterThan(0);
    expect(stats.words).toBeGreaterThan(0);
    editor.destroy();
  });

  it("exportHTML on 200-line markdown completes under 200ms (p50)", () => {
    const doc = generateDoc(200, true);
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: doc });

    const result = measure(() => { editor.exportHTML(); });
    expect(result.p50).toBeLessThan(200);
    editor.destroy();
  });
});
