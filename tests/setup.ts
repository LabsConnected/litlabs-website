import { beforeEach } from "vitest";

// Set test API keys before any module imports.
// In local dev these come from .env.local; in CI they must be set here
// so that llm.ts and env.ts don't reject them as missing.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "test-gemini-key";
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-openrouter-key";
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY ?? "test-groq-key";
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID ?? "test-aws-key";
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY ?? "test-aws-secret";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const localStorage = new MemoryStorage();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorage,
  writable: true,
});

// jsdom does not implement window.matchMedia. Provide a minimal polyfill
// that evaluates simple min-width/max-width queries against a
// configurable virtual viewport width (default: desktop, 1440px), so
// hooks like useViewportTier work in tests without a real browser.
// Tests can override the width via `globalThis.__TEST_VIEWPORT_WIDTH__`.
declare global {
  var __TEST_VIEWPORT_WIDTH__: number | undefined;
}
globalThis.__TEST_VIEWPORT_WIDTH__ = globalThis.__TEST_VIEWPORT_WIDTH__ ?? 1440;

function evaluateMediaQuery(query: string): boolean {
  const minMatch = query.match(/min-width:\s*(\d+)px/);
  const maxMatch = query.match(/max-width:\s*(\d+)px/);
  // Only min-width/max-width queries are understood by this polyfill.
  // Anything else (prefers-reduced-motion, prefers-color-scheme, hover,
  // pointer, etc.) defaults to false — the same "feature not present"
  // behavior most components expect in a plain jsdom environment, and
  // the same effective default as when window.matchMedia didn't exist
  // at all before this polyfill was added.
  if (!minMatch && !maxMatch) return false;
  const width = globalThis.__TEST_VIEWPORT_WIDTH__ ?? 1440;
  if (minMatch && width < Number(minMatch[1])) return false;
  if (maxMatch && width > Number(maxMatch[1])) return false;
  return true;
}

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    const mql = {
      get matches() {
        return evaluateMediaQuery(query);
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: (e: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (e: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: (listener: (e: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: (e: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
    return mql;
  }) as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  globalThis.__TEST_VIEWPORT_WIDTH__ = 1440;
});
