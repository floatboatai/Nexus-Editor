/**
 * Normalize path slashes to forward slashes (Unix-style).
 * Useful for cross-platform path comparisons.
 */
export function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

function trimTrailingSlashes(path: string): string {
  if (path === "/") return path;
  return path.replace(/\/+$/g, "") || "/";
}

/**
 * Join path segments with forward slashes.
 * Unlike path.join(), always returns forward slashes regardless of platform.
 */
export function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\\/g, "/").replace(/\/+/g, "/");
}

/**
 * Return true when targetPath is basePath itself or a descendant of basePath.
 * Uses a slash boundary so sibling-prefix paths like /vault2 do not match /vault.
 */
export function isPathInside(basePath: string, targetPath: string): boolean {
  const base = trimTrailingSlashes(normalizeSlashes(basePath));
  const target = trimTrailingSlashes(normalizeSlashes(targetPath));
  if (base === "/") return target === "/" || target.startsWith("/");
  return target === base || target.startsWith(`${base}/`);
}
