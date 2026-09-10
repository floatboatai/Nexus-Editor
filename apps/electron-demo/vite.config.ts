import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, "src/renderer"),
  base: "./",
  worker: { format: "es" },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        // Split large vendor deps out of the main chunk so cold-start
        // doesn't have to parse a single 1.5MB file.
        manualChunks(id) {
          // Vite's dynamic-import preload helper is tiny, but if Rollup places
          // it in the mermaid chunk then the main entry has to statically
          // import mermaid just to call the helper. Keep it in vendor so
          // mermaid remains truly lazy until a diagram widget renders.
          if (id.includes("vite/preload-helper")) return "vendor";
          if (id.includes("node_modules")) {
            if (id.includes("mermaid")) return "mermaid";
            if (id.includes("@codemirror") || id.includes("codemirror")) return "codemirror";
            if (id.includes("highlight.js")) return "hljs";
            if (id.includes("mdast") || id.includes("micromark") || id.includes("unified") || id.includes("remark")) return "markdown";
            if (id.includes("katex")) return "katex";
            return "vendor";
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      "@floatboat/nexus-plugin-search/search-worker?worker&inline": `${path.resolve(
        __dirname,
        "../../packages/plugin-search/src/search-worker.ts"
      )}?worker&inline`,
      "@floatboat/nexus-document/worker-browser?worker&inline": `${path.resolve(
        __dirname,
        "../../packages/document/dist/worker-browser.js"
      )}?worker&inline`,
      "@floatboat/nexus-plugin-search/search-worker": path.resolve(
        __dirname,
        "../../packages/plugin-search/src/search-worker.ts"
      ),
      "@floatboat/nexus-plugin-search/browser-worker": path.resolve(
        __dirname,
        "../../packages/plugin-search/src/browser-worker.ts"
      ),
      "@floatboat/nexus-plugin-search/headless": path.resolve(
        __dirname,
        "../../packages/plugin-search/src/headless.ts"
      ),
      "@floatboat/nexus-plugin-search/workspace": path.resolve(
        __dirname,
        "../../packages/plugin-search/src/workspace.ts"
      ),
      "@floatboat/nexus-plugin-search/fuzzy": path.resolve(
        __dirname,
        "../../packages/plugin-search/src/fuzzy.ts"
      ),
      "@floatboat/nexus-document/worker-browser": path.resolve(
        __dirname,
        "../../packages/document/dist/worker-browser.js"
      ),
      "@floatboat/nexus-document/browser-worker": path.resolve(
        __dirname,
        "../../packages/document/dist/browser-worker.js"
      ),
      "@floatboat/nexus-document/export-html": path.resolve(
        __dirname,
        "../../packages/document/src/export-html.ts"
      ),
      "@floatboat/nexus-document/pdf-text": path.resolve(
        __dirname,
        "../../packages/document/src/pdf-text.ts"
      ),
      "@floatboat/nexus-document/render": path.resolve(
        __dirname,
        "../../packages/document/src/render.ts"
      ),
      "@floatboat/nexus-document/assets": path.resolve(
        __dirname,
        "../../packages/document/src/assets.ts"
      ),
      "@floatboat/nexus-document/html": path.resolve(
        __dirname,
        "../../packages/document/src/html.ts"
      ),
      "@floatboat/nexus-document/csv": path.resolve(
        __dirname,
        "../../packages/document/src/csv.ts"
      ),
      "@floatboat/nexus-document/docx": path.resolve(
        __dirname,
        "../../packages/document/src/docx.ts"
      ),
      "@floatboat/nexus-document/gfm": path.resolve(
        __dirname,
        "../../packages/document/src/gfm.ts"
      ),
      "@floatboat/nexus-document/math": path.resolve(
        __dirname,
        "../../packages/document/src/math.ts"
      ),
      "@floatboat/nexus-document/mermaid": path.resolve(
        __dirname,
        "../../packages/document/src/mermaid.ts"
      ),
      "@floatboat/nexus-document/runtime": path.resolve(
        __dirname,
        "../../packages/document/src/runtime.ts"
      ),
      "@floatboat/nexus-document-history": path.resolve(
        __dirname,
        "../../packages/document-history/src/index.ts"
      ),
      "@floatboat/nexus-document": path.resolve(
        __dirname,
        "../../packages/document/src/index.ts"
      ),
      "@floatboat/nexus-text-codec/legacy": path.resolve(
        __dirname,
        "../../packages/text-codec/src/legacy.ts"
      ),
      "@floatboat/nexus-text-codec": path.resolve(
        __dirname,
        "../../packages/text-codec/src/index.ts"
      ),
      "@floatboat/nexus-core": path.resolve(
        __dirname,
        "../../packages/core/src/index.ts"
      ),
      "@floatboat/nexus-plugin-api": path.resolve(
        __dirname,
        "../../packages/plugin-api/src/index.ts"
      ),
      "@floatboat/nexus-plugin-runtime": path.resolve(
        __dirname,
        "../../packages/plugin-runtime/src/index.ts"
      ),
      "@floatboat/nexus-preset-gfm": path.resolve(
        __dirname,
        "../../packages/preset-gfm/src/index.ts"
      ),
      "@floatboat/nexus-plugin-history": path.resolve(
        __dirname,
        "../../packages/plugin-history/src/index.ts"
      ),
      "@floatboat/nexus-plugin-toolbar": path.resolve(
        __dirname,
        "../../packages/plugin-toolbar/src/index.ts"
      ),
      "@floatboat/nexus-plugin-search": path.resolve(
        __dirname,
        "../../packages/plugin-search/src/index.ts"
      ),
      "@floatboat/nexus-plugin-slash": path.resolve(
        __dirname,
        "../../packages/plugin-slash/src/index.ts"
      ),
      "@floatboat/nexus-plugin-wordcount": path.resolve(
        __dirname,
        "../../packages/plugin-wordcount/src/index.ts"
      ),
      "@floatboat/nexus-reference-plugins": path.resolve(
        __dirname,
        "../../packages/reference-plugins/src/index.ts"
      ),
    },
  },
  server: {
    port: 5173,
  },
});
