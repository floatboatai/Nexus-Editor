import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/legacy.ts"],
  format: ["esm"],
  platform: "browser",
  target: "es2022",
  dts: true,
  clean: true,
  splitting: false,
  noExternal: ["iconv-lite", "safer-buffer", "buffer", "base64-js", "ieee754"],
  esbuildOptions(options) {
    options.alias = { ...options.alias, buffer: "buffer/" };
  },
});
