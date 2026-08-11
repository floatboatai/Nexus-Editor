export type FoundationModelsCacheValue = string | null;

export interface FoundationModelsCacheKey {
  paragraph: string;
  promptVersion: string;
  modelVersion: string;
  availability: string;
}

export interface FoundationModelsSuggestionCacheOptions {
  suggestionTtlMs: number;
  nullTtlMs: number;
  maxEntries: number;
}

interface CacheEntry {
  value: FoundationModelsCacheValue;
  expiresAt: number;
}

export interface FoundationModelsSuggestionCache {
  get(key: FoundationModelsCacheKey): FoundationModelsCacheValue | undefined;
  set(key: FoundationModelsCacheKey, value: FoundationModelsCacheValue): void;
  clear(): void;
}

function serializeKey(key: FoundationModelsCacheKey): string {
  return JSON.stringify([
    key.paragraph.replace(/\s+/g, " ").trim(),
    key.promptVersion,
    key.modelVersion,
    key.availability,
  ]);
}

export function createFoundationModelsSuggestionCache(
  options: FoundationModelsSuggestionCacheOptions
): FoundationModelsSuggestionCache {
  const entries = new Map<string, CacheEntry>();

  function evictExpired(now: number): void {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) {
        entries.delete(key);
      }
    }
  }

  function evictOverflow(): void {
    while (entries.size > options.maxEntries) {
      const oldest = entries.keys().next().value as string | undefined;
      if (!oldest) return;
      entries.delete(oldest);
    }
  }

  return {
    get(key) {
      const now = Date.now();
      evictExpired(now);
      const serialized = serializeKey(key);
      const entry = entries.get(serialized);
      if (!entry) return undefined;
      entries.delete(serialized);
      entries.set(serialized, entry);
      return entry.value;
    },
    set(key, value) {
      const now = Date.now();
      evictExpired(now);
      const serialized = serializeKey(key);
      entries.delete(serialized);
      entries.set(serialized, {
        value,
        expiresAt: now + (value === null ? options.nullTtlMs : options.suggestionTtlMs),
      });
      evictOverflow();
    },
    clear() {
      entries.clear();
    },
  };
}
