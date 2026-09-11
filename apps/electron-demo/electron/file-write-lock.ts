const writes = new Map<string, Promise<void>>();

/** Serializes compare-and-write across Vault windows and selected-file handles. */
export async function withFileWriteLock<T>(canonicalPath: string, operation: () => Promise<T>): Promise<T> {
  const previous = writes.get(canonicalPath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  writes.set(canonicalPath, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (writes.get(canonicalPath) === current) writes.delete(canonicalPath);
  }
}
