/**
 * Core-editor scenarios: how expensive is one cursor move / one document
 * replace as the document grows, and what does the first render cost.
 */
import { createEditor } from "../../packages/core/dist/index.js";
import { buildDocument } from "./documents.mjs";

function mount(initialValue) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({ container, initialValue, livePreview: true });
  return { editor, container };
}

export function run(measure) {
  const rows = [];
  const sizes = [
    { blocks: 20, label: "~4KB" },
    { blocks: 100, label: "~23KB" },
    { blocks: 400, label: "~96KB" },
  ];

  for (const size of sizes) {
    const doc = buildDocument(size.blocks);
    const { editor, container } = mount(doc);
    const step = Math.max(1, Math.floor(doc.length / 30));
    const targets = [];
    for (let pos = 0; pos < doc.length; pos += step) targets.push(pos);
    let index = 0;
    const sample = measure(() => {
      editor.setSelection(targets[index % targets.length]);
      index += 1;
    });
    rows.push({
      scenario: "live-preview/cursor-move",
      subject: `doc ${size.label} (${size.blocks} sections)`,
      metric: "median",
      value: sample.median,
      unit: "ms",
    });
    rows.push({
      scenario: "live-preview/cursor-move",
      subject: `doc ${size.label} (${size.blocks} sections)`,
      metric: "p95",
      value: sample.p95,
      unit: "ms",
    });
    editor.destroy();
    container.remove();
  }

  // Full document replace on the largest document (cache-cold rebuild path).
  {
    const doc = buildDocument(400);
    const { editor, container } = mount(doc);
    const sample = measure(() => {
      editor.setDocument(doc);
    });
    rows.push({
      scenario: "live-preview/set-document",
      subject: "doc ~96KB",
      metric: "median",
      value: sample.median,
      unit: "ms",
    });
    editor.destroy();
    container.remove();
  }

  // First render of a fresh editor (module warm-up already done by the runs above).
  {
    const doc = buildDocument(100);
    const sample = measure(() => {
      const { editor, container } = mount(doc);
      editor.destroy();
      container.remove();
    });
    rows.push({
      scenario: "live-preview/create-editor",
      subject: "doc ~23KB",
      metric: "median",
      value: sample.median,
      unit: "ms",
    });
  }

  return rows;
}
