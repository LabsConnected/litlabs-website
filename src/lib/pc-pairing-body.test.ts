import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { PairingBodyTooLarge, readPairingJson } from "./pc-pairing-body";

describe("pairing request body limit", () => {
  it("accepts exactly 10 KB of received UTF-8 bytes", async () => {
    const body = JSON.stringify({ x: "x".repeat(9992) });
    expect(Buffer.byteLength(body)).toBe(10_000);
    const request = new NextRequest("http://localhost/claim", { method: "POST", body });
    expect(await readPairingJson(request)).toEqual({ x: "x".repeat(9992) });
  });

  it("rejects larger bodies even when Content-Length claims one byte", async () => {
    const body = JSON.stringify({ x: "x".repeat(9993) });
    const request = new NextRequest("http://localhost/claim", {
      method: "POST", body, headers: { "content-length": "1" },
    });
    await expect(readPairingJson(request)).rejects.toBeInstanceOf(PairingBodyTooLarge);
  });
});
