/**
 * Bounded argument normalization — local models emit the right value
 * under the wrong key ("file" for "path"). Recovery renames declared
 * donor aliases ONLY when the target is missing and the donor is
 * unambiguous. It never invents a value and never bypasses validation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeToolCallArgs,
  validateToolCallArgs,
} from "../agent-loop.js";
import type { ToolDefinition } from "../types.js";

const WRITE_FILE: ToolDefinition = {
  id: "project.write_file",
  name: "write_file",
  description: "write",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  readOnly: false,
};
const DEFS = [WRITE_FILE];

test("donor alias renames to required path", () => {
  const r = normalizeToolCallArgs("project.write_file",
    { file: "a.txt", content: "x" }, DEFS);
  assert.deepEqual(r.renames, [["file", "path"]]);
  assert.equal(r.inputs.path, "a.txt");
  assert.equal(validateToolCallArgs("project.write_file", r.inputs, DEFS), null);
});

test("donor alias renames to required content", () => {
  const r = normalizeToolCallArgs("project.write_file",
    { path: "a.txt", text: "hello" }, DEFS);
  assert.deepEqual(r.renames, [["text", "content"]]);
  assert.equal(r.inputs.content, "hello");
});

test("multiple donors -> ambiguous -> untouched (still fails)", () => {
  const r = normalizeToolCallArgs("project.write_file",
    { file: "a.txt", filename: "b.txt", content: "x" }, DEFS);
  assert.equal(r.renames.length, 0);
  assert.equal(r.inputs.path, undefined);
  assert.match(validateToolCallArgs("project.write_file", r.inputs, DEFS)!, /Missing required/);
});

test("no donor -> untouched (still fails, nothing invented)", () => {
  const r = normalizeToolCallArgs("project.write_file", { content: "x" }, DEFS);
  assert.equal(r.renames.length, 0);
  assert.match(validateToolCallArgs("project.write_file", r.inputs, DEFS)!, /Missing required argument: path/);
});

test("existing correct arg is never overwritten by a donor", () => {
  const r = normalizeToolCallArgs("project.write_file",
    { path: "real.txt", file: "decoy.txt", content: "x" }, DEFS);
  assert.equal(r.renames.length, 0);
  assert.equal(r.inputs.path, "real.txt");
});

test("non-string donor is ignored", () => {
  const r = normalizeToolCallArgs("project.write_file",
    { file: { nested: "a.txt" }, content: "x" }, DEFS);
  assert.equal(r.renames.length, 0);
});

test("unknown tool passes through", () => {
  const r = normalizeToolCallArgs("nope.tool", { file: "a" }, DEFS);
  assert.equal(r.renames.length, 0);
  assert.equal(r.inputs.file, "a");
});

test("valid call is unchanged", () => {
  const input = { path: "a.txt", content: "x" };
  const r = normalizeToolCallArgs("project.write_file", input, DEFS);
  assert.equal(r.renames.length, 0);
  assert.deepEqual(r.inputs, input);
});

test("placeholder tokens still rejected (FILE_PATH)", () => {
  const err = validateToolCallArgs("project.write_file",
    { path: "FILE_PATH", content: "x" }, DEFS);
  assert.match(err!, /unresolved placeholder/);
});

test("uppercase user content is NOT a placeholder (MADE_BY_LITT)", () => {
  const err = validateToolCallArgs("project.write_file",
    { path: "a.txt", content: "MADE_BY_LITT" }, DEFS);
  assert.equal(err, null);
});

test("compound placeholder head-word still rejected (PATH_TO_FILE)", () => {
  const err = validateToolCallArgs("project.write_file",
    { path: "PATH_TO_FILE", content: "x" }, DEFS);
  assert.match(err!, /unresolved placeholder/);
});

test("double-wrapped envelope unwraps to real args (captured 1.7b shape)", () => {
  const r = normalizeToolCallArgs("project.write_file",
    { tool: "project_write_file", inputs: { content: "MADE_BY_LITT", path: "litt-created-marker.txt" } }, DEFS);
  assert.equal(r.inputs.path, "litt-created-marker.txt");
  assert.equal(r.inputs.content, "MADE_BY_LITT");
  assert.equal(validateToolCallArgs("project.write_file", r.inputs, DEFS), null);
});

test("non-pure envelope is NOT unwrapped", () => {
  const r = normalizeToolCallArgs("project.write_file",
    { tool: "x", inputs: { path: "a" }, extra: "keep" }, DEFS);
  assert.equal(r.inputs.path, undefined); // not descended — extra key present
});
