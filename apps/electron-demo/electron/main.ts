import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from "electron";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, readdir, mkdir, rename, stat } from "node:fs/promises";
import { existsSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  parsePluginIpcRequest,
  parsePluginIpcResponse,
  type PluginIpcChannel,
  type PluginIpcRequest,
  type PluginIpcResponse,
  type PluginHostPermissionId,
} from "../src/shared/plugin-ipc";
import {
  hostModeArgument,
  resolveMainHostMode,
  type NexusHostMode,
} from "../src/shared/host-mode";
import {
  ElectronExternalNavigationBroker,
  ElectronPluginStorageBroker,
  ElectronVaultBroker,
  PluginHostBrokerError,
  type SenderIdentity,
} from "./plugin-host-broker";
import { SenderWindowRegistry } from "./window-registry";
import { perfLog, perfMark } from "./perf";

// Must be called before app ready — declares our custom scheme as privileged
// so images served via nexus-vault:// pass fetch/<img> with credentials / CORS.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "nexus-vault",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
]);

let externalNavigationBroker: ElectronExternalNavigationBroker | null = null;
let pluginVaultBroker: ElectronVaultBroker | null = null;
let pluginStorageBroker: ElectronPluginStorageBroker | null = null;
let appIsQuitting = false;
let forceQuit = false;
let quitFallbackTimer: NodeJS.Timeout | null = null;
let quitDrainPromise: Promise<void> | null = null;

interface WindowRuntimeState {
  readonly windowSession: Electron.Session;
  readonly hostMode: NexusHostMode;
  activeVault: string | null;
  activeWatcher: FSWatcher | null;
  watchNotifyTimer: NodeJS.Timeout | null;
  shutdownTimer: NodeJS.Timeout | null;
  shutdownInProgress: boolean;
  finalizePromise: Promise<void> | null;
}

const windowRegistry = new SenderWindowRegistry<BrowserWindow, WindowRuntimeState>();

interface MainOwnedPluginPermissionPolicy {
  readonly declaredPermissions: readonly PluginHostPermissionId[];
  readonly grantedPermissions: readonly PluginHostPermissionId[];
}

// Bundled manifests and host decisions are duplicated into the privileged
// process deliberately: renderer code cannot extend this registry or approve
// itself. Add an entry here only after the packaged manifest is reviewed.
const MAIN_PLUGIN_PERMISSION_POLICIES = new Map<string, MainOwnedPluginPermissionPolicy>([
  ["wordcount", { declaredPermissions: [], grantedPermissions: [] }],
  ["toolbar", { declaredPermissions: [], grantedPermissions: [] }],
  ["slash-menu", { declaredPermissions: [], grantedPermissions: [] }],
  ["obsidian-sample-port", { declaredPermissions: [], grantedPermissions: [] }],
]);

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

export interface CreateWindowOptions {
  readonly hostMode?: NexusHostMode;
  readonly windowId?: string;
}

export function createWindow(options: CreateWindowOptions = {}): BrowserWindow {
  const hostMode = options.hostMode ?? resolveMainHostMode(process.env);
  const windowId = options.windowId ??
    (windowRegistry.liveRegistrations.length === 0 ? "main" : randomUUID());
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(windowId)) {
    throw new RangeError("Electron window ID must contain only letters, numbers, and hyphens");
  }
  const windowSession = session.fromPartition(`persist:nexus-window-${windowId}`, { cache: false });
  const window = new BrowserWindow({
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
      session: windowSession,
      additionalArguments: [hostModeArgument(hostMode)],
    },
  });

  const state: WindowRuntimeState = {
    windowSession,
    hostMode,
    activeVault: null,
    activeWatcher: null,
    watchNotifyTimer: null,
    shutdownTimer: null,
    shutdownInProgress: false,
    finalizePromise: null,
  };
  const { senderId } = windowRegistry.register(window, state);
  registerVaultProtocol(windowSession.protocol, senderId);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedRendererLocation(targetUrl)) event.preventDefault();
  });
  window.webContents.once("destroyed", () => {
    releaseWindowResources(senderId);
    finishAppQuitIfReady();
  });

  window.once("ready-to-show", () => {
    perfLog(perfMark("window-ready-to-show"), "window-ready-to-show");
    if (!window.isDestroyed()) window.show();
  });
  window.webContents.once("did-finish-load", () => {
    perfLog(perfMark("did-finish-load"), "did-finish-load");
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Allow opening DevTools in packaged builds via Cmd/Ctrl+Shift+I or F12 —
  // needed for reading [perf] logs in production and diagnosing prod-only
  // slowdowns. Harmless in dev (DevTools is already attachable there).
  window.webContents.on("before-input-event", (_event, input) => {
    const meta = input.meta || input.control;
    if (input.type === "keyDown") {
      if ((meta && input.shift && (input.key === "I" || input.key === "i")) || input.key === "F12") {
        window.webContents.toggleDevTools();
      }
    }
  });

  window.on("close", (event) => {
    const registration = windowRegistry.registrationForSenderId(senderId);
    if (!registration) return;
    event.preventDefault();
    if (registration.state.shutdownInProgress) return;
    registration.state.shutdownInProgress = true;
    window.webContents.send("nexus:host:shutdown", {
      reason: appIsQuitting ? "app-quit" : "window-close",
    });
    registration.state.shutdownTimer = setTimeout(() => {
      void finalizeWindowShutdown(senderId);
    }, 2_000);
  });

  return window;
}

function registerVaultProtocol(windowProtocol: Electron.Protocol, senderId: number): void {
  // Electron protocol.handle receives a standard Request without a trusted
  // webContentsId. A per-window Session lets the handler bind identity in this
  // closure instead of treating referrer or renderer-controlled headers as authorization.
  windowProtocol.handle("nexus-vault", async (request) => {
    try {
      const url = new URL(request.url);
      if (request.method !== "GET" || url.hostname !== "resource") {
        return new Response("Not found", { status: 404 });
      }
      const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (segments.length !== 2) return new Response("Not found", { status: 404 });
      const [sessionCapability, token] = segments;
      const resource = await pluginVaultBroker?.readResource(senderId, sessionCapability, token);
      if (!resource) return new Response("Not found", { status: 404 });
      return new Response(Uint8Array.from(resource.content).buffer, {
        headers: { "content-type": contentTypeForPath(resource.path) },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function senderIdentity(event: Electron.IpcMainInvokeEvent): SenderIdentity {
  return Object.freeze({
    id: event.sender.id,
    url: event.senderFrame?.url ?? event.sender.getURL(),
  });
}

export function windowForSenderId(senderId: number): BrowserWindow | null {
  return windowRegistry.windowForSenderId(senderId);
}

function contentTypeForPath(resourcePath: string): string {
  switch (path.extname(resourcePath).toLowerCase()) {
    case ".avif": return "image/avif";
    case ".gif": return "image/gif";
    case ".jpeg":
    case ".jpg": return "image/jpeg";
    case ".png": return "image/png";
    case ".svg": return "image/svg+xml";
    case ".webp": return "image/webp";
    case ".md":
    case ".markdown":
    case ".txt": return "text/plain; charset=utf-8";
    default: return "application/octet-stream";
  }
}

function isTrustedRendererLocation(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) return url.origin === new URL(devUrl).origin;
    const expected = pathToFileURL(path.join(__dirname, "../dist/index.html"));
    return url.protocol === expected.protocol && url.pathname === expected.pathname;
  } catch {
    return false;
  }
}

function isAuthorizedPluginSender(sender: SenderIdentity): boolean {
  const registration = windowRegistry.registrationForSenderId(sender.id);
  return Boolean(
    registration &&
    registration.state.hostMode === "runtime" &&
    isTrustedRendererLocation(sender.url),
  );
}

function assertAuthorizedHostSender(sender: SenderIdentity) {
  const registration = windowRegistry.registrationForSenderId(sender.id);
  if (!registration || !isTrustedRendererLocation(sender.url)) {
    throw new PluginHostBrokerError(
      "sender-not-authorized",
      "IPC sender is not an authorized application window.",
    );
  }
  return registration;
}

type PluginIpcHandler<C extends PluginIpcChannel> = (
  sender: SenderIdentity,
  request: PluginIpcRequest<C>,
) => PluginIpcResponse<C> | Promise<PluginIpcResponse<C>>;

function registerPluginIpcHandler<C extends PluginIpcChannel>(
  channel: C,
  handler: PluginIpcHandler<C>,
): void {
  ipcMain.handle(channel, async (event, payload: unknown) => {
    const request = parsePluginIpcRequest(channel, payload);
    const response = await handler(senderIdentity(event), request);
    return parsePluginIpcResponse(channel, response);
  });
}

function requirePluginVaultBroker(): ElectronVaultBroker {
  if (!pluginVaultBroker) throw new Error("Plugin Vault broker is not ready.");
  return pluginVaultBroker;
}

function requireExternalNavigationBroker(): ElectronExternalNavigationBroker {
  if (!externalNavigationBroker) throw new Error("External navigation broker is not ready.");
  return externalNavigationBroker;
}

function requirePluginStorageBroker(): ElectronPluginStorageBroker {
  if (!pluginStorageBroker) throw new Error("Plugin storage broker is not ready.");
  return pluginStorageBroker;
}

function assertAuthorizedSender(sender: SenderIdentity): void {
  if (!isAuthorizedPluginSender(sender)) {
    throw new PluginHostBrokerError(
      "sender-not-authorized",
      "IPC sender is not an authorized application window.",
    );
  }
}

export function registerPluginHostIpc(): void {
  externalNavigationBroker = new ElectronExternalNavigationBroker({
    isSenderAuthorized: isAuthorizedPluginSender,
    openExternal: (url) => shell.openExternal(url),
    resolvePluginPolicy: (pluginId) => MAIN_PLUGIN_PERMISSION_POLICIES.get(pluginId) ?? null,
  });
  pluginVaultBroker = new ElectronVaultBroker({
    isSenderAuthorized: isAuthorizedPluginSender,
    trashItem: (absolutePath) => shell.trashItem(absolutePath),
    onChange: (senderId, event) => {
      windowForSenderId(senderId)?.webContents.send("nexus:vault:changed", event);
    },
  });
  pluginStorageBroker = new ElectronPluginStorageBroker(
    path.join(app.getPath("userData"), "plugin-data"),
  );

  registerPluginIpcHandler("nexus:vault:pick", async (sender) => {
    assertAuthorizedSender(sender);
    const window = windowForSenderId(sender.id);
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const root = result.filePaths[0];
    return requirePluginVaultBroker().openSession(sender, root);
  });
  registerPluginIpcHandler("nexus:vault:restore", async (sender) => {
    assertAuthorizedSender(sender);
    const state = await readVaultState();
    if (!state.lastVault || !existsSync(state.lastVault)) return null;
    return requirePluginVaultBroker().openSession(sender, state.lastVault);
  });
  registerPluginIpcHandler("nexus:vault:close", (sender, request) => {
    requirePluginVaultBroker().closeSession(sender, request.sessionId);
    return { ok: true };
  });
  registerPluginIpcHandler("nexus:vault:commit", async (sender, request) => {
    const { root } = requirePluginVaultBroker().commitSession(sender, request.sessionId);
    const current = await readVaultState();
    const recents = [root, ...current.recents.filter((entry) => entry !== root)].slice(0, 10);
    await writeVaultState({ lastVault: root, recents });
    return { ok: true };
  });
  registerPluginIpcHandler("nexus:vault:list", (sender, request) =>
    requirePluginVaultBroker().list(sender, request.sessionId));
  registerPluginIpcHandler("nexus:vault:read", (sender, request) =>
    requirePluginVaultBroker().read(sender, request.sessionId, request.path));
  registerPluginIpcHandler("nexus:vault:read-binary", (sender, request) =>
    requirePluginVaultBroker().readBinary(sender, request.sessionId, request.path));
  registerPluginIpcHandler("nexus:vault:read-all", (sender, request) =>
    requirePluginVaultBroker().readAll(sender, request.sessionId));
  registerPluginIpcHandler("nexus:vault:write", (sender, request) =>
    requirePluginVaultBroker().write(sender, request.sessionId, request.path, request.content, {
      ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }),
      ...(request.operationId === undefined ? {} : { operationId: request.operationId }),
    }));
  registerPluginIpcHandler("nexus:vault:write-binary", (sender, request) =>
    requirePluginVaultBroker().write(sender, request.sessionId, request.path, request.content, {
      ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }),
      ...(request.operationId === undefined ? {} : { operationId: request.operationId }),
    }));
  registerPluginIpcHandler("nexus:vault:create-folder", (sender, request) =>
    requirePluginVaultBroker().createFolder(
      sender,
      request.sessionId,
      request.path,
      request.operationId,
    ));
  registerPluginIpcHandler("nexus:vault:rename", (sender, request) =>
    requirePluginVaultBroker().rename(
      sender,
      request.sessionId,
      request.path,
      request.destination,
      request.operationId,
    ));
  registerPluginIpcHandler("nexus:vault:trash", (sender, request) =>
    requirePluginVaultBroker().trash(
      sender,
      request.sessionId,
      request.path,
      request.operationId,
    ));
  registerPluginIpcHandler("nexus:vault:resource-url", (sender, request) =>
    requirePluginVaultBroker().createResourceUrl(sender, request.sessionId, request.path));
  registerPluginIpcHandler("nexus:vault:revoke-resource-url", (sender, request) => {
    requirePluginVaultBroker().revokeResourceUrl(
      sender,
      request.sessionId,
      request.registrationId,
    );
    return { ok: true };
  });
  registerPluginIpcHandler("nexus:storage:load", (sender, request) => {
    assertAuthorizedSender(sender);
    return requirePluginStorageBroker().load(request.pluginId);
  });
  registerPluginIpcHandler("nexus:storage:save", (sender, request) => {
    assertAuthorizedSender(sender);
    return requirePluginStorageBroker().save(
      request.pluginId,
      request.expectedRevision,
      request.data,
    );
  });
  registerPluginIpcHandler("nexus:secrets:status", (sender) => {
    assertAuthorizedSender(sender);
    return {
      status: "unsupported",
      reason: "This host has no configured operating-system secret backend.",
    };
  });
  registerPluginIpcHandler("nexus:host:activate-plugin", (sender, request) => {
    const instanceCapability = requireExternalNavigationBroker().activatePlugin(sender, request.pluginId);
    return { instanceCapability };
  });
  registerPluginIpcHandler("nexus:host:revoke-plugin", (sender, request) => {
    requireExternalNavigationBroker().revokePlugin(sender, request.instanceCapability);
    return { ok: true };
  });
  registerPluginIpcHandler("nexus:host:open-external", async (sender, request) => {
    await requireExternalNavigationBroker().open(sender, request.instanceCapability, request.url);
    return { ok: true };
  });
  registerPluginIpcHandler("nexus:host:shutdown-complete", async (sender) => {
    const registration = assertAuthorizedHostSender(sender);
    if (!registration.state.shutdownInProgress) {
      throw new PluginHostBrokerError(
        "sender-not-authorized",
        "Shutdown completion was not requested for this window.",
      );
    }
    await finalizeWindowShutdown(sender.id);
    return { ok: true };
  });
}

function releaseWindowResources(senderId: number): void {
  const registration = windowRegistry.unregister(senderId);
  if (!registration) return;

  const { state } = registration;
  if (state.shutdownTimer) clearTimeout(state.shutdownTimer);
  state.shutdownTimer = null;
  stopWatcher(state);
  externalNavigationBroker?.closeSender(senderId);
  pluginVaultBroker?.closeSender(senderId);
  try {
    state.windowSession.protocol.unhandle("nexus-vault");
  } catch {
    // The Session may already have been disposed with its webContents.
  }
}

async function finalizeWindowShutdown(senderId: number): Promise<void> {
  const registration = windowRegistry.registrationForSenderId(senderId);
  if (!registration) return;
  if (registration.state.finalizePromise) return registration.state.finalizePromise;

  registration.state.finalizePromise = (async () => {
    releaseWindowResources(senderId);
    if (!registration.window.isDestroyed()) registration.window.destroy();
    finishAppQuitIfReady();
  })();
  return registration.state.finalizePromise;
}

function finishAppQuitIfReady(): void {
  if (!appIsQuitting || windowRegistry.liveRegistrations.length > 0 || forceQuit) return;
  pluginVaultBroker?.closeAll();
  if (quitDrainPromise) return;
  quitDrainPromise = pluginStorageBroker?.drain() ?? Promise.resolve();
  void quitDrainPromise.finally(() => {
    if (forceQuit || windowRegistry.liveRegistrations.length > 0) return;
    forceQuit = true;
    if (quitFallbackTimer) clearTimeout(quitFallbackTimer);
    quitFallbackTimer = null;
    app.quit();
  });
}

function forceFinishAppQuit(): void {
  if (forceQuit) return;
  forceQuit = true;
  if (quitFallbackTimer) clearTimeout(quitFallbackTimer);
  quitFallbackTimer = null;
  for (const { senderId, window } of [...windowRegistry.liveRegistrations]) {
    releaseWindowResources(senderId);
    if (!window.isDestroyed()) window.destroy();
  }
  pluginVaultBroker?.closeAll();
  app.quit();
}

// -- single-file legacy handlers (kept for back-compat) -----------------------

function registrationForEvent(event: Electron.IpcMainInvokeEvent) {
  const sender = senderIdentity(event);
  const registration = assertAuthorizedHostSender(sender);
  if (registration.state.hostMode !== "legacy") {
    throw new PluginHostBrokerError(
      "sender-not-authorized",
      "Legacy filesystem IPC is not available to runtime windows.",
    );
  }
  return registration;
}

ipcMain.handle("demo:open-file", async (event) => {
  const { window } = registrationForEvent(event);

  const result = await dialog.showOpenDialog(window, {
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
  async (event: Electron.IpcMainInvokeEvent, filePath: string, content: string) => {
    registrationForEvent(event);
    await writeFile(filePath, content, "utf-8");
    return { path: filePath };
  }
);

ipcMain.handle(
  "demo:save-file-as",
  async (event: Electron.IpcMainInvokeEvent, content: string) => {
    const { window } = registrationForEvent(event);

    const result = await dialog.showSaveDialog(window, {
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

function assertInsideVault(state: WindowRuntimeState, target: string): string {
  if (!state.activeVault) {
    throw new Error("No active vault");
  }
  const resolved = path.resolve(target);
  const rel = path.relative(state.activeVault, resolved);
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

function stopWatcher(state: WindowRuntimeState): void {
  if (state.watchNotifyTimer) clearTimeout(state.watchNotifyTimer);
  state.watchNotifyTimer = null;
  if (state.activeWatcher) {
    try {
      state.activeWatcher.close();
    } catch {
      /* noop */
    }
    state.activeWatcher = null;
  }
}

function startWatcher(senderId: number, state: WindowRuntimeState, vaultPath: string): void {
  stopWatcher(state);

  const notify = () => {
    if (state.watchNotifyTimer) clearTimeout(state.watchNotifyTimer);
    state.watchNotifyTimer = setTimeout(() => {
      state.watchNotifyTimer = null;
      windowForSenderId(senderId)?.webContents.send("vault:changed", { vault: vaultPath });
    }, 150);
  };

  try {
    state.activeWatcher = watch(vaultPath, { recursive: true }, notify);
  } catch (err) {
    // Linux without recursive support — fall back to non-recursive on the root.
    try {
      state.activeWatcher = watch(vaultPath, notify);
    } catch (innerErr) {
      console.warn("[vault] watcher init failed:", innerErr);
      state.activeWatcher = null;
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

ipcMain.handle("vault:pick", async (event) => {
  const { window } = registrationForEvent(event);
  const result = await dialog.showOpenDialog(window, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return { path: result.filePaths[0] };
});

ipcMain.handle("vault:list", async (event, vaultPath: string) => {
  const { senderId, state } = registrationForEvent(event);
  const abs = path.resolve(vaultPath);
  const info = await stat(abs);
  if (!info.isDirectory()) throw new Error(`Not a directory: ${abs}`);

  state.activeVault = abs;
  startWatcher(senderId, state, abs);

  return scanDirectory(abs);
});

ipcMain.handle("vault:read", async (event, filePath: string) => {
  const { state } = registrationForEvent(event);
  const abs = assertInsideVault(state, filePath);
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

ipcMain.handle("vault:read-all", async (event) => {
  const { state } = registrationForEvent(event);
  const activeVault = state.activeVault;
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
        const abs = assertInsideVault(state, p);
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

ipcMain.handle("vault:write", async (event, filePath: string, content: string) => {
  const { state } = registrationForEvent(event);
  const abs = assertInsideVault(state, filePath);
  await writeFile(abs, content, "utf-8");
  return { path: abs };
});

ipcMain.handle(
  "vault:create-file",
  async (event, parentDir: string, name: string) => {
    const { state } = registrationForEvent(event);
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
      state,
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

    const finalPath = assertInsideVault(state, candidate);
    await writeFile(finalPath, "", "utf-8");
    return { path: finalPath };
  }
);

ipcMain.handle(
  "vault:create-folder",
  async (event, parentDir: string, name: string) => {
    const { state } = registrationForEvent(event);
    const parent = assertInsideVault(state, parentDir);
    const safeName = name.trim() || "new-folder";
    const target = assertInsideVault(state, path.join(parent, safeName));
    if (existsSync(target)) {
      throw new Error(`Folder already exists: ${safeName}`);
    }
    await mkdir(target, { recursive: false });
    return { path: target };
  }
);

ipcMain.handle(
  "vault:rename",
  async (event, oldPath: string, newName: string) => {
    const { state } = registrationForEvent(event);
    const src = assertInsideVault(state, oldPath);
    const parent = path.dirname(src);
    const trimmed = newName.trim();
    if (!trimmed) throw new Error("New name cannot be empty");
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      throw new Error("New name cannot contain path separators");
    }
    const target = assertInsideVault(state, path.join(parent, trimmed));
    if (existsSync(target) && target !== src) {
      throw new Error(`Target already exists: ${trimmed}`);
    }
    await rename(src, target);
    return { path: target };
  }
);

ipcMain.handle("vault:delete", async (event, targetPath: string) => {
  const { state } = registrationForEvent(event);
  const abs = assertInsideVault(state, targetPath);
  await shell.trashItem(abs);
  return { ok: true };
});

ipcMain.handle("vault:get-last", async (event) => {
  registrationForEvent(event);
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

ipcMain.handle("vault:set-last", async (event, vaultPath: string) => {
  registrationForEvent(event);
  const current = await readVaultState();
  const recents = [vaultPath, ...current.recents.filter((r) => r !== vaultPath)].slice(0, 10);
  await writeVaultState({ lastVault: vaultPath, recents });
  return { ok: true };
});

app.whenReady().then(() => {
  perfLog(perfMark("app-ready"), "app-ready");
  registerPluginHostIpc();
  createWindow();
});

app.on("before-quit", (event) => {
  if (forceQuit) return;
  const registrations = windowRegistry.liveRegistrations;
  // Repeated quit requests remain blocked while renderers finish their ordered
  // shutdown. Each window's timeout and the process fallback guarantee progress.
  event.preventDefault();
  if (appIsQuitting) return;
  appIsQuitting = true;
  quitFallbackTimer = setTimeout(() => {
    forceFinishAppQuit();
  }, 2_100);
  if (registrations.length === 0) {
    finishAppQuitIfReady();
    return;
  }
  for (const { window } of registrations) window.close();
});

app.on("activate", () => {
  const primaryWindow = windowRegistry.primaryWindow;
  if (!primaryWindow) {
    createWindow();
    return;
  }
  if (primaryWindow.isMinimized()) primaryWindow.restore();
  primaryWindow.show();
  primaryWindow.focus();
});

app.on("window-all-closed", () => {
  if (appIsQuitting) {
    finishAppQuitIfReady();
  } else if (process.platform !== "darwin") {
    app.quit();
  }
});
