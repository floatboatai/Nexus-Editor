import path from "node:path";
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

const coreRequire = createRequire(path.resolve(__dirname, "packages/core/package.json"));
const searchPluginRequire = createRequire(path.resolve(__dirname, "packages/plugin-search/package.json"));
const resolveCodeMirrorEsm = (resolver: NodeJS.Require, id: string) =>
  resolver.resolve(id).replace(/index\.cjs$/, "index.js");
const codemirrorAliases = {
  "@codemirror/autocomplete": resolveCodeMirrorEsm(coreRequire, "@codemirror/autocomplete"),
  "@codemirror/commands": resolveCodeMirrorEsm(coreRequire, "@codemirror/commands"),
  "@codemirror/lang-markdown": resolveCodeMirrorEsm(coreRequire, "@codemirror/lang-markdown"),
  "@codemirror/language": resolveCodeMirrorEsm(coreRequire, "@codemirror/language"),
  "@codemirror/search": resolveCodeMirrorEsm(searchPluginRequire, "@codemirror/search"),
  "@codemirror/state": resolveCodeMirrorEsm(coreRequire, "@codemirror/state"),
  "@codemirror/view": resolveCodeMirrorEsm(coreRequire, "@codemirror/view")
};
const codemirrorPackages = Object.keys(codemirrorAliases);

export default defineConfig({
  resolve: {
    alias: {
      ...codemirrorAliases,
      "@floatboat/nexus-core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@floatboat/nexus-react": path.resolve(__dirname, "packages/react/src/index.ts"),
      "@floatboat/nexus-vue": path.resolve(__dirname, "packages/vue/src/index.ts"),
      "@floatboat/nexus-preset-gfm": path.resolve(__dirname, "packages/preset-gfm/src/index.ts"),
      "@floatboat/nexus-plugin-slash": path.resolve(__dirname, "packages/plugin-slash/src/index.ts"),
      "@floatboat/nexus-plugin-history": path.resolve(__dirname, "packages/plugin-history/src/index.ts"),
      "@floatboat/nexus-plugin-search": path.resolve(__dirname, "packages/plugin-search/src/index.ts"),
      "@floatboat/nexus-plugin-toolbar": path.resolve(__dirname, "packages/plugin-toolbar/src/index.ts"),
      "@floatboat/nexus-plugin-math": path.resolve(__dirname, "packages/plugin-math/src/index.ts"),
      "@floatboat/nexus-plugin-vim": path.resolve(__dirname, "packages/plugin-vim/src/index.ts"),
      "@floatboat/nexus-plugin-wordcount": path.resolve(__dirname, "packages/plugin-wordcount/src/index.ts")
    },
    dedupe: codemirrorPackages
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"]
  }
});
