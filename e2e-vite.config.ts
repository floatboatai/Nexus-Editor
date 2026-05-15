import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, "e2e"),
  base: "./",
  resolve: {
    alias: {
      "@floatboat/nexus-core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@floatboat/nexus-preset-gfm": path.resolve(__dirname, "packages/preset-gfm/src/index.ts"),
      "@floatboat/nexus-plugin-history": path.resolve(__dirname, "packages/plugin-history/src/index.ts"),
      "@floatboat/nexus-plugin-toolbar": path.resolve(__dirname, "packages/plugin-toolbar/src/index.ts"),
      "@floatboat/nexus-plugin-search": path.resolve(__dirname, "packages/plugin-search/src/index.ts"),
    },
  },
  server: {
    port: 5179,
  },
});
