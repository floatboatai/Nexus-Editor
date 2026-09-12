import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

function resolveFromPackage(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: {
      "@floatboat/nexus-core": resolveFromPackage("../core/src/index.ts"),
      "@floatboat/nexus-plugin-api": resolveFromPackage("../plugin-api/src/index.ts"),
      "@floatboat/nexus-plugin-runtime": resolveFromPackage("../plugin-runtime/src/index.ts"),
      "@floatboat/nexus-plugin-history": resolveFromPackage("../plugin-history/src/index.ts"),
      "@floatboat/nexus-plugin-search": resolveFromPackage("../plugin-search/src/index.ts"),
      "@floatboat/nexus-plugin-vim": resolveFromPackage("../plugin-vim/src/index.ts"),
      "@floatboat/nexus-preset-gfm": resolveFromPackage("../preset-gfm/src/index.ts"),
      "@floatboat/nexus-plugin-math": resolveFromPackage("../plugin-math/src/index.ts"),
      "@floatboat/nexus-plugin-formatting": resolveFromPackage("../plugin-formatting/src/index.ts"),
      "@floatboat/nexus-plugin-selection-toolbar": resolveFromPackage("../plugin-selection-toolbar/src/index.ts"),
      "@floatboat/nexus-plugin-toolbar": resolveFromPackage("../plugin-toolbar/src/index.ts"),
      "@floatboat/nexus-plugin-slash": resolveFromPackage("../plugin-slash/src/index.ts"),
      "@floatboat/nexus-plugin-wordcount": resolveFromPackage("../plugin-wordcount/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: [resolveFromPackage("../../vitest.setup.ts")],
  },
});
