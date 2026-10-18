/** Where the browser-side database keeps its JSON. localStorage in the app, memory in tests. */
export interface KeyValueStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const values = new Map(Object.entries(initial));
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => void values.set(key, value),
    remove: (key) => void values.delete(key),
  };
}

let fallback: KeyValueStorage | undefined;

/**
 * The browser's localStorage. When it is unavailable (private mode, blocked site data) the data lives in memory
 * for the current page only, so the app still works but forgets everything on reload.
 */
export function browserStorage(): KeyValueStorage {
  try {
    const storage = window.localStorage;
    const probe = "meetinghub_probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return {
      get: (key) => storage.getItem(key),
      set: (key, value) => storage.setItem(key, value),
      remove: (key) => storage.removeItem(key),
    };
  } catch {
    return (fallback ??= memoryStorage());
  }
}
