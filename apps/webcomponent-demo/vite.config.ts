import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  root: "./src",
  build: {
    outDir: "../dist",
    emptyOutDir: true
  },
  resolve: {
    alias: {
      "@floatboat/nexus-webcomponent": path.resolve(__dirname, "../../packages/webcomponent/src/index.ts")
    }
  },
  server: {
    port: 5173
  }
});
