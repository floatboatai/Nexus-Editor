/**
 * Public-API scenarios that do not touch the live preview: HTML export and
 * read-only accessors.
 */
import { createEditor } from "../../packages/core/dist/index.js";
import { buildDocument } from "./documents.mjs";

function mount(initialValue) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({ container, initialValue, plugins: [] });
  return { editor, container };
}

export function run(measure) {
  const rows = [];
  const doc = buildDocument(100);
  const { editor, container } = mount(doc);

  const scenarios = [
    { scenario: "api/export-html", call: () => editor.exportHTML() },
    { scenario: "api/get-ast", call: () => editor.getAst() },
    { scenario: "api/get-document-stats", call: () => editor.getDocumentStats() },
  ];

  for (const { scenario, call } of scenarios) {
    const sample = measure(call);
    rows.push({
      scenario,
      subject: "doc ~23KB",
      metric: "median",
      value: sample.median,
      unit: "ms",
    });
  }

  editor.destroy();
  container.remove();
  return rows;
}
