import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts", "src/fuzzy.ts", "src/workspace.ts", "src/headless.ts",
    "src/browser-worker.ts", "src/node-worker.ts",
    "src/search-worker.ts", "src/node-search-worker.ts",
  ],
  format: ["esm"],
  platform: "neutral",
  target: "es2022",
  external: ["node:worker_threads"],
  splitting: true,
  dts: true,
  clean: true,
});
