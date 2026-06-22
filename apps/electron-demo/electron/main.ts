import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { readFile, writeFile, readdir, mkdir, rename, stat } from "node:fs/promises";
import { existsSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  LLMWikiCompileQueue,
  LLMWikiDocumentQueue,
  LLMWikiStateStore,
  getLLMWikiConfigStatus,
  normalizeProjectIssues,
  normalizeRawDocumentPath,
  parsePositiveInteger,
  resolveLLMWikiProjectRoot,
  runSidecarCommand,
  runSidecarCompile,
  runSidecarIngestFile,
  runSidecarQuery,
  saveLLMWikiSource,
  writeLLMWikiConfig,
  type LLMWikiAskResult,
  type LLMWikiConfigInput,
  type LLMWikiConfigStatus,
  type LLMWikiDocumentStatus,
  type LLMWikiSaveSourceInput,
  type LLMWikiSaveSourceResult,
  type LLMWikiStatus,
} from "./llm-wiki";

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

let activeVault: string | null = null;
let activeWatcher: FSWatcher | null = null;
let lastLLMWikiStatus: LLMWikiStatus | null = null;
const documentQueues = new Map<string, LLMWikiDocumentQueue>();

function resolveTrustedLLMWikiProjectRoot(): string {
  // Renderer projectPath is advisory/untrusted; main resolves from activeVault/default.
  return resolveLLMWikiProjectRoot(activeVault, app.getPath("documents"));
}

function llmWikiSidecarDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "llm-wiki");
  }
  return path.resolve(__dirname, "../llm-wiki");
}

function emitLLMWikiStatus(status: LLMWikiStatus): void {
  lastLLMWikiStatus = status;
  mainWindow?.webContents.send("llm-wiki:status", status);
}

function emitLLMWikiDocStatus(projectPath: string, rawPath: string, status: LLMWikiDocumentStatus): void {
  mainWindow?.webContents.send("llm-wiki:doc-status", { projectPath, rawPath, status });
}

const llmWikiQueue = new LLMWikiCompileQueue({
  debounceMs: parsePositiveInteger(process.env.LLM_WIKI_DEBOUNCE_MS, 800),
  async runner(projectPath) {
    const config = await getLLMWikiConfigStatus(llmWikiSidecarDir());
    return runSidecarCompile(llmWikiSidecarDir(), projectPath, {
      pythonCommand: process.env.LLM_WIKI_PYTHON ?? "python",
      provider: config.provider,
      timeoutMs: parsePositiveInteger(process.env.LLM_WIKI_TIMEOUT_MS, 120000),
      maxStdoutBytes: parsePositiveInteger(process.env.LLM_WIKI_MAX_STDOUT_BYTES, 1024 * 1024),
    });
  },
  emit: emitLLMWikiStatus,
});

function stateStoreFor(projectPath: string): LLMWikiStateStore {
  return new LLMWikiStateStore(projectPath);
}

function queueFor(projectPath: string): LLMWikiDocumentQueue {
  let queue = documentQueues.get(projectPath);
  if (queue) return queue;
  const store = stateStoreFor(projectPath);
  queue = new LLMWikiDocumentQueue({
    concurrency: 4,
    loadTask: async (rawPath) => {
      const state = await store.start(rawPath);
      emitLLMWikiDocStatus(projectPath, rawPath, state);
      return { rawPath, contentHash: state.contentHash };
    },
    runner: async (task) => {
      const config = await getLLMWikiConfigStatus(llmWikiSidecarDir());
      return runSidecarIngestFile(llmWikiSidecarDir(), projectPath, task.rawPath, {
        pythonCommand: process.env.LLM_WIKI_PYTHON ?? "python",
        timeoutMs: parsePositiveInteger(process.env.LLM_WIKI_TIMEOUT_MS, 120000),
        maxStdoutBytes: parsePositiveInteger(process.env.LLM_WIKI_MAX_STDOUT_BYTES, 1024 * 1024),
        provider: config.provider ?? "fixture",
      });
    },
    complete: async (rawPath, hash, result) => {
      const completed = await store.complete(rawPath, hash, result);
      await store.setProjectIssues(normalizeProjectIssues(result.issues));
      return completed;
    },
    fail: async (rawPath, hash, error) => {
      try {
        return await store.fail(rawPath, hash, error);
      } catch (err) {
        console.warn("[llm-wiki] failed to persist document failure status:", err);
        throw err;
      }
    },
    emit: (rawPath, status) => emitLLMWikiDocStatus(projectPath, rawPath, status),
  });
  documentQueues.set(projectPath, queue);
  return queue;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
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
      preload: path.join(__dirname, "preload.js"),
    },
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

async function activateVault(vaultPath: string): Promise<string> {
  const abs = path.resolve(vaultPath);
  const info = await stat(abs);
  if (!info.isDirectory()) throw new Error(`Not a directory: ${abs}`);

  activeVault = abs;
  startWatcher(abs);
  return abs;
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

ipcMain.handle("vault:list", async (_event, vaultPath: string) => {
  const abs = await activateVault(vaultPath);
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

ipcMain.handle("llm-wiki:get-status", async () => {
  return lastLLMWikiStatus;
});

ipcMain.handle("llm-wiki:get-config-status", async (): Promise<LLMWikiConfigStatus> => {
  return getLLMWikiConfigStatus(llmWikiSidecarDir());
});

ipcMain.handle(
  "llm-wiki:save-config",
  async (_event: Electron.IpcMainInvokeEvent, input: LLMWikiConfigInput): Promise<LLMWikiConfigStatus> => {
    return writeLLMWikiConfig(llmWikiSidecarDir(), input);
  }
);

ipcMain.handle(
  "llm-wiki:ask",
  async (
    _event: Electron.IpcMainInvokeEvent,
    input: { projectPath?: string | null; question: string }
  ): Promise<LLMWikiAskResult> => {
    const question = String(input.question ?? "").trim();
    if (!question) throw new Error("Question cannot be empty");
    const projectPath = resolveTrustedLLMWikiProjectRoot();
    const config = await getLLMWikiConfigStatus(llmWikiSidecarDir());
    if (config.provider !== "deepseek") {
      throw new Error("LLM Wiki Ask requires DeepSeek provider.");
    }
    await runSidecarCommand(llmWikiSidecarDir(), "ensure", projectPath, {
      pythonCommand: process.env.LLM_WIKI_PYTHON ?? "python",
      timeoutMs: parsePositiveInteger(process.env.LLM_WIKI_TIMEOUT_MS, 120000),
      maxStdoutBytes: parsePositiveInteger(process.env.LLM_WIKI_MAX_STDOUT_BYTES, 1024 * 1024),
    });
    return runSidecarQuery(llmWikiSidecarDir(), projectPath, question, {
      pythonCommand: process.env.LLM_WIKI_PYTHON ?? "python",
      timeoutMs: parsePositiveInteger(process.env.LLM_WIKI_TIMEOUT_MS, 120000),
      maxStdoutBytes: parsePositiveInteger(process.env.LLM_WIKI_MAX_STDOUT_BYTES, 1024 * 1024),
      provider: config.provider,
    });
  }
);

ipcMain.handle("llm-wiki:open-schema", async (_event, input?: { projectPath?: string | null }) => {
  void input;
  const projectPath = resolveTrustedLLMWikiProjectRoot();
  await runSidecarCommand(llmWikiSidecarDir(), "ensure", projectPath, {
    pythonCommand: process.env.LLM_WIKI_PYTHON ?? "python",
    timeoutMs: parsePositiveInteger(process.env.LLM_WIKI_TIMEOUT_MS, 120000),
    maxStdoutBytes: parsePositiveInteger(process.env.LLM_WIKI_MAX_STDOUT_BYTES, 1024 * 1024),
  });
  await activateVault(projectPath);
  const schemaPath = path.join(projectPath, ".nexus", "llm-wiki-schema.md");
  const content = await readFile(schemaPath, "utf-8");
  return { projectPath, schemaPath, content };
});

ipcMain.handle("llm-wiki:get-doc-statuses", async () => {
  const projectPath = resolveTrustedLLMWikiProjectRoot();
  const state = await stateStoreFor(projectPath).read();
  return { projectPath, state };
});

ipcMain.handle("llm-wiki:get-submit-mode", async () => {
  const projectPath = resolveTrustedLLMWikiProjectRoot();
  return { projectPath, mode: (await stateStoreFor(projectPath).read()).mode };
});

ipcMain.handle("llm-wiki:set-submit-mode", async (_event, mode: "manual" | "auto") => {
  const projectPath = resolveTrustedLLMWikiProjectRoot();
  const state = await stateStoreFor(projectPath).setMode(mode === "auto" ? "auto" : "manual");
  return { projectPath, mode: state.mode };
});

ipcMain.handle("llm-wiki:submit-doc", async (_event, input?: { rawPath: string }) => {
  const projectPath = resolveTrustedLLMWikiProjectRoot();
  const rawPath = normalizeRawDocumentPath(String(input?.rawPath ?? ""));
  const store = stateStoreFor(projectPath);
  const status = await store.enqueue(rawPath);
  emitLLMWikiDocStatus(projectPath, rawPath, status);
  queueFor(projectPath).enqueue(rawPath);
  return { projectPath, rawPath, status };
});

ipcMain.handle("llm-wiki:submit-all-dirty", async () => {
  const projectPath = resolveTrustedLLMWikiProjectRoot();
  const store = stateStoreFor(projectPath);
  const state = await store.read();
  const submitted: string[] = [];
  for (const [rawPath, status] of Object.entries(state.documents)) {
    if (status.status !== "dirty") continue;
    const next = await store.enqueue(rawPath);
    emitLLMWikiDocStatus(projectPath, rawPath, next);
    queueFor(projectPath).enqueue(rawPath);
    submitted.push(rawPath);
  }
  return { projectPath, submitted };
});

ipcMain.handle("llm-wiki:retry-failed", async () => {
  const projectPath = resolveTrustedLLMWikiProjectRoot();
  const store = stateStoreFor(projectPath);
  const state = await store.read();
  const submitted: string[] = [];
  for (const [rawPath, status] of Object.entries(state.documents)) {
    if (status.status !== "failed") continue;
    const next = await store.enqueue(rawPath);
    emitLLMWikiDocStatus(projectPath, rawPath, next);
    queueFor(projectPath).enqueue(rawPath);
    submitted.push(rawPath);
  }
  return { projectPath, submitted };
});

ipcMain.handle(
  "llm-wiki:save-source",
  async (
    _event: Electron.IpcMainInvokeEvent,
    input: LLMWikiSaveSourceInput
  ): Promise<LLMWikiSaveSourceResult> => {
    const projectPath = resolveTrustedLLMWikiProjectRoot();
    return saveLLMWikiSource(
      { projectPath, currentPath: input.currentPath, content: input.content ?? "" },
      {
        mkdir,
        activateVault,
        writeFile,
        pathExists: existsSync,
        enqueueCompile: (queuedProjectPath) => llmWikiQueue.enqueue(queuedProjectPath),
        markDirty: async (dirtyProjectPath, rawPath, content) => {
          const changed = await stateStoreFor(dirtyProjectPath).markDirty(rawPath, content);
          const state = await stateStoreFor(dirtyProjectPath).read();
          const status = state.documents[rawPath];
          if (status) emitLLMWikiDocStatus(dirtyProjectPath, rawPath, status);
          return changed;
        },
        shouldAutoSubmit: async (dirtyProjectPath) => (await stateStoreFor(dirtyProjectPath).read()).mode === "auto",
        enqueueDocument: (dirtyProjectPath, rawPath) => {
          void stateStoreFor(dirtyProjectPath)
            .enqueue(rawPath)
            .then((status) => {
              emitLLMWikiDocStatus(dirtyProjectPath, rawPath, status);
              queueFor(dirtyProjectPath).enqueue(rawPath);
            })
            .catch((err) => {
              console.warn("[llm-wiki] failed to enqueue saved document:", err);
            });
        },
      }
    );
  }
);

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
