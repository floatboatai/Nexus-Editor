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