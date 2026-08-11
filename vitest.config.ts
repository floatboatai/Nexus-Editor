import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@floatboat/nexus-core": path.resolve(__dirname, "packages/core/src/index.ts"),
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
      // pnpm 隔离环境下 @codemirror/* 仅存在于 packages/core/node_modules，
      // 供根目录 test/testcases/ 下的 RUN-*.test.ts 直接 import（tcAIrunner 通道）
      "@codemirror/view": path.resolve(__dirname, "packages/core/node_modules/@codemirror/view/dist/index.js"),
      "@codemirror/state": path.resolve(__dirname, "packages/core/node_modules/@codemirror/state/dist/index.js"),
      "@codemirror/language": path.resolve(__dirname, "packages/core/node_modules/@codemirror/language/dist/index.js"),
      // mermaid 同样仅存在于 packages/core/node_modules。根目录 RUN-*.test.ts
      // 需 vi.mock("mermaid") 拦截 dynamic import（E01/E02），必须先能解析。
      "mermaid": path.resolve(__dirname, "packages/core/node_modules/mermaid")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    server: {
      deps: {
        // mermaid 默认被 externalize，vi.mock 无法拦截 dynamic import。
        // inline 后 RUN-FP-05-03-E01/E02 的 vi.mock("mermaid") 才能生效。
        inline: ["mermaid"]
      }
    }
  }
});
