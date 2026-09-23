import { describe, it, expect } from "vitest";
import { extractClerkEnvFromSecrets } from "../preview-clerk-env";

describe("extractClerkEnvFromSecrets", () => {
  it("picks only the Clerk keys out of a full secrets map", () => {
    expect(
      extractClerkEnvFromSecrets({
        CLERK_SECRET_KEY: "sk_test_abc",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_xyz",
        OPENAI_API_KEY: "must-not-pass-through",
        DATABASE_URL: "must-not-pass-through",
      }),
    ).toEqual({
      CLERK_SECRET_KEY: "sk_test_abc",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_xyz",
    });
  });

  it("maps CLERK_PUBLISHABLE_KEY to NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", () => {
    expect(
      extractClerkEnvFromSecrets({
        CLERK_SECRET_KEY: "sk_test_abc",
        CLERK_PUBLISHABLE_KEY: "pk_test_xyz",
      }),
    ).toEqual({
      CLERK_SECRET_KEY: "sk_test_abc",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_xyz",
    });
  });

  it("prefers NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY over the fallback", () => {
    expect(
      extractClerkEnvFromSecrets({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
        CLERK_PUBLISHABLE_KEY: "pk_test_fallback",
      }),
    ).toEqual({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public" });
  });

  it("cleans quotes/whitespace and drops empty values", () => {
    expect(
      extractClerkEnvFromSecrets({
        CLERK_SECRET_KEY: '  "sk_test_abc"\n',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
      }),
    ).toEqual({ CLERK_SECRET_KEY: "sk_test_abc" });
  });

  it("returns an empty map when no Clerk keys are stored", () => {
    expect(extractClerkEnvFromSecrets({ OTHER: "x" })).toEqual({});
  });
});
