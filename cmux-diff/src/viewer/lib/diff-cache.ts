export type DiffViewMode = "unified" | "split";

export interface DiffDisplayOptions {
  viewMode: DiffViewMode;
  showUnchanged: boolean;
  wordWrap: boolean;
}

export function buildParsedDiffCacheKey(fingerprint: string): string {
  return `${fingerprint}::parsed`;
}

const MAX_CACHE_ENTRIES = 600;
const cache = new Map<string, unknown>();

export function buildDiffCacheKey(fingerprint: string, options: DiffDisplayOptions): string {
  const mode = options.viewMode;
  const unchanged = options.showUnchanged ? "all" : "collapsed";
  const wrap = options.wordWrap ? "wrap" : "scroll";
  return `${fingerprint}::${mode}::${unchanged}::${wrap}`;
}

export function getCachedDiff<T = unknown>(key: string): T | undefined {
  const value = cache.get(key) as T | undefined;
  if (value !== undefined) {
    cache.delete(key);
    cache.set(key, value);
  }

  return value;
}

export function setCachedDiff(key: string, value: unknown): void {
  if (cache.has(key)) {
    cache.delete(key);
  }

  cache.set(key, value);
  evictLeastRecentlyUsed();
}

export function clearDiffCache(): void {
  cache.clear();
}

function evictLeastRecentlyUsed(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      return;
    }

    cache.delete(oldestKey);
  }
}
