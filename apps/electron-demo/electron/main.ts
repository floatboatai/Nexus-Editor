import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { readFile, writeFile, readdir, mkdir, rename, stat, copyFile } from "node:fs/promises";
import { existsSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Must be called before app ready — declares our custom scheme as privileged
// so images served via nexus-vault:// pass fetch/<img> with credentials / CORS.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "nexus-vault",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
]);

let mainWindow: BrowserWindow | null = null;

export interface VaultNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: VaultNode[];
}

interface VaultState {
  lastVault: string | null;
  recents: string[];
}

const SUPPORTED_EXT = new Set([".md", ".markdown", ".txt"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".svn", ".hg", ".DS_Store"]);
const isMac = process.platform === "darwin";

let activeVault: string | null = null;
let activeWatcher: FSWatcher | null = null;

function windowFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function createWindow(): void {
  // Custom chrome: macOS keeps native traffic lights via hiddenInset;
  // Windows/Linux use a fully frameless window with renderer-drawn controls.
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: "#f5f5f5",
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 14 },
          // Allow the custom header to own the full width; traffic lights float
          // over the drag region with padding applied in the renderer.
        }
      : {
          frame: false,
        }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  const emitMaximized = () => {
    mainWindow?.webContents.send("window:maximized-changed", mainWindow.isMaximized());
  };
  mainWindow.on("maximize", emitMaximized);
  mainWindow.on("unmaximize", emitMaximized);
  // Windows restores via snap/unmaximize; also cover enter/leave full screen.
  mainWindow.on("enter-full-screen", () => {
    mainWindow?.webContents.send("window:fullscreen-changed", true);
  });
  mainWindow.on("leave-full-screen", () => {
    mainWindow?.webContents.send("window:fullscreen-changed", false);
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Allow opening DevTools in packaged builds via Cmd/Ctrl+Shift+I or F12 —
  // needed for reading [perf] logs in production and diagnosing prod-only
  // slowdowns. Harmless in dev (DevTools is already attachable there).
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    const meta = input.meta || input.control;
    if (input.type === "keyDown") {
      if ((meta && input.shift && (input.key === "I" || input.key === "i")) || input.key === "F12") {
        mainWindow?.webContents.toggleDevTools();
      }
    }
  });
}

// -- window chrome (frameless / custom titlebar) ------------------------------

ipcMain.handle("window:platform", () => process.platform);

ipcMain.handle("window:minimize", (event) => {
  windowFromEvent(event)?.minimize();
});

ipcMain.handle("window:toggle-maximize", (event) => {
  const win = windowFromEvent(event);
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});

ipcMain.handle("window:close", (event) => {
  windowFromEvent(event)?.close();
});

ipcMain.handle("window:is-maximized", (event) => {
  return windowFromEvent(event)?.isMaximized() ?? false;
});

// -- single-file legacy handlers (kept for back-compat) -----------------------

ipcMain.handle("demo:open-file", async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "txt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const content = await readFile(filePath, "utf-8");
  return { path: filePath, content };
});

ipcMain.handle(
  "demo:save-file",
  async (_event: Electron.IpcMainInvokeEvent, filePath: string, content: string) => {
    await writeFile(filePath, content, "utf-8");
    return { path: filePath };
  }
);

ipcMain.handle(
  "demo:save-file-as",
  async (_event: Electron.IpcMainInvokeEvent, content: string) => {
    if (!mainWindow) return null;

    const result = await dialog.showSaveDialog(mainWindow, {
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (result.canceled || !result.filePath) return null;

    await writeFile(result.filePath, content, "utf-8");
    return { path: result.filePath };
  }
);

// -- vault helpers ------------------------------------------------------------

function assertInsideVault(target: string): string {
  if (!activeVault) {
    throw new Error("No active vault");
  }
  const resolved = path.resolve(target);
  const rel = path.relative(activeVault, resolved);
  if (rel === "" || rel === "." ) return resolved;
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes vault: ${target}`);
  }
  return resolved;
}

async function scanDirectory(dir: string): Promise<VaultNode[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nodes: VaultNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue; // skip all dotfiles/dotdirs

    const childPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const children = await scanDirectory(childPath);
      if (children.length > 0) {
        nodes.push({
          name: entry.name,
          path: childPath,
          kind: "directory",
          children,
        });
      }
      continue;
    }

    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
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

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: NodeJS.Timeout | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

function stopWatcher(): void {
  if (activeWatcher) {
    try {
      activeWatcher.close();
    } catch {
      /* noop */
    }
    activeWatcher = null;
  }
}

function startWatcher(vaultPath: string): void {
  stopWatcher();

  const notify = debounce(() => {
    mainWindow?.webContents.send("vault:changed", { vault: vaultPath });
  }, 150);

  try {
    activeWatcher = watch(vaultPath, { recursive: true }, () => notify());
  } catch (err) {
    // Linux without recursive support — fall back to non-recursive on the root.
    try {
      activeWatcher = watch(vaultPath, () => notify());
    } catch (innerErr) {
      console.warn("[vault] watcher init failed:", innerErr);
      activeWatcher = null;
    }
  }
}

function vaultStatePath(): string {
  return path.join(app.getPath("userData"), "vault.json");
}

async function readVaultState(): Promise<VaultState> {
  const file = vaultStatePath();
  if (!existsSync(file)) return { lastVault: null, recents: [] };
  try {
    const raw = await readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<VaultState>;
    return {
      lastVault: typeof parsed.lastVault === "string" ? parsed.lastVault : null,
      recents: Array.isArray(parsed.recents) ? parsed.recents.filter((r) => typeof r === "string") : [],
    };
  } catch {
    return { lastVault: null, recents: [] };
  }
}

async function writeVaultState(state: VaultState): Promise<void> {
  await writeFile(vaultStatePath(), JSON.stringify(state, null, 2), "utf-8");
}

// -- vault IPC handlers -------------------------------------------------------

ipcMain.handle("vault:pick", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return { path: result.filePaths[0] };
});

/**
 * Write a pasted / dropped binary image into the vault under `img/`.
 * `bytes` is a Uint8Array (structured-clone over IPC).
 */
ipcMain.handle(
  "vault:write-image",
  async (
    _event,
    payload: { name?: string; mime?: string; bytes: Uint8Array | number[] }
  ) => {
    const raw = payload?.bytes;
    if (!raw) throw new Error("No image data");
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);

    const mime = payload.mime || "image/png";
    const extFromMime: Record<string, string> = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/svg+xml": ".svg",
      "image/bmp": ".bmp",
    };
    let ext = extFromMime[mime] || path.extname(payload.name || "") || ".png";
    if (!ext.startsWith(".")) ext = `.${ext}`;

    const baseName = (payload.name || `paste-${Date.now()}${ext}`).replace(
      /[^\w.\-()+@ ]+/g,
      "_"
    );
    const safeName = baseName.includes(".") ? baseName : `${baseName}${ext}`;

    if (!activeVault) {
      // No vault — return a data URL so the image still previews in-editor.
      const b64 = Buffer.from(bytes).toString("base64");
      return {
        markdownPath: `data:${mime};base64,${b64}`,
        absolutePath: null,
        relative: false,
      };
    }

    const imgDir = path.join(activeVault, "img");
    await mkdir(imgDir, { recursive: true });
    let dest = path.join(imgDir, safeName);
    if (existsSync(dest)) {
      const stem = path.basename(safeName, path.extname(safeName));
      dest = path.join(imgDir, `${stem}-${Date.now()}${path.extname(safeName)}`);
    }
    await writeFile(dest, Buffer.from(bytes));
    const rel = path.relative(activeVault, dest).split(path.sep).join("/");
    return {
      markdownPath: rel,
      absolutePath: dest,
      relative: true,
    };
  }
);

/**
 * Pick an image from disk and copy it into the active vault (under `img/`).
 * Returns a vault-relative markdown path suitable for `![](path)`.
 * Without an open vault, returns a `file://` URL for the selected path.
 */
ipcMain.handle("vault:import-image", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const src = result.filePaths[0];
  if (!activeVault) {
    return {
      markdownPath: pathToFileURL(src).href,
      absolutePath: src,
      relative: false,
    };
  }

  const imgDir = path.join(activeVault, "img");
  await mkdir(imgDir, { recursive: true });
  const base = path.basename(src);
  let dest = path.join(imgDir, base);
  if (existsSync(dest)) {
    const ext = path.extname(base);
    const stem = path.basename(base, ext);
    dest = path.join(imgDir, `${stem}-${Date.now()}${ext}`);
  }
  await copyFile(src, dest);
  const rel = path.relative(activeVault, dest).split(path.sep).join("/");
  return {
    markdownPath: rel,
    absolutePath: dest,
    relative: true,
  };
});

ipcMain.handle("vault:list", async (_event, vaultPath: string) => {
  const abs = path.resolve(vaultPath);
  const info = await stat(abs);
  if (!info.isDirectory()) throw new Error(`Not a directory: ${abs}`);

  activeVault = abs;
  startWatcher(abs);

  return scanDirectory(abs);
});

ipcMain.handle("vault:read", async (_event, filePath: string) => {
  const abs = assertInsideVault(filePath);
  const content = await readFile(abs, "utf-8");
  return { path: abs, content };
});

// Bulk read every markdown file in the active vault — used to seed the
// wiki-link index without N individual round-trips.
async function collectFiles(dir: string, acc: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const childPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(childPath, acc);
      continue;
    }
    if (entry.isFile() && SUPPORTED_EXT.has(path.extname(entry.name).toLowerCase())) {
      acc.push(childPath);
    }
  }
}

ipcMain.handle("vault:read-all", async () => {
  if (!activeVault) return [];
  const paths: string[] = [];
  await collectFiles(activeVault, paths);
  // Bounded-concurrency parallel read — ~5-10x faster than serial on large
  // vaults, without risking EMFILE.
  const CONCURRENCY = 32;
  const out: { path: string; content: string }[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < paths.length) {
      const i = cursor++;
      const p = paths[i];
      try {
        const abs = assertInsideVault(p);
        const content = await readFile(abs, "utf-8");
        out.push({ path: abs, content });
      } catch {
        // Skip unreadable files rather than failing the whole batch.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker));
  return out;
});

ipcMain.handle("vault:write", async (_event, filePath: string, content: string) => {
  const abs = assertInsideVault(filePath);
  await writeFile(abs, content, "utf-8");
  return { path: abs };
});

ipcMain.handle(
  "vault:create-file",
  async (_event, parentDir: string, name: string) => {
    const safeInput = name.trim() || "untitled";
    // Allow the caller to pass a subpath like `Folder/NewNote` — we split it
    // into an extra parent path relative to `parentDir` and create any
    // intermediate folders as needed. This is what the wiki-link
    // create-on-click flow needs when the user types `[[Projects/X]]`.
    const normInput = safeInput.replace(/\\/g, "/");
    const segments = normInput.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) throw new Error("Invalid file name");
    const baseNameRaw = segments.pop()!;
    const subDirs = segments.join("/");

    const parent = assertInsideVault(
      subDirs ? path.join(parentDir, subDirs) : parentDir
    );
    if (subDirs) {
      await mkdir(parent, { recursive: true });
    }

    const hasExt = SUPPORTED_EXT.has(path.extname(baseNameRaw).toLowerCase());
    const baseName = hasExt ? baseNameRaw : `${baseNameRaw}.md`;
    const ext = path.extname(baseName);
    const stem = baseName.slice(0, baseName.length - ext.length);

    let candidate = path.join(parent, baseName);
    let suffix = 1;
    while (existsSync(candidate)) {
      candidate = path.join(parent, `${stem}-${suffix}${ext}`);
      suffix += 1;
    }

    const finalPath = assertInsideVault(candidate);
    await writeFile(finalPath, "", "utf-8");
    return { path: finalPath };
  }
);

ipcMain.handle(
  "vault:create-folder",
  async (_event, parentDir: string, name: string) => {
    const parent = assertInsideVault(parentDir);
    const safeName = name.trim() || "new-folder";
    const target = assertInsideVault(path.join(parent, safeName));
    if (existsSync(target)) {
      throw new Error(`Folder already exists: ${safeName}`);
    }
    await mkdir(target, { recursive: false });
    return { path: target };
  }
);

ipcMain.handle(
  "vault:rename",
  async (_event, oldPath: string, newName: string) => {
    const src = assertInsideVault(oldPath);
    const parent = path.dirname(src);
    const trimmed = newName.trim();
    if (!trimmed) throw new Error("New name cannot be empty");
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      throw new Error("New name cannot contain path separators");
    }
    const target = assertInsideVault(path.join(parent, trimmed));
    if (existsSync(target) && target !== src) {
      throw new Error(`Target already exists: ${trimmed}`);
    }
    await rename(src, target);
    return { path: target };
  }
);

ipcMain.handle("vault:delete", async (_event, targetPath: string) => {
  const abs = assertInsideVault(targetPath);
  await shell.trashItem(abs);
  return { ok: true };
});

ipcMain.handle("vault:get-last", async () => {
  const state = await readVaultState();
  if (state.lastVault && !existsSync(state.lastVault)) {
    const cleaned: VaultState = {
      lastVault: null,
      recents: state.recents.filter((r) => existsSync(r)),
    };
    await writeVaultState(cleaned);
    return cleaned;
  }
  return state;
});

ipcMain.handle("vault:set-last", async (_event, vaultPath: string) => {
  const current = await readVaultState();
  const recents = [vaultPath, ...current.recents.filter((r) => r !== vaultPath)].slice(0, 10);
  await writeVaultState({ lastVault: vaultPath, recents });
  return { ok: true };
});

/**
 * List recent vaults for the project switcher WITHOUT pruning. Unlike
 * `vault:get-last` (which silently drops dead paths on the auto-restore path),
 * this keeps missing entries and flags them `exists: false` so the UI can show
 * a friendly "moved or deleted" hint and let the user remove them explicitly.
 */
ipcMain.handle("vault:list-recents", async () => {
  const state = await readVaultState();
  return {
    recents: state.recents.map((p) => ({
      path: p,
      name: path.basename(p) || p,
      exists: existsSync(p),
    })),
    activeVault,
  };
});

/** Remove a single path from the recents list (e.g. a dead project the user
 *  dismissed). Never touches `lastVault` beyond clearing it if it matched. */
ipcMain.handle("vault:remove-recent", async (_event, vaultPath: string) => {
  const current = await readVaultState();
  const recents = current.recents.filter((r) => r !== vaultPath);
  const lastVault = current.lastVault === vaultPath ? null : current.lastVault;
  await writeVaultState({ lastVault, recents });
  return { ok: true };
});

app.whenReady().then(() => {
  // nexus-vault://vault/<rel> → read from activeVault/<rel>. Path is validated
  // so requests cannot escape the vault (same rule as the IPC handlers).
  protocol.handle("nexus-vault", async (request) => {
    try {
      if (!activeVault) return new Response("No active vault", { status: 404 });
      const url = new URL(request.url);
      const relPath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      if (!relPath) return new Response("Empty path", { status: 400 });
      const abs = path.resolve(activeVault, relPath);
      const rel = path.relative(activeVault, abs);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return new Response("Path escapes vault", { status: 403 });
      }
      if (!existsSync(abs)) return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(abs).toString());
    } catch (err) {
      return new Response(String(err), { status: 500 });
    }
  });
  createWindow();
});

app.on("window-all-closed", () => {
  stopWatcher();
  app.quit();
});
