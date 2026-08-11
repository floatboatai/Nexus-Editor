import { defineConfig } from "vite";
import path from "node:path";
import { createRequire } from "node:module";

const coreRequire = createRequire(path.resolve(__dirname, "../../packages/core/package.json"));
const searchPluginRequire = createRequire(path.resolve(__dirname, "../../packages/plugin-search/package.json"));
const resolveCodeMirrorEsm = (resolver: NodeJS.Require, id: string) =>
  resolver.resolve(id).replace(/index\.cjs$/, "index.js");
const codemirrorAliases = {
  "@codemirror/autocomplete": resolveCodeMirrorEsm(coreRequire, "@codemirror/autocomplete"),
  "@codemirror/commands": resolveCodeMirrorEsm(coreRequire, "@codemirror/commands"),
  "@codemirror/lang-markdown": resolveCodeMirrorEsm(coreRequire, "@codemirror/lang-markdown"),
  "@codemirror/language": resolveCodeMirrorEsm(coreRequire, "@codemirror/language"),
  "@codemirror/search": resolveCodeMirrorEsm(searchPluginRequire, "@codemirror/search"),
  "@codemirror/state": resolveCodeMirrorEsm(coreRequire, "@codemirror/state"),
  "@codemirror/view": resolveCodeMirrorEsm(coreRequire, "@codemirror/view"),
};
const codemirrorPackages = Object.keys(codemirrorAliases);

export default defineConfig({
  root: path.resolve(__dirname, "src/renderer"),
  base: "./",
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
      ...codemirrorAliases,
      "@floatboat/nexus-core": path.resolve(
        __dirname,
        "../../packages/core/src/index.ts"
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
    },
    dedupe: codemirrorPackages,
  },
  server: {
    port: 5173,
  },
});
