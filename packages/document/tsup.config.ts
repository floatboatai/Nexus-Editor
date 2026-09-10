import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/html.ts", "src/csv.ts", "src/docx.ts", "src/pdf-text.ts",
    "src/render.ts", "src/export-html.ts", "src/gfm.ts", "src/math.ts", "src/mermaid.ts", "src/runtime.ts",
    "src/node-worker.ts", "src/browser-worker.ts", "src/assets.ts",
    "src/worker-node.ts", "src/worker-browser.ts"],
  format: ["esm"],
  platform: "neutral",
  target: "es2022",
  splitting: true,
  dts: true,
  clean: true,
  external: ["node:worker_threads", "node:fs/promises", "node:module", "node:crypto"],
});
