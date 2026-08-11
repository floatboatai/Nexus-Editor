import { defineConfig } from "@playwright/test";

/**
 * CASE 级 Playwright 配置 — 仅覆盖撤销重做插件用例目录。
 * 独立于项目根 config（testDir=./test/e2e），使 RUN-*.spec.ts 可被运行。
 */
export default defineConfig({
  testDir: "./",
  testMatch: /RUN-.*\.spec\.ts$/,
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
