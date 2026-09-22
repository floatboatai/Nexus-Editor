import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
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
      "@floatboat/nexus-plugin-collab": path.resolve(__dirname, "packages/plugin-collab/src/index.ts"),
      "@floatboat/nexus-reference-plugins": path.resolve(__dirname, "packages/reference-plugins/src/index.ts")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["**/.kilo/**", "**/node_modules/**", "**/dist/**"]
  }
});
