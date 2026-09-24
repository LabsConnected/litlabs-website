import { afterEach, describe, expect, it } from "vitest";
import { isOwnerClerkId } from "./owner-identity";

const OWNER_ID = "user_owner_clerk_id_0001";
const OTHER_ID = "user_random_clerk_id_9999";

const savedEnv = {
  LITTLABS_VAPI_OWNER_CLERK_ID: process.env.LITTLABS_VAPI_OWNER_CLERK_ID,
  ADMIN_CLERK_IDS: process.env.ADMIN_CLERK_IDS,
};

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("isOwnerClerkId", () => {
  it("allows the owner via LITTLABS_VAPI_OWNER_CLERK_ID alone", () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
    delete process.env.ADMIN_CLERK_IDS;
    expect(isOwnerClerkId(OWNER_ID)).toBe(true);
  });

  it("allows additional admins via ADMIN_CLERK_IDS", () => {
    delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
    process.env.ADMIN_CLERK_IDS = ` ${OTHER_ID} , user_third_admin `;
    expect(isOwnerClerkId(OTHER_ID)).toBe(true);
    expect(isOwnerClerkId("user_third_admin")).toBe(true);
  });

  it("denies non-owners", () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
    delete process.env.ADMIN_CLERK_IDS;
    expect(isOwnerClerkId(OTHER_ID)).toBe(false);
  });

  it("denies everyone when neither variable is set", () => {
    delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
    delete process.env.ADMIN_CLERK_IDS;
    expect(isOwnerClerkId(OWNER_ID)).toBe(false);
  });

  it("denies null/undefined/empty ids", () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
    expect(isOwnerClerkId(null)).toBe(false);
    expect(isOwnerClerkId(undefined)).toBe(false);
    expect(isOwnerClerkId("")).toBe(false);
  });

  it("is what mission-control re-exports (regression: stale ADMIN-only check)", async () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
    delete process.env.ADMIN_CLERK_IDS;
    const { isOwnerClerkId: fromMissionControl } = await import("./mission-control");
    expect(fromMissionControl(OWNER_ID)).toBe(true);
    expect(fromMissionControl(OTHER_ID)).toBe(false);
  });
});
