import { describe, it, expect } from "vitest";

import { isDisposableAcceptanceUser } from "../scripts/final-acceptance/cleanup-acceptance-users.mjs";

/**
 * The Clerk TEST instance caps at 100 users; the staging acceptance
 * workflow permanently consumes ~10 per run. The cleanup script's
 * deletion predicate is the safety contract: ONLY users tagged
 * public_metadata.littAcceptance === true (stamped by
 * create-fresh-user.mjs) may be deleted — every other user is
 * hands-off, however disposable they look.
 */
describe("isDisposableAcceptanceUser", () => {
  it("selects only users carrying the littAcceptance tag", () => {
    expect(
      isDisposableAcceptanceUser({
        id: "user_1",
        public_metadata: { littAcceptance: true },
      }),
    ).toBe(true);
  });

  it.each([
    ["missing metadata", { id: "user_2" }],
    ["empty metadata", { id: "user_3", public_metadata: {} }],
    ["tag false", { id: "user_4", public_metadata: { littAcceptance: false } }],
    ["tag truthy non-boolean", { id: "user_5", public_metadata: { littAcceptance: "yes" } }],
    [
      "owner-style acceptance email, untagged",
      {
        id: "user_6",
        public_metadata: {},
        email_addresses: [{ email_address: "litt-acceptance-1@litlabs.net" }],
      },
    ],
    [
      "real test user",
      {
        id: "user_7",
        public_metadata: {},
        email_addresses: [{ email_address: "beta_stg+clerk_test@litlabs.net" }],
      },
    ],
  ])("never deletes %s", (_label, user) => {
    expect(isDisposableAcceptanceUser(user)).toBe(false);
  });
});
