import { describe, it, expect } from "vitest";
import { DEX_TOLL_FREE_CALLER_ID, DEX_SMS_ENABLED, DEX_TRANSFER_TARGET_ENV_VAR } from "./dex-call-config";

describe("dex-call-config", () => {
  it("uses the owner-approved existing toll-free number, not a newly purchased one", () => {
    expect(DEX_TOLL_FREE_CALLER_ID).toBe("+18772838063");
  });

  it("keeps SMS disabled by default pending toll-free verification", () => {
    expect(DEX_SMS_ENABLED).toBe(false);
  });

  it("never hardcodes the owner's personal number — only names the env var to read it from", () => {
    expect(DEX_TRANSFER_TARGET_ENV_VAR).toBe("DEX_TRANSFER_TARGET_NUMBER");
    // Guard against a future edit accidentally hardcoding a literal phone
    // number here instead of the env var name.
    expect(DEX_TRANSFER_TARGET_ENV_VAR).not.toMatch(/^\+?\d{7,}$/);
  });
});
