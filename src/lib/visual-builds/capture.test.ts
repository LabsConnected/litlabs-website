/**
 * capture URL validation tests (SSRF hardening).
 *
 * Run: npx vitest run src/lib/visual-builds/capture.test.ts
 */

import { describe, it, expect, afterEach } from "vitest";
import { validateCaptureUrl } from "./capture";

describe("validateCaptureUrl", () => {
  afterEach(() => {
    delete process.env.CAPTURE_HOST_ALLOWLIST;
  });

  it("rejects file:// URLs", async () => {
    await expect(validateCaptureUrl("file:///etc/passwd")).rejects.toThrow(
      /must use http or https/i,
    );
  });

  it("rejects non-http schemes", async () => {
    await expect(validateCaptureUrl("ftp://example.com/x")).rejects.toThrow(
      /must use http or https/i,
    );
    await expect(validateCaptureUrl("javascript:alert(1)")).rejects.toThrow();
  });

  it("rejects malformed URLs", async () => {
    await expect(validateCaptureUrl("not a url")).rejects.toThrow(
      /invalid capture url/i,
    );
  });

  it("rejects credentials embedded in the URL", async () => {
    await expect(
      validateCaptureUrl("https://user:pass@example.com/"),
    ).rejects.toThrow(/must not contain credentials/i);
  });

  it("rejects the cloud metadata endpoint", async () => {
    await expect(validateCaptureUrl("http://169.254.169.254/")).rejects.toThrow(
      /not allowed/i,
    );
  });

  it("rejects loopback and private IPv4 literals", async () => {
    for (const url of [
      "http://127.0.0.1:3000/",
      "http://10.0.0.5/",
      "http://192.168.1.10:8080/x",
      "http://172.16.4.2/",
    ]) {
      await expect(validateCaptureUrl(url)).rejects.toThrow(/not allowed/i);
    }
  });

  it("rejects localhost hostnames", async () => {
    await expect(validateCaptureUrl("http://localhost:3000/")).rejects.toThrow(
      /not allowed/i,
    );
    await expect(validateCaptureUrl("http://app.localhost/")).rejects.toThrow(
      /not allowed/i,
    );
  });

  it("rejects IPv6 loopback / link-local / unique-local literals", async () => {
    await expect(validateCaptureUrl("http://[::1]/")).rejects.toThrow(/not allowed/i);
    await expect(validateCaptureUrl("http://[fe80::1]/")).rejects.toThrow(
      /not allowed/i,
    );
    await expect(validateCaptureUrl("http://[fd00::1]/")).rejects.toThrow(
      /not allowed/i,
    );
  });

  it("allows public IP literals without DNS", async () => {
    // 93.184.216.34 is a public address; no DNS lookup is needed for literals.
    const normalized = await validateCaptureUrl("http://93.184.216.34:8080/x");
    expect(normalized).toBe("http://93.184.216.34:8080/x");
  });

  it("allows explicitly allowlisted internal hosts", async () => {
    process.env.CAPTURE_HOST_ALLOWLIST = "localhost, internal.dev";
    expect(await validateCaptureUrl("http://localhost:3000/preview")).toBe(
      "http://localhost:3000/preview",
    );
  });

  it("still rejects credentials even for allowlisted hosts", async () => {
    process.env.CAPTURE_HOST_ALLOWLIST = "localhost";
    await expect(
      validateCaptureUrl("http://user:pw@localhost/"),
    ).rejects.toThrow(/must not contain credentials/i);
  });

  it("rejects hostnames that resolve to blocked addresses", async () => {
    // localhost always resolves to loopback; without an allowlist it must fail.
    await expect(validateCaptureUrl("http://localhost/")).rejects.toThrow(
      /not allowed/i,
    );
  });
});
