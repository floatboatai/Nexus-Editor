import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

function resolveFromPackage(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: {
      "@floatboat/nexus-core": resolveFromPackage("../core/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: [resolveFromPackage("../../vitest.setup.ts")],
  },
});
