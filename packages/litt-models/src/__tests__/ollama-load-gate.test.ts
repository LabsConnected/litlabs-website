import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, utimes, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  listResidentOllamaModels,
  acquireOllamaLoadLock,
  OllamaLoadLockTimeout,
  ensureOllamaModelResident,
  OLLAMA_LOAD_LOCK_ENV_VAR,
} from "../ollama-load-gate.js";
import type { EnvGetter } from "../ollama-endpoint.js";

const ENDPOINT = "http://127.0.0.1:11434";

function envFromMap(map: Record<string, string | undefined>): EnvGetter {
  return (key: string) => map[key];
}

function psResponse(models: string[], ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => ({ models: models.map((name) => ({ name })) }),
    text: async () => "",
  } as unknown as Response;
}

/** Scripted fetch: /api/ps answers from a mutable model list; /api/generate
 *  records calls. */
function fakeDaemon(models: { list: string[] }) {
  const generateCalls: string[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/ps")) return psResponse(models.list);
    if (url.endsWith("/api/generate")) {
      generateCalls.push(String(init?.body ?? ""));
      return psResponse(models.list);
    }
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch;
  return { fetchImpl, generateCalls };
}

let dir: string;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "litt-load-gate-test-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("listResidentOllamaModels", () => {
  it("parses /api/ps model names", async () => {
    const models = await listResidentOllamaModels(ENDPOINT, {
      fetchImpl: (async () => psResponse(["litt-coder:8k", "litt-hermes-fast:8k"])) as typeof fetch,
    });
    assert.deepEqual(models, ["litt-coder:8k", "litt-hermes-fast:8k"]);
  });

  it("throws on non-OK responses", async () => {
    await assert.rejects(
      listResidentOllamaModels(ENDPOINT, {
        fetchImpl: (async () => psResponse([], false, 500)) as typeof fetch,
      }),
      /api\/ps 500/,
    );
  });
});

describe("acquireOllamaLoadLock", () => {
  it("serializes contenders — the second waits for release", async () => {
    const path = join(dir, "serial.lock");
    const order: string[] = [];
    const first = await acquireOllamaLoadLock({ path, model: "a" });
    const secondP = (async () => {
      const l = await acquireOllamaLoadLock({ path, model: "b" });
      order.push("second-acquired");
      await l.release();
    })();
    await new Promise((r) => setTimeout(r, 400));
    order.push("first-release");
    await first.release();
    await secondP;
    assert.deepEqual(order, ["first-release", "second-acquired"]);
    // Holder info was written for diagnostics.
    const holder = JSON.parse(await readFile(path, "utf8").catch(() => "{}"));
    void holder; // lock file may already be gone after release — info is best-effort
  });

  it("throws OllamaLoadLockTimeout when the wait budget expires", async () => {
    const path = join(dir, "timeout.lock");
    const held = await acquireOllamaLoadLock({ path });
    await assert.rejects(
      acquireOllamaLoadLock({ path, waitMs: 300 }),
      OllamaLoadLockTimeout,
    );
    await held.release();
  });

  it("reclaims a stale lockfile", async () => {
    const path = join(dir, "stale.lock");
    await writeFile(path, JSON.stringify({ pid: 999999 }));
    const past = new Date(Date.now() - 60_000);
    await utimes(path, past, past);
    const lock = await acquireOllamaLoadLock({ path, staleMs: 5_000 });
    await lock.release();
  });
});

describe("ensureOllamaModelResident", () => {
  it("returns already-resident on the hot path — no lock, no load", async () => {
    const daemon = fakeDaemon({ list: ["litt-coder:8k"] });
    const res = await ensureOllamaModelResident(ENDPOINT, "litt-coder:8k", {
      fetchImpl: daemon.fetchImpl,
      lockPath: join(dir, "ensure-hot.lock"),
      getEnv: envFromMap({}),
    });
    assert.equal(res.state, "already-resident");
    assert.equal(daemon.generateCalls.length, 0);
  });

  it("loads a cold model under the lock and releases it", async () => {
    const lockPath = join(dir, "ensure-cold.lock");
    const daemon = fakeDaemon({ list: [] });
    const res = await ensureOllamaModelResident(ENDPOINT, "litt-coder:8k", {
      fetchImpl: daemon.fetchImpl,
      lockPath,
      keepAlive: "1m",
      getEnv: envFromMap({}),
    });
    assert.equal(res.state, "loaded-under-lock");
    assert.equal(res.loadedByUs, true);
    assert.equal(daemon.generateCalls.length, 1);
    assert.match(daemon.generateCalls[0], /"model":"litt-coder:8k"/);
    assert.match(daemon.generateCalls[0], /"keep_alive":"1m"/);
    // Lock released — path is gone.
    await assert.rejects(stat(lockPath));
  });

  it("returns became-resident when another holder loaded the model", async () => {
    const lockPath = join(dir, "ensure-race.lock");
    const models = { list: [] as string[] };
    const daemon = fakeDaemon(models);
    // Another agent holds the lock while it loads.
    const held = await acquireOllamaLoadLock({ path: lockPath });
    const pending = ensureOllamaModelResident(ENDPOINT, "litt-coder:8k", {
      fetchImpl: daemon.fetchImpl,
      lockPath,
      getEnv: envFromMap({}),
    });
    await new Promise((r) => setTimeout(r, 300));
    models.list = ["litt-coder:8k"]; // other agent's load finished
    await held.release();
    const res = await pending;
    assert.equal(res.state, "became-resident");
    assert.equal(daemon.generateCalls.length, 0);
  });

  it("proceeds without the guarantee when the lock wait expires", async () => {
    const lockPath = join(dir, "ensure-timeout.lock");
    const held = await acquireOllamaLoadLock({ path: lockPath });
    const notes: string[] = [];
    const res = await ensureOllamaModelResident(ENDPOINT, "litt-coder:8k", {
      fetchImpl: fakeDaemon({ list: [] }).fetchImpl,
      lockPath,
      waitMs: 300,
      getEnv: envFromMap({}),
      onNote: (state, detail) => notes.push(`${state}:${detail.slice(0, 40)}`),
    });
    await held.release();
    assert.equal(res.state, "lock-timeout-proceeded");
    assert.equal(notes.length, 1);
    assert.match(notes[0], /^lock-timeout-proceeded/);
  });

  it("returns probe-failed when /api/ps errors", async () => {
    const res = await ensureOllamaModelResident(ENDPOINT, "litt-coder:8k", {
      fetchImpl: (async () => psResponse([], false, 503)) as typeof fetch,
      lockPath: join(dir, "ensure-psdown.lock"),
      getEnv: envFromMap({}),
    });
    assert.equal(res.state, "probe-failed");
  });

  it(`returns gate-disabled when ${OLLAMA_LOAD_LOCK_ENV_VAR}=off`, async () => {
    const daemon = fakeDaemon({ list: [] });
    const res = await ensureOllamaModelResident(ENDPOINT, "litt-coder:8k", {
      fetchImpl: daemon.fetchImpl,
      lockPath: join(dir, "ensure-off.lock"),
      getEnv: envFromMap({ [OLLAMA_LOAD_LOCK_ENV_VAR]: "off" }),
    });
    assert.equal(res.state, "gate-disabled");
    assert.equal(daemon.generateCalls.length, 0);
  });
});
