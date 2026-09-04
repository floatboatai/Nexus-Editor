import { normalizeVaultPath } from "@floatboat/nexus-plugin-runtime";

import type { PluginVaultNode } from "../shared/plugin-ipc";
import type { PluginRuntimeHost } from "./plugin-runtime-host";
import type {
  VaultPanelBackend,
  VaultPanelSnapshot,
} from "./vault-panel";

export interface RuntimeVaultPanelBackendOptions {
  readonly runtime: PluginRuntimeHost;
}

function normalizedRoot(rootPath: string): string {
  const root = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root) throw new RangeError("Vault display root cannot be empty");
  return root;
}

function relativePath(rootPath: string, displayPath: string, allowRoot = false): string {
  const root = normalizedRoot(rootPath);
  const path = displayPath.replace(/\\/g, "/");
  const caseInsensitive = /^[a-z]:\//i.test(root);
  const comparableRoot = caseInsensitive ? root.toLocaleLowerCase() : root;
  const comparablePath = caseInsensitive ? path.toLocaleLowerCase() : path;
  if (allowRoot && comparablePath === comparableRoot) return "";
  if (!comparablePath.startsWith(`${comparableRoot}/`)) {
    throw new RangeError("Vault product path is outside the active display root");
  }
  return normalizeVaultPath(path.slice(root.length + 1));
}

function displayPath(rootPath: string, relative: string): string {
  const root = normalizedRoot(rootPath);
  const path = normalizeVaultPath(relative);
  const separator = rootPath.includes("\\") && !rootPath.includes("/") ? "\\" : "/";
  return `${root.replace(/\//g, separator)}${separator}${path.replace(/\//g, separator)}`;
}

function nodeForDisplay(rootPath: string, node: PluginVaultNode): VaultNode {
  return {
    name: node.name,
    path: displayPath(rootPath, node.path),
    kind: node.kind === "folder" ? "directory" : "file",
    ...(node.children
      ? { children: node.children.map((child) => nodeForDisplay(rootPath, child)) }
      : {}),
  };
}

function joinedPath(parent: string, name: string): string {
  const normalizedName = normalizeVaultPath(name.replace(/\\/g, "/"));
  return parent ? normalizeVaultPath(`${parent}/${normalizedName}`) : normalizedName;
}

export function createRuntimeVaultPanelBackend(
  options: RuntimeVaultPanelBackendOptions,
): VaultPanelBackend {
  const { runtime } = options;
  let rootPath: string | null = null;

  const rootForCurrentSession = (): string => {
    const name = runtime.session?.name.replace(/[\\/]+/g, "-").trim() || "Vault";
    return normalizedRoot(`/${name}`);
  };

  const requireRoot = (): string => {
    if (!rootPath) throw new Error("No runtime Vault is open");
    return rootPath;
  };
  const snapshot = (root: string): VaultPanelSnapshot => ({
    rootPath: root,
    displayName: runtime.session?.name ?? root.split(/[\\/]/).pop() ?? "Vault",
    nodes: runtime.productContent.list().map((node) => nodeForDisplay(root, node)),
  });
  const backend: VaultPanelBackend = {
    openVault: async (nextRoot) => {
      const session = await runtime.restoreSession();
      if (!session) throw new Error("The selected Vault could not be restored for the plugin runtime");
      const sessionRoot = rootForCurrentSession();
      if (nextRoot && normalizedRoot(nextRoot) !== sessionRoot) {
        throw new Error("The restored Vault session does not match the requested display root");
      }
      rootPath = normalizedRoot(sessionRoot);
      return snapshot(rootPath);
    },
    pickVault: async () => {
      const session = await runtime.pickSession();
      if (!session) return null;
      const pickedRoot = rootForCurrentSession();
      rootPath = normalizedRoot(pickedRoot);
      return snapshot(rootPath);
    },
    list: async (requestedRoot) => {
      const root = requireRoot();
      if (normalizedRoot(requestedRoot) !== root) {
        throw new RangeError("Vault refresh does not match the active runtime session");
      }
      return runtime.productContent.list().map((node) => nodeForDisplay(root, node));
    },
    listChildren: async (requestedDir) => {
      const root = requireRoot();
      const rel = relativePath(root, requestedDir);
      const find = (nodes: readonly PluginVaultNode[]): PluginVaultNode | null => {
        for (const node of nodes) {
          if (node.path === rel) return node;
          if (node.children) {
            const hit = find(node.children);
            if (hit) return hit;
          }
        }
        return null;
      };
      const node = find(runtime.productContent.list());
      return (node?.children ?? []).map((child) => nodeForDisplay(root, child));
    },
    read: async (path) => {
      const root = requireRoot();
      const result = await runtime.productContent.read(relativePath(root, path));
      return { path: displayPath(root, result.path), content: result.content };
    },
    write: async (path, content) => {
      const root = requireRoot();
      const result = await runtime.productContent.write(relativePath(root, path), content);
      return { path: displayPath(root, result.path) };
    },
    createFile: async (parentDir, name) => {
      const root = requireRoot();
      const parent = relativePath(root, parentDir, true);
      const result = await runtime.productContent.createFile(joinedPath(parent, name));
      return { path: displayPath(root, result.path) };
    },
    createFolder: async (parentDir, name) => {
      const root = requireRoot();
      const parent = relativePath(root, parentDir, true);
      const result = await runtime.productContent.createFolder(joinedPath(parent, name));
      return { path: displayPath(root, result.path) };
    },
    rename: async (path, newName) => {
      const root = requireRoot();
      if (!newName.trim() || newName.includes("/") || newName.includes("\\")) {
        throw new RangeError("Vault file name must be a single path segment");
      }
      const source = relativePath(root, path);
      const slash = source.lastIndexOf("/");
      const destination = slash < 0 ? newName : `${source.slice(0, slash)}/${newName}`;
      const result = await runtime.productContent.rename(source, destination);
      return { path: displayPath(root, result.path) };
    },
    trash: async (path) => runtime.productContent.trash(relativePath(requireRoot(), path)),
    onChanged: (callback) => runtime.productContent.onChanged(callback),
  };
  return Object.freeze(backend);
}
