import { spawn } from "node:child_process";
import { build } from "tsup";
import { resolve } from "node:path";

await build({
  entry: ["electron/main.ts", "electron/preload.ts"],
  outDir: "dist-electron",
  format: "cjs",
  platform: "node",
  external: ["electron"],
  clean: true,
  silent: true,
});

await new Promise((resolve) => setTimeout(resolve, 2000));

// 使用绝对路径，绕过 require('electron')
const electronPath = resolve(process.cwd(), "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");

console.log(`Starting Electron: ${electronPath}`);

const child = spawn(electronPath, ["dist-electron/main.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: "http://localhost:5173",
  },
});

child.on("close", (code) => process.exit(code));
