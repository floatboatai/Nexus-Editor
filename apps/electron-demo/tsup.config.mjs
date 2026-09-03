import { defineConfig } from "tsup";

export const electronBuildOptions = {
  entry: [
    "electron/main.ts",
    "electron/preload.ts",
    "electron/collab-store-worker.ts",
  ],
  outDir: "dist-electron",
  format: "cjs",
  platform: "node",
  external: ["electron"],
  clean: true,
};

export default defineConfig(electronBuildOptions);
