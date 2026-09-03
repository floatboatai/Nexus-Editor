import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@floatboat/nexus-core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@floatboat/nexus-plugin-collab/assessment": fileURLToPath(
        new URL("../../packages/plugin-collab/src/assessment.ts", import.meta.url),
      ),
      "@floatboat/nexus-plugin-collab/hocuspocus": fileURLToPath(
        new URL("../../packages/plugin-collab/src/hocuspocus-provider.ts", import.meta.url),
      ),
      "@floatboat/nexus-plugin-collab": fileURLToPath(
        new URL("../../packages/plugin-collab/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    // Deployment lifecycle tests use node:test and run via test:deployment.
    include: ["test/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
