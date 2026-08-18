// @vitest-environment jsdom
/**
 * Onboarding redirect behavioral tests.
 *
 * Verifies that:
 *  1. The SignUp page passes fallbackRedirectUrl="/dashboard" (not "/")
 *     so new users land on a useful destination after signup.
 *  2. The SignIn page passes fallbackRedirectUrl="/dashboard" for
 *     consistent post-auth routing.
 *
 * This is a source-level assertion — we render the page and inspect
 * the Clerk component props to verify the redirect target.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";

// Capture props passed to Clerk's SignUp / SignIn components
let capturedSignUpProps: Record<string, unknown> = {};
let capturedSignInProps: Record<string, unknown> = {};

vi.mock("@clerk/nextjs", () => ({
  SignUp: (props: Record<string, unknown>) => {
    capturedSignUpProps = props;
    return React.createElement("div", { "data-testid": "clerk-signup" });
  },
  SignIn: (props: Record<string, unknown>) => {
    capturedSignInProps = props;
    return React.createElement("div", { "data-testid": "clerk-signin" });
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));

describe("SignUp page redirect", () => {
  beforeEach(() => {
    capturedSignUpProps = {};
  });

  it("passes fallbackRedirectUrl='/dashboard' so new users reach the app", async () => {
    const mod = await import("@/app/(app)/sign-up/[[...sign-up]]/page");
    render(React.createElement(mod.default));

    expect(capturedSignUpProps.fallbackRedirectUrl).toBe("/dashboard");
    // Must NOT be "/" (the old value that sent users back to the landing page)
    expect(capturedSignUpProps.fallbackRedirectUrl).not.toBe("/");
  });
});

describe("SignIn page redirect", () => {
  beforeEach(() => {
    capturedSignInProps = {};
  });

  it("passes fallbackRedirectUrl='/dashboard' for consistent post-auth routing", async () => {
    const mod = await import("@/app/(app)/sign-in/[[...sign-in]]/page");
    render(React.createElement(mod.default));

    expect(capturedSignInProps.fallbackRedirectUrl).toBe("/dashboard");
  });
});
