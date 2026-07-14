import path from "node:path";

export function assertPathInsideVault(vaultRoot: string, target: string): string {
  const root = path.resolve(vaultRoot);
  const resolved = path.resolve(target);
  const rel = path.relative(root, resolved);
  if (rel === "" || rel === ".") return resolved;
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes vault: ${target}`);
  }
  return resolved;
}
