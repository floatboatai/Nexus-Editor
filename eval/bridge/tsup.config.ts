import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsup";

const here = path.dirname(fileURLToPath(import.meta.url));
const coreNodeModules = path.resolve(here, "../../packages/core/node_modules");
const rootNodeModules = path.resolve(here, "../../node_modules");

export default defineConfig({
  entry: ["table-ops-bridge.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  silent: true,
  target: "node18",
  splitting: false,
  external: ["jsdom"],
  esbuildOptions(options) {
    options.nodePaths = [coreNodeModules, rootNodeModules];
  },
});
