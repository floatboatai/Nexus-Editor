"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// electron/main.ts
var main_exports = {};
module.exports = __toCommonJS(main_exports);
var import_electron = require("electron");
var import_promises = require("fs/promises");
var import_node_fs = require("fs");
var import_node_path = __toESM(require("path"));
var import_node_url = require("url");
import_electron.protocol.registerSchemesAsPrivileged([
  {
    scheme: "nexus-vault",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
]);
var mainWindow = null;
var SUPPORTED_EXT = /* @__PURE__ */ new Set([".md", ".markdown", ".txt"]);
var SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", ".svn", ".hg", ".DS_Store"]);
var activeVault = null;
var activeWatcher = null;
function createWindow() {
  mainWindow = new import_electron.BrowserWindow({
    width: 1024,
    height: 768,
    // Hide until the renderer has painted — avoids the white-flash window and
    // stops the dock bounce earlier (macOS treats `ready-to-show` as "app
    // finished launching"). Default behavior shows a blank window the moment
    // the BrowserWindow is created, and the dock keeps bouncing until the
    // renderer reports first paint anyway.
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: import_node_path.default.join(__dirname, "preload.js")
    }
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(import_node_path.default.join(__dirname, "../dist/index.html"));
  }
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    const meta = input.meta || input.control;
    if (input.type === "keyDown") {
      if (meta && input.shift && (input.key === "I" || input.key === "i") || input.key === "F12") {
        mainWindow?.webContents.toggleDevTools();
      }
    }
  });
}
import_electron.ipcMain.handle("demo:open-file", async () => {
  if (!mainWindow) return null;
  const result = await import_electron.dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "txt"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const content = await (0, import_promises.readFile)(filePath, "utf-8");
  return { path: filePath, content };
});
import_electron.ipcMain.handle(
  "demo:save-file",
  async (_event, filePath, content) => {
    await (0, import_promises.writeFile)(filePath, content, "utf-8");
    return { path: filePath };
  }
);
import_electron.ipcMain.handle(
  "demo:save-file-as",
  async (_event, content) => {
    if (!mainWindow) return null;
    const result = await import_electron.dialog.showSaveDialog(mainWindow, {
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });
    if (result.canceled || !result.filePath) return null;
    await (0, import_promises.writeFile)(result.filePath, content, "utf-8");
    return { path: result.filePath };
  }
);
function assertInsideVault(target) {
  if (!activeVault) {
    throw new Error("No active vault");
  }
  const resolved = import_node_path.default.resolve(target);
  const rel = import_node_path.default.relative(activeVault, resolved);
  if (rel === "" || rel === ".") return resolved;
  if (rel.startsWith("..") || import_node_path.default.isAbsolute(rel)) {
    throw new Error(`Path escapes vault: ${target}`);
  }
  return resolved;
}
async function scanDirectory(dir) {
  const entries = await (0, import_promises.readdir)(dir, { withFileTypes: true });
  const nodes = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;
    const childPath = import_node_path.default.join(dir, entry.name);
    if (entry.isDirectory()) {
      const children = await scanDirectory(childPath);
      if (children.length > 0) {
        nodes.push({
          name: entry.name,
          path: childPath,
          kind: "directory",
          children
        });
      }
      continue;
    }
    if (entry.isFile()) {
      const ext = import_node_path.default.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXT.has(ext)) continue;
      nodes.push({ name: entry.name, path: childPath, kind: "file" });
    }
  }
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}
function debounce(fn, ms) {
  let timer = null;
  return ((...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  });
}
function stopWatcher() {
  if (activeWatcher) {
    try {
      activeWatcher.close();
    } catch {
    }
    activeWatcher = null;
  }
}
function startWatcher(vaultPath) {
  stopWatcher();
  const notify = debounce(() => {
    mainWindow?.webContents.send("vault:changed", { vault: vaultPath });
  }, 150);
  try {
    activeWatcher = (0, import_node_fs.watch)(vaultPath, { recursive: true }, () => notify());
  } catch (err) {
    try {
      activeWatcher = (0, import_node_fs.watch)(vaultPath, () => notify());
    } catch (innerErr) {
      console.warn("[vault] watcher init failed:", innerErr);
      activeWatcher = null;
    }
  }
}
function vaultStatePath() {
  return import_node_path.default.join(import_electron.app.getPath("userData"), "vault.json");
}
async function readVaultState() {
  const file = vaultStatePath();
  if (!(0, import_node_fs.existsSync)(file)) return { lastVault: null, recents: [] };
  try {
    const raw = await (0, import_promises.readFile)(file, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      lastVault: typeof parsed.lastVault === "string" ? parsed.lastVault : null,
      recents: Array.isArray(parsed.recents) ? parsed.recents.filter((r) => typeof r === "string") : []
    };
  } catch {
    return { lastVault: null, recents: [] };
  }
}
async function writeVaultState(state) {
  await (0, import_promises.writeFile)(vaultStatePath(), JSON.stringify(state, null, 2), "utf-8");
}
import_electron.ipcMain.handle("vault:pick", async () => {
  if (!mainWindow) return null;
  const result = await import_electron.dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return { path: result.filePaths[0] };
});
import_electron.ipcMain.handle("vault:list", async (_event, vaultPath) => {
  const abs = import_node_path.default.resolve(vaultPath);
  const info = await (0, import_promises.stat)(abs);
  if (!info.isDirectory()) throw new Error(`Not a directory: ${abs}`);
  activeVault = abs;
  startWatcher(abs);
  return scanDirectory(abs);
});
import_electron.ipcMain.handle("vault:read", async (_event, filePath) => {
  const abs = assertInsideVault(filePath);
  const content = await (0, import_promises.readFile)(abs, "utf-8");
  return { path: abs, content };
});
async function collectFiles(dir, acc) {
  const entries = await (0, import_promises.readdir)(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const childPath = import_node_path.default.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(childPath, acc);
      continue;
    }
    if (entry.isFile() && SUPPORTED_EXT.has(import_node_path.default.extname(entry.name).toLowerCase())) {
      acc.push(childPath);
    }
  }
}
import_electron.ipcMain.handle("vault:read-all", async () => {
  if (!activeVault) return [];
  const paths = [];
  await collectFiles(activeVault, paths);
  const CONCURRENCY = 32;
  const out = [];
  let cursor = 0;
  async function worker() {
    while (cursor < paths.length) {
      const i = cursor++;
      const p = paths[i];
      try {
        const abs = assertInsideVault(p);
        const content = await (0, import_promises.readFile)(abs, "utf-8");
        out.push({ path: abs, content });
      } catch {
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker));
  return out;
});
import_electron.ipcMain.handle("vault:write", async (_event, filePath, content) => {
  const abs = assertInsideVault(filePath);
  await (0, import_promises.writeFile)(abs, content, "utf-8");
  return { path: abs };
});
import_electron.ipcMain.handle(
  "vault:create-file",
  async (_event, parentDir, name) => {
    const safeInput = name.trim() || "untitled";
    const normInput = safeInput.replace(/\\/g, "/");
    const segments = normInput.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) throw new Error("Invalid file name");
    const baseNameRaw = segments.pop();
    const subDirs = segments.join("/");
    const parent = assertInsideVault(
      subDirs ? import_node_path.default.join(parentDir, subDirs) : parentDir
    );
    if (subDirs) {
      await (0, import_promises.mkdir)(parent, { recursive: true });
    }
    const hasExt = SUPPORTED_EXT.has(import_node_path.default.extname(baseNameRaw).toLowerCase());
    const baseName = hasExt ? baseNameRaw : `${baseNameRaw}.md`;
    const ext = import_node_path.default.extname(baseName);
    const stem = baseName.slice(0, baseName.length - ext.length);
    let candidate = import_node_path.default.join(parent, baseName);
    let suffix = 1;
    while ((0, import_node_fs.existsSync)(candidate)) {
      candidate = import_node_path.default.join(parent, `${stem}-${suffix}${ext}`);
      suffix += 1;
    }
    const finalPath = assertInsideVault(candidate);
    await (0, import_promises.writeFile)(finalPath, "", "utf-8");
    return { path: finalPath };
  }
);
import_electron.ipcMain.handle(
  "vault:create-folder",
  async (_event, parentDir, name) => {
    const parent = assertInsideVault(parentDir);
    const safeName = name.trim() || "new-folder";
    const target = assertInsideVault(import_node_path.default.join(parent, safeName));
    if ((0, import_node_fs.existsSync)(target)) {
      throw new Error(`Folder already exists: ${safeName}`);
    }
    await (0, import_promises.mkdir)(target, { recursive: false });
    return { path: target };
  }
);
import_electron.ipcMain.handle(
  "vault:rename",
  async (_event, oldPath, newName) => {
    const src = assertInsideVault(oldPath);
    const parent = import_node_path.default.dirname(src);
    const trimmed = newName.trim();
    if (!trimmed) throw new Error("New name cannot be empty");
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      throw new Error("New name cannot contain path separators");
    }
    const target = assertInsideVault(import_node_path.default.join(parent, trimmed));
    if ((0, import_node_fs.existsSync)(target) && target !== src) {
      throw new Error(`Target already exists: ${trimmed}`);
    }
    await (0, import_promises.rename)(src, target);
    return { path: target };
  }
);
import_electron.ipcMain.handle("vault:delete", async (_event, targetPath) => {
  const abs = assertInsideVault(targetPath);
  await import_electron.shell.trashItem(abs);
  return { ok: true };
});
import_electron.ipcMain.handle("vault:get-last", async () => {
  const state = await readVaultState();
  if (state.lastVault && !(0, import_node_fs.existsSync)(state.lastVault)) {
    const cleaned = {
      lastVault: null,
      recents: state.recents.filter((r) => (0, import_node_fs.existsSync)(r))
    };
    await writeVaultState(cleaned);
    return cleaned;
  }
  return state;
});
import_electron.ipcMain.handle("vault:set-last", async (_event, vaultPath) => {
  const current = await readVaultState();
  const recents = [vaultPath, ...current.recents.filter((r) => r !== vaultPath)].slice(0, 10);
  await writeVaultState({ lastVault: vaultPath, recents });
  return { ok: true };
});
import_electron.app.whenReady().then(() => {
  import_electron.protocol.handle("nexus-vault", async (request) => {
    try {
      if (!activeVault) return new Response("No active vault", { status: 404 });
      const url = new URL(request.url);
      const relPath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      if (!relPath) return new Response("Empty path", { status: 400 });
      const abs = import_node_path.default.resolve(activeVault, relPath);
      const rel = import_node_path.default.relative(activeVault, abs);
      if (rel.startsWith("..") || import_node_path.default.isAbsolute(rel)) {
        return new Response("Path escapes vault", { status: 403 });
      }
      if (!(0, import_node_fs.existsSync)(abs)) return new Response("Not found", { status: 404 });
      return import_electron.net.fetch((0, import_node_url.pathToFileURL)(abs).toString());
    } catch (err) {
      return new Response(String(err), { status: 500 });
    }
  });
  createWindow();
});
import_electron.app.on("window-all-closed", () => {
  stopWatcher();
  import_electron.app.quit();
});
