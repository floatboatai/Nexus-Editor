/**
 * Normalize path slashes to forward slashes (Unix-style).
 * Useful for cross-platform path comparisons.
 */
export function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Extract the last segment of a path (after the final slash).
 * Works with both forward and backward slashes.
 */
export function basename(path: string): string {
  const norm = normalizeSlashes(path);
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

/**
 * Extract the directory portion of a path (everything before the final slash).
 * Returns "" for paths with no slash. Works with both slash directions.
 */
export function dirname(path: string): string {
  const norm = normalizeSlashes(path);
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(0, slash) : "";
}

/**
 * Join path segments with forward slashes.
 * Unlike path.join(), always returns forward slashes regardless of platform.
 */
export function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\\/g, "/").replace(/\/+/g, "/");
}