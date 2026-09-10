import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@floatboat/nexus-plugin-search/search-worker?worker&inline": `${path.resolve(__dirname, "packages/plugin-search/src/search-worker.ts")}?worker&inline`,
      "@floatboat/nexus-document/worker-browser?worker&inline": `${path.resolve(__dirname, "packages/document/src/worker-browser.ts")}?worker&inline`,
      "@floatboat/nexus-plugin-search/search-worker": path.resolve(__dirname, "packages/plugin-search/src/search-worker.ts"),
      "@floatboat/nexus-document/worker-browser": path.resolve(__dirname, "packages/document/src/worker-browser.ts"),
      "@floatboat/nexus-text-codec/legacy": path.resolve(__dirname, "packages/text-codec/src/legacy.ts"),
      "@floatboat/nexus-text-codec": path.resolve(__dirname, "packages/text-codec/src/index.ts"),
      "@floatboat/nexus-document-history": path.resolve(__dirname, "packages/document-history/src/index.ts"),
      "@floatboat/nexus-document/html": path.resolve(__dirname, "packages/document/src/html.ts"),
      "@floatboat/nexus-document/gfm": path.resolve(__dirname, "packages/document/src/gfm.ts"),
      "@floatboat/nexus-document/math": path.resolve(__dirname, "packages/document/src/math.ts"),
      "@floatboat/nexus-document/mermaid": path.resolve(__dirname, "packages/document/src/mermaid.ts"),
      "@floatboat/nexus-document/runtime": path.resolve(__dirname, "packages/document/src/runtime.ts"),
      "@floatboat/nexus-document/csv": path.resolve(__dirname, "packages/document/src/csv.ts"),
      "@floatboat/nexus-document/docx": path.resolve(__dirname, "packages/document/src/docx.ts"),
      "@floatboat/nexus-document/pdf-text": path.resolve(__dirname, "packages/document/src/pdf-text.ts"),
      "@floatboat/nexus-document/render": path.resolve(__dirname, "packages/document/src/render.ts"),
      "@floatboat/nexus-document/export-html": path.resolve(__dirname, "packages/document/src/export-html.ts"),
      "@floatboat/nexus-document/node-worker": path.resolve(__dirname, "packages/document/src/node-worker.ts"),
      "@floatboat/nexus-document/browser-worker": path.resolve(__dirname, "packages/document/src/browser-worker.ts"),
      "@floatboat/nexus-document/assets": path.resolve(__dirname, "packages/document/src/assets.ts"),
      "@floatboat/nexus-document": path.resolve(__dirname, "packages/document/src/index.ts"),
      "@floatboat/nexus-plugin-search/fuzzy": path.resolve(__dirname, "packages/plugin-search/src/fuzzy.ts"),
      "@floatboat/nexus-plugin-search/workspace": path.resolve(__dirname, "packages/plugin-search/src/workspace.ts"),
      "@floatboat/nexus-plugin-search/headless": path.resolve(__dirname, "packages/plugin-search/src/headless.ts"),
      "@floatboat/nexus-plugin-search/browser-worker": path.resolve(__dirname, "packages/plugin-search/src/browser-worker.ts"),
      "@floatboat/nexus-plugin-search/node-worker": path.resolve(__dirname, "packages/plugin-search/src/node-worker.ts"),
      "@floatboat/nexus-core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@floatboat/nexus-plugin-api": path.resolve(__dirname, "packages/plugin-api/src/index.ts"),
      "@floatboat/nexus-plugin-runtime": path.resolve(__dirname, "packages/plugin-runtime/src/index.ts"),
      "@floatboat/nexus-react": path.resolve(__dirname, "packages/react/src/index.ts"),
      "@floatboat/nexus-vue": path.resolve(__dirname, "packages/vue/src/index.ts"),
      "@floatboat/nexus-preset-gfm": path.resolve(__dirname, "packages/preset-gfm/src/index.ts"),
      "@floatboat/nexus-plugin-slash": path.resolve(__dirname, "packages/plugin-slash/src/index.ts"),
      "@floatboat/nexus-plugin-history": path.resolve(__dirname, "packages/plugin-history/src/index.ts"),
      "@floatboat/nexus-plugin-search": path.resolve(__dirname, "packages/plugin-search/src/index.ts"),
      "@floatboat/nexus-plugin-toolbar": path.resolve(__dirname, "packages/plugin-toolbar/src/index.ts"),
      "@floatboat/nexus-plugin-math": path.resolve(__dirname, "packages/plugin-math/src/index.ts"),
      "@floatboat/nexus-plugin-vim": path.resolve(__dirname, "packages/plugin-vim/src/index.ts"),
      "@floatboat/nexus-plugin-wordcount": path.resolve(__dirname, "packages/plugin-wordcount/src/index.ts"),
      "@floatboat/nexus-reference-plugins": path.resolve(__dirname, "packages/reference-plugins/src/index.ts")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"]
  }
});
