import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * 启动 Electron Demo 并返回应用实例和首页面。
 *
 * 前提：Vite dev server 已在 localhost:5173 运行——本地为 `pnpm dev:renderer`，
 * CI 下由 workflow 后台启动 dev server（见 .github/workflows/ci.yml 的 e2e job）。
 *
 * electron 二进制从 electron-demo 的依赖解析：electron 是
 * apps/electron-demo 的 devDependency，不在根 node_modules，纯 Node require
 * 语义下无法从本文件位置可靠解析。因此用 createRequire 基于
 * apps/electron-demo/package.json 显式解析，不依赖 Playwright 内部的 require
 * 注入，也不依赖进程 cwd。
 */
export async function launchDemo(): Promise<{ app: ElectronApplication; page: Page }> {
  // 从项目根目录推算 Electron 主进程入口
  // test/e2e/helpers/ → ../../../apps/electron-demo/dist-electron/main.js
  const mainJs = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "apps",
    "electron-demo",
    "dist-electron",
    "main.js",
  );

  // 显式解析 electron 二进制（它是 electron-demo 的 devDependency）
  const demoRequire = createRequire(
    path.resolve(__dirname, "..", "..", "..", "apps", "electron-demo", "package.json"),
  );
  // electronPath 有意不传给 electron.launch（不设 executablePath）：传入 executablePath
  // 会令 Playwright 跳过 -r loader.js 注入，破坏 _electron 连接（spec 评审 F2 已确认）。
  // 此声明仅用于把 electron 作为依赖解析出来（确保其已安装/可下载），launch 走默认查找。
  const electronPath = demoRequire("electron");

  const app = await electron.launch({
    args: [mainJs],
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: "http://localhost:5173",
    },
  });

  const page = await app.firstWindow();
  await page.waitForSelector(".cm-content", { timeout: 15_000 });
  return { app, page };
}
