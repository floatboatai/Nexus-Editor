import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["electron/main.ts", "electron/preload.ts"],
  outDir: "dist-electron",
  format: "cjs",
  platform: "node",
  external: ["electron"],
  // Packaged demos ship dist only, without workspace packages in node_modules.
  noExternal: [/^@floatboat\/nexus-(?:text-codec|document-history|document)(?:\/|$)/],
  clean: true,
});
