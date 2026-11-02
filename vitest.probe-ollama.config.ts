import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Local-only probe: drives the REAL provider router against the local Ollama
// endpoint. Requires a running Ollama with a litt-hermes model — never runs in
// the default suite (separate include set, invoked explicitly).
export default defineConfig({
  ...base,
  test: { ...base.test, include: ["tasks/probe-ollama-generate.test.ts", "tasks/probe-ollama-catalog.test.ts"], exclude: [] },
});
