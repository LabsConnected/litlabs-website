import { describe, it, expect } from "vitest";

import {
  DEMO_SESSION_COOKIE,
  createDemoSessionValue,
  readDemoSessionValue,
  serializeDemoSessionCookie,
} from "./session";

describe("demo session cookies", () => {
  it("round-trips: created value verifies to its UUID", () => {
    const value = createDemoSessionValue();
    const id = readDemoSessionValue(value);
    expect(id).not.toBeNull();
    expect(value.startsWith(`${id}.`)).toBe(true);
  });

  it("rejects tampered signatures", () => {
    const value = createDemoSessionValue();
    const [id, sig] = value.split(".");
    // Flip a signature char.
    const tampered = `${id}.${sig.slice(0, -1)}${sig.endsWith("a") ? "b" : "a"}`;
    expect(readDemoSessionValue(tampered)).toBeNull();
    // Swap in a foreign UUID with the original signature.
    const other = createDemoSessionValue().split(".")[0];
    expect(readDemoSessionValue(`${other}.${sig}`)).toBeNull();
  });

  it("rejects malformed values", () => {
    expect(readDemoSessionValue(null)).toBeNull();
    expect(readDemoSessionValue(undefined)).toBeNull();
    expect(readDemoSessionValue("")).toBeNull();
    expect(readDemoSessionValue("not-a-uuid.sig")).toBeNull();
    expect(readDemoSessionValue("no-dot-here")).toBeNull();
  });

  it("serializes an httpOnly, lax, path-scoped cookie", () => {
    const header = serializeDemoSessionCookie("abc.def", 3600);
    expect(header).toContain(`${DEMO_SESSION_COOKIE}=abc.def`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=3600");
  });
});
