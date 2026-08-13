/**
 * Normalize path slashes to forward slashes (Unix-style).
 * Useful for cross-platform path comparisons.
 */
export function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Join path segments with forward slashes.
 * Unlike path.join(), always returns forward slashes regardless of platform.
 */
export function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\\/g, "/").replace(/\/+/g, "/");
}

/**
 * Rebase a path when a file or one of its parent directories is renamed.
 * Returns the original value when it is outside the renamed subtree.
 */
export function rebaseRenamedPath(path: string, oldPath: string, newPath: string): string {
  const normalizedPath = normalizeSlashes(path);
  const normalizedOld = normalizeSlashes(oldPath).replace(/\/+$/, "");
  const normalizedNew = normalizeSlashes(newPath).replace(/\/+$/, "");

  if (normalizedPath !== normalizedOld && !normalizedPath.startsWith(`${normalizedOld}/`)) {
    return path;
  }

  const suffix = normalizedPath.slice(normalizedOld.length);
  const rebased = normalizedNew + suffix;
  const useBackslashes = newPath.includes("\\") && !newPath.includes("/");
  return useBackslashes ? rebased.replace(/\//g, "\\") : rebased;
}
