import "@testing-library/jest-dom/vitest";

// Node 22+ ships an experimental `localStorage` global that is inert unless `--localstorage-file`
// is set, and it shadows jsdom's implementation here, so `zustand/persist` (usePoolConfigStore)
// blows up with "storage.setItem is not a function". Swap in a plain in-memory Storage.
if (typeof globalThis.localStorage?.setItem !== "function") {
  const data = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
  Object.defineProperty(globalThis, "localStorage", { value: memoryStorage, configurable: true });
}
