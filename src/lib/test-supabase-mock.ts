/* eslint-disable @typescript-eslint/no-explicit-any */
// Test helper: chainable mock of the supabase-js query builder used by social routes.
// Not a test file itself (no *.test.ts suffix).
import { vi } from "vitest";

export type MockRow = Record<string, any>;
export type MockHandler = (
  table: string,
  ops: { op: string; args: any[] }[],
) => { data?: any; error?: any } | Promise<{ data?: any; error?: any }>;

const CHAIN_METHODS = [
  "select",
  "eq",
  "neq",
  "in",
  "or",
  "gte",
  "lte",
  "gt",
  "lt",
  "is",
  "order",
  "limit",
  "match",
  "single",
  "maybeSingle",
  "insert",
  "update",
  "delete",
];

export function createMockSupabase(handler: MockHandler) {
  const makeQuery = (table: string) => {
    const ops: { op: string; args: any[] }[] = [];
    const q: any = {};
    for (const m of CHAIN_METHODS) {
      q[m] = (...args: any[]) => {
        ops.push({ op: m, args });
        return q;
      };
    }
    // Make the builder awaitable like a real supabase query.
    q.then = (resolve: (v: any) => void, reject?: (e: any) => void) => {
      Promise.resolve()
        .then(() => handler(table, ops))
        .then((r) => resolve({ data: r?.data ?? null, error: r?.error ?? null }))
        .catch(reject);
    };
    return q;
  };

  return {
    from: vi.fn((table: string) => makeQuery(table)),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
}
