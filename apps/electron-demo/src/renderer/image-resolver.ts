export type ImageReferenceResolution =
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "vault"; readonly path: string };

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-z]:[\\/]/i.test(value);
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeRelativePath(value: string): string | null {
  const result: string[] = [];
  for (const segment of value.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (result.length === 0) return null;
      result.pop();
      continue;
    }
    result.push(segment);
  }
  return result.length > 0 ? result.join("/") : null;
}

function toVaultRelativePath(vaultRoot: string, filePath: string): string | null {
  const root = vaultRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const file = filePath.replace(/\\/g, "/");
  if (!root || !file) return null;

  const caseInsensitive = isWindowsAbsolutePath(root);
  const comparableRoot = caseInsensitive ? root.toLocaleLowerCase() : root;
  const comparableFile = caseInsensitive ? file.toLocaleLowerCase() : file;
  if (!comparableFile.startsWith(`${comparableRoot}/`)) return null;

  return normalizeRelativePath(file.slice(root.length + 1));
}

export function isExternalImageUrl(source: string): boolean {
  return /^(?:https?:|data:image\/)/i.test(source.trim());
}

export function resolveVaultImagePath(
  source: string,
  activeFile: string | null,
  vaultRoot: string | null,
): string | null {
  const raw = source.trim();
  if (!raw || isExternalImageUrl(raw) || raw.startsWith("/") || raw.startsWith("\\")) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(raw)) return null;
  if (isWindowsAbsolutePath(raw) || raw.startsWith("//")) return null;
  if (!activeFile || !vaultRoot) return null;

  const activeRelative = toVaultRelativePath(vaultRoot, activeFile);
  if (!activeRelative) return null;
  const directory = activeRelative.includes("/")
    ? activeRelative.slice(0, activeRelative.lastIndexOf("/"))
    : "";
  const decoded = decodePath(raw);
  return normalizeRelativePath(directory ? `${directory}/${decoded}` : decoded);
}

export function resolveImageReference(
  source: string,
  activeFile: string | null,
  vaultRoot: string | null,
): ImageReferenceResolution | null {
  const raw = source.trim();
  if (!raw) return null;
  if (isExternalImageUrl(raw)) return { kind: "external", url: raw };

  const path = resolveVaultImagePath(raw, activeFile, vaultRoot);
  return path ? { kind: "vault", path } : null;
}
