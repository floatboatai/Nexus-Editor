const DEFAULT_STORAGE_KEY = "nexus-plugin-wrap.v1";
const FALLBACK_KEY = "__default__";

let store: Map<string, boolean> | null = null;
let storageKey: string = DEFAULT_STORAGE_KEY;

export function configureStorage(key: string): void {
  const next = key || DEFAULT_STORAGE_KEY;
  if (next === storageKey) return;
  store = null;
  storageKey = next;
}

function load(): Map<string, boolean> {
  if (store) return store;
  store = new Map();
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return store;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "boolean") store.set(k, v);
      }
    }
  } catch {
    // ignore
  }
  return store;
}

function persist(): void {
  if (!store) return;
  try {
    const obj: Record<string, boolean> = {};
    for (const [k, v] of store) obj[k] = v;
    localStorage.setItem(storageKey, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

export function getWrapForFile(filePath: string | null): boolean | undefined {
  const m = load();
  const key = filePath ?? FALLBACK_KEY;
  return m.get(key);
}

export function setWrapForFile(filePath: string | null, enabled: boolean): void {
  const m = load();
  const key = filePath ?? FALLBACK_KEY;
  if (m.get(key) === enabled) return;
  m.set(key, enabled);
  persist();
}

export function clearWrapForFile(filePath: string | null): void {
  const m = load();
  const key = filePath ?? FALLBACK_KEY;
  if (m.delete(key)) persist();
}

export function clearAllWrapState(): void {
  if (store) store.clear();
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
}

export function renameWrapForPath(oldPath: string, newPath: string): void {
  const m = load();
  if (oldPath === newPath) return;
  const sep = oldPath.includes("\\") && !oldPath.includes("/") ? "\\" : "/";
  const oldPrefix = oldPath.endsWith(sep) ? oldPath : `${oldPath}${sep}`;
  const newPrefix = newPath.endsWith(sep) ? newPath : `${newPath}${sep}`;
  let changed = false;
  for (const key of Array.from(m.keys())) {
    let nextKey: string | null = null;
    if (key === oldPath) {
      nextKey = newPath;
    } else if (key.startsWith(oldPrefix)) {
      nextKey = `${newPrefix}${key.slice(oldPrefix.length)}`;
    }
    if (nextKey === null) continue;
    const v = m.get(key);
    m.delete(key);
    if (v !== undefined) m.set(nextKey, v);
    changed = true;
  }
  if (changed) persist();
}

export function resolveWrapForFile(
  filePath: string | null,
  globalDefault: boolean,
): boolean {
  const override = getWrapForFile(filePath);
  return override ?? globalDefault;
}
