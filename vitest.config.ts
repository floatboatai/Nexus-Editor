import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@nexus/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@nexus/react": path.resolve(__dirname, "packages/react/src/index.ts"),
      "@nexus/vue": path.resolve(__dirname, "packages/vue/src/index.ts"),
      "@nexus/preset-gfm": path.resolve(__dirname, "packages/preset-gfm/src/index.ts"),
      "@nexus/plugin-slash": path.resolve(__dirname, "packages/plugin-slash/src/index.ts"),
      "@nexus/plugin-history": path.resolve(__dirname, "packages/plugin-history/src/index.ts"),
      "@nexus/plugin-search": path.resolve(__dirname, "packages/plugin-search/src/index.ts"),
      "@nexus/plugin-toolbar": path.resolve(__dirname, "packages/plugin-toolbar/src/index.ts")
    }
  },
  test: {
    environment: "jsdom"
  }
});
