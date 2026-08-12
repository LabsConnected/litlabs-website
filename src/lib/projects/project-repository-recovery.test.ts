import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabaseAdmin with a chain that supports the query patterns used by
// recoverStaleProvisioning: select().eq().eq().eq().lt().maybeSingle() and
// update().eq().eq().eq().lt()
vi.mock("@/lib/supabase", () => {
  const state = {
    rows: new Map<string, Record<string, unknown>>(),
    // Controls what the next update call returns (error or success)
    nextUpdateError: null as string | null,
    // Tracks all update calls for assertions
    updateCalls: [] as Array<{
      table: string;
      values: Record<string, unknown>;
      filters: Array<{ column: string; value: unknown }>;
    }>,
  };

  const mockChain = {
    _table: "" as string,
    _filters: [] as Array<{ column: string; value: unknown }>,
    _method: "" as string,
    _selectColumns: "" as string,
    _isMaybeSingle: false,
    _updateValues: {} as Record<string, unknown>,

    from(table: string) {
      this._table = table;
      this._filters = [];
      this._method = "";
      this._selectColumns = "";
      this._isMaybeSingle = false;
      this._updateValues = {};
      return this;
    },
    select(cols?: string) {
      this._method = "select";
      this._selectColumns = cols ?? "*";
      return this;
    },
    insert() {
      this._method = "insert";
      return this;
    },
    update(values: Record<string, unknown>) {
      this._method = "update";
      this._updateValues = values;
      return this;
    },
    delete() {
      this._method = "delete";
      return this;
    },
    eq(column: string, value: unknown) {
      this._filters.push({ column, value });
      return this;
    },
    in(column: string, _values: unknown[]) {
      this._filters.push({ column, value: "in" });
      return this;
    },
    lt(column: string, value: unknown) {
      this._filters.push({ column, value });
      return this;
    },
    maybeSingle() {
      this._isMaybeSingle = true;
      return this;
    },
    single() {
      return this;
    },
    order() {
      return this;
    },
    then(resolve: (v: unknown) => void) {
      const idFilter = this._filters.find((f) => f.column === "id");
      const userIdFilter = this._filters.find((f) => f.column === "user_id");
      const statusFilter = this._filters.find((f) => f.column === "workspace_status");

      const rowKey = idFilter?.value as string;
      const row = state.rows.get(rowKey);

      if (this._method === "select") {
        // recoverStaleProvisioning fetch: must match user_id + workspace_status='provisioning'
        // AND updated_at < cutoff (the lt filter)
        if (this._isMaybeSingle) {
          const ltFilter = this._filters.find((f) => f.column === "updated_at");
          const isStale = ltFilter
            ? row && new Date(row.updated_at as string).getTime() < new Date(ltFilter.value as string).getTime()
            : true;
          if (
            row &&
            row.user_id === userIdFilter?.value &&
            row.workspace_status === statusFilter?.value &&
            isStale
          ) {
            // Return only the requested columns
            const cols = this._selectColumns.split(", ").map((c) => c.trim());
            const data: Record<string, unknown> = {};
            for (const c of cols) {
              data[c] = row[c];
            }
            resolve({ data, error: null });
          } else {
            resolve({ data: null, error: null });
          }
          return;
        }
        resolve({ data: null, error: null });
        return;
      }

      if (this._method === "update") {
        // Track the update call
        state.updateCalls.push({
          table: this._table,
          values: this._updateValues,
          filters: [...this._filters],
        });

        if (state.nextUpdateError) {
          resolve({ data: null, error: { message: state.nextUpdateError } });
          return;
        }

        // Simulate atomic update: only succeed if row still matches filters
        const ltFilter = this._filters.find((f) => f.column === "updated_at");
        const isStale = ltFilter
          ? row && new Date(row.updated_at as string).getTime() < new Date(ltFilter.value as string).getTime()
          : true;
        if (
          row &&
          row.user_id === userIdFilter?.value &&
          row.workspace_status === statusFilter?.value &&
          isStale
        ) {
          // Apply the update to the in-memory row
          Object.assign(row, this._updateValues);
          resolve({ data: row, error: null });
        } else {
          resolve({ data: null, error: null });
        }
        return;
      }

      resolve({ data: null, error: null });
    },
    catch() {
      return this;
    },
  };

  return {
    supabaseAdmin: mockChain,
    // Expose state for test setup
    __testState: state,
  };
});

// Import after mock is set up
import { recoverStaleProvisioning } from "./project-repository";

// Access the internal mock state for test setup
const supabaseMock = (await import("@/lib/supabase")) as unknown as {
  supabaseAdmin: typeof import("@/lib/supabase")["supabaseAdmin"];
  __testState: {
    rows: Map<string, Record<string, unknown>>;
    nextUpdateError: string | null;
    updateCalls: Array<{
      table: string;
      values: Record<string, unknown>;
      filters: Array<{ column: string; value: unknown }>;
    }>;
  };
};

function setRow(
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  supabaseMock.__testState.rows.set(id, {
    id,
    user_id: "user-A",
    workspace_status: "provisioning",
    workspace_error: null,
    updated_at: new Date(Date.now() - 600000).toISOString(), // 10 min ago (stale by default)
    ...overrides,
  });
}

describe("recoverStaleProvisioning", () => {
  beforeEach(() => {
    supabaseMock.__testState.rows.clear();
    supabaseMock.__testState.nextUpdateError = null;
    supabaseMock.__testState.updateCalls = [];
  });

  it("recovers stale provisioning → failed when older than maxAgeMs", async () => {
    setRow("proj-A", {
      user_id: "user-A",
      workspace_status: "provisioning",
      workspace_error: null,
      updated_at: new Date(Date.now() - 600000).toISOString(), // 10 min ago
    });

    const result = await recoverStaleProvisioning("proj-A", "user-A", 300000);

    expect(result).toBe(true);
    expect(supabaseMock.__testState.updateCalls).toHaveLength(1);
    const update = supabaseMock.__testState.updateCalls[0];
    expect(update.values.workspace_status).toBe("failed");
    expect(update.values.workspace_error).toBe("Provisioning timed out");
  });

  it("does not recover when provisioning is fresh (within maxAgeMs)", async () => {
    setRow("proj-A", {
      user_id: "user-A",
      workspace_status: "provisioning",
      updated_at: new Date(Date.now() - 60000).toISOString(), // 1 min ago (fresh)
    });

    const result = await recoverStaleProvisioning("proj-A", "user-A", 300000);

    expect(result).toBe(false);
    expect(supabaseMock.__testState.updateCalls).toHaveLength(0);
  });

  it("returns false when wrong user tries to recover (ownership scoped)", async () => {
    setRow("proj-A", {
      user_id: "user-A", // owned by user-A
      workspace_status: "provisioning",
      updated_at: new Date(Date.now() - 600000).toISOString(),
    });

    const result = await recoverStaleProvisioning("proj-A", "user-B", 300000);

    expect(result).toBe(false);
    expect(supabaseMock.__testState.updateCalls).toHaveLength(0);
  });

  it("returns false when project does not exist", async () => {
    // No row set
    const result = await recoverStaleProvisioning("nonexistent", "user-A", 300000);

    expect(result).toBe(false);
    expect(supabaseMock.__testState.updateCalls).toHaveLength(0);
  });

  it("returns false when workspace_status is not 'provisioning'", async () => {
    setRow("proj-A", {
      user_id: "user-A",
      workspace_status: "ready", // not provisioning
      updated_at: new Date(Date.now() - 600000).toISOString(),
    });

    const result = await recoverStaleProvisioning("proj-A", "user-A", 300000);

    expect(result).toBe(false);
    expect(supabaseMock.__testState.updateCalls).toHaveLength(0);
  });

  it("preserves previous workspace_error in the new error message", async () => {
    setRow("proj-A", {
      user_id: "user-A",
      workspace_status: "provisioning",
      workspace_error: "Docker build failed at step 3",
      updated_at: new Date(Date.now() - 600000).toISOString(),
    });

    const result = await recoverStaleProvisioning("proj-A", "user-A", 300000);

    expect(result).toBe(true);
    const update = supabaseMock.__testState.updateCalls[0];
    expect(update.values.workspace_error).toBe(
      "Docker build failed at step 3 | Provisioning timed out",
    );
  });

  it("returns false when the update fails (supabase error)", async () => {
    setRow("proj-A", {
      user_id: "user-A",
      workspace_status: "provisioning",
      updated_at: new Date(Date.now() - 600000).toISOString(),
    });
    supabaseMock.__testState.nextUpdateError = "connection refused";

    const result = await recoverStaleProvisioning("proj-A", "user-A", 300000);

    expect(result).toBe(false);
  });

  it("allows retry: a second call succeeds after the first recovers", async () => {
    setRow("proj-A", {
      user_id: "user-A",
      workspace_status: "provisioning",
      updated_at: new Date(Date.now() - 600000).toISOString(),
    });

    // First call: recovers the stale lock
    const first = await recoverStaleProvisioning("proj-A", "user-A", 300000);
    expect(first).toBe(true);

    // After recovery, the row is now 'failed' — a second call should not
    // match (status is no longer 'provisioning')
    const second = await recoverStaleProvisioning("proj-A", "user-A", 300000);
    expect(second).toBe(false);
    // Only the first call should have triggered an update
    expect(supabaseMock.__testState.updateCalls).toHaveLength(1);
  });

  it("uses 5-minute default maxAgeMs when not specified", async () => {
    // 4 min ago — should NOT be recovered with 5 min default
    setRow("proj-A", {
      user_id: "user-A",
      workspace_status: "provisioning",
      updated_at: new Date(Date.now() - 240000).toISOString(), // 4 min
    });

    const result = await recoverStaleProvisioning("proj-A", "user-A");
    expect(result).toBe(false);

    // Now set to 6 min ago — SHOULD be recovered with 5 min default
    supabaseMock.__testState.rows.get("proj-A")!.updated_at =
      new Date(Date.now() - 360000).toISOString();

    const result2 = await recoverStaleProvisioning("proj-A", "user-A");
    expect(result2).toBe(true);
  });
});
