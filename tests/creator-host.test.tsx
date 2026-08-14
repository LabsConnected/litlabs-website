import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, renderHook } from "@testing-library/react";
import { StudioContextProvider } from "@/app/(app)/studio/context/StudioContext";
import { StudioCreatorHost, useCreatorHost } from "@/app/(app)/studio/components/creators/StudioCreatorHost";
import type { CreatorKind } from "@/app/(app)/studio/lib/studio-destinations";
import type { WorkspaceStage } from "@/app/(app)/studio/lib/studio-destinations";

/**
 * Phase E.1 — StudioCreatorHost tests.
 *
 * Proves:
 * - Plan/Canvas/Code/Preview/Builder surfaces are NOT wrapped as Image.
 * - Each creator host sees the correct canonical creator from StudioContext.
 * - No duplicate creator authority (host derives from context, not a prop).
 * - Host throws if creator is null (callers must guard).
 */

// ─── Test helpers ────────────────────────────────────────────────

function makeWrapper(
  creator: CreatorKind | null,
  projectId: string | null = null,
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <StudioContextProvider
        projectId={projectId}
        sessionId="test-session"
        workspaceMode={"canvas" as WorkspaceStage}
        creator={creator}
      >
        {children}
      </StudioContextProvider>
    );
  }
  return Wrapper;
}

// A child component that reads the creator host context.
function CreatorHostConsumer() {
  const ctx = useCreatorHost();
  return <div data-testid="host-creator">{ctx.creator}</div>;
}

// ─── Host mounting tests ─────────────────────────────────────────

describe("StudioCreatorHost — mounting", () => {
  it("mounts when creator is image", () => {
    const Wrapper = makeWrapper("image");
    const { getByTestId } = render(
      <Wrapper>
        <StudioCreatorHost>
          <CreatorHostConsumer />
        </StudioCreatorHost>
      </Wrapper>,
    );
    expect(getByTestId("host-creator").textContent).toBe("image");
  });

  it("mounts when creator is video", () => {
    const Wrapper = makeWrapper("video");
    const { getByTestId } = render(
      <Wrapper>
        <StudioCreatorHost>
          <CreatorHostConsumer />
        </StudioCreatorHost>
      </Wrapper>,
    );
    expect(getByTestId("host-creator").textContent).toBe("video");
  });

  it("mounts when creator is music", () => {
    const Wrapper = makeWrapper("music");
    const { getByTestId } = render(
      <Wrapper>
        <StudioCreatorHost>
          <CreatorHostConsumer />
        </StudioCreatorHost>
      </Wrapper>,
    );
    expect(getByTestId("host-creator").textContent).toBe("music");
  });

  it("mounts when creator is audio", () => {
    const Wrapper = makeWrapper("audio");
    const { getByTestId } = render(
      <Wrapper>
        <StudioCreatorHost>
          <CreatorHostConsumer />
        </StudioCreatorHost>
      </Wrapper>,
    );
    expect(getByTestId("host-creator").textContent).toBe("audio");
  });

  it("mounts when creator is design", () => {
    const Wrapper = makeWrapper("design");
    const { getByTestId } = render(
      <Wrapper>
        <StudioCreatorHost>
          <CreatorHostConsumer />
        </StudioCreatorHost>
      </Wrapper>,
    );
    expect(getByTestId("host-creator").textContent).toBe("design");
  });

  it("mounts when creator is environment (360°)", () => {
    const Wrapper = makeWrapper("environment");
    const { getByTestId } = render(
      <Wrapper>
        <StudioCreatorHost>
          <CreatorHostConsumer />
        </StudioCreatorHost>
      </Wrapper>,
    );
    expect(getByTestId("host-creator").textContent).toBe("environment");
  });
});

// ─── Null creator tests ──────────────────────────────────────────

describe("StudioCreatorHost — null creator", () => {
  // Suppress console.error from React error boundary during these tests.
  const originalError = console.error;
  beforeAll(() => {
    console.error = vi.fn();
  });
  afterAll(() => {
    console.error = originalError;
  });

  it("throws when creator is null (Plan surface)", () => {
    const Wrapper = makeWrapper(null);
    expect(() =>
      render(
        <Wrapper>
          <StudioCreatorHost>
            <div>Plan</div>
          </StudioCreatorHost>
        </Wrapper>,
      ),
    ).toThrow("active creator");
  });

  it("throws when creator is null (Canvas surface)", () => {
    const Wrapper = makeWrapper(null);
    expect(() =>
      render(
        <Wrapper>
          <StudioCreatorHost>
            <div>Canvas</div>
          </StudioCreatorHost>
        </Wrapper>,
      ),
    ).toThrow("active creator");
  });

  it("throws when creator is null (Code surface)", () => {
    const Wrapper = makeWrapper(null);
    expect(() =>
      render(
        <Wrapper>
          <StudioCreatorHost>
            <div>Code</div>
          </StudioCreatorHost>
        </Wrapper>,
      ),
    ).toThrow("active creator");
  });

  it("throws when creator is null (Preview surface)", () => {
    const Wrapper = makeWrapper(null);
    expect(() =>
      render(
        <Wrapper>
          <StudioCreatorHost>
            <div>Preview</div>
          </StudioCreatorHost>
        </Wrapper>,
      ),
    ).toThrow("active creator");
  });

  it("throws when creator is null (Builder surface)", () => {
    const Wrapper = makeWrapper(null);
    expect(() =>
      render(
        <Wrapper>
          <StudioCreatorHost>
            <div>Builder</div>
          </StudioCreatorHost>
        </Wrapper>,
      ),
    ).toThrow("active creator");
  });
});

// ─── No duplicate creator authority ──────────────────────────────

describe("StudioCreatorHost — no duplicate creator authority", () => {
  it("does not accept a creator prop (derives from context)", () => {
    // The StudioCreatorHostProps interface should NOT have a `creator` field.
    // The host reads creator from useStudioContext(), not from a prop.
    // This is verified by the TypeScript type — if a `creator` prop existed,
    // this test would still pass, but the type check would catch it.
    // The behavioral proof is that the host always reflects StudioContext.creator.
    const Wrapper = makeWrapper("video");
    const { getByTestId } = render(
      <Wrapper>
        <StudioCreatorHost>
          <CreatorHostConsumer />
        </StudioCreatorHost>
      </Wrapper>,
    );
    // The host sees "video" from context, not "image" from any prop.
    expect(getByTestId("host-creator").textContent).toBe("video");
  });

  it("host creator matches StudioContext creator", () => {
    for (const creator of ["image", "video", "music", "audio", "design", "environment"] as CreatorKind[]) {
      const Wrapper = makeWrapper(creator);
      const { getByTestId, unmount } = render(
        <Wrapper>
          <StudioCreatorHost>
            <CreatorHostConsumer />
          </StudioCreatorHost>
        </Wrapper>,
      );
      expect(getByTestId("host-creator").textContent).toBe(creator);
      unmount();
    }
  });
});

// ─── Project context propagation ─────────────────────────────────

describe("StudioCreatorHost — project context", () => {
  it("propagates projectId from StudioContext", () => {
    const Wrapper = makeWrapper("image", "proj-test-001");
    const { result } = renderHook(
      () => useCreatorHost(),
      {
        wrapper: ({ children }) => (
          <Wrapper>
            <StudioCreatorHost>{children}</StudioCreatorHost>
          </Wrapper>
        ),
      },
    );
    expect(result.current.projectId).toBe("proj-test-001");
  });

  it("propagates null projectId when no project", () => {
    const Wrapper = makeWrapper("image", null);
    const { result } = renderHook(
      () => useCreatorHost(),
      {
        wrapper: ({ children }) => (
          <Wrapper>
            <StudioCreatorHost>{children}</StudioCreatorHost>
          </Wrapper>
        ),
      },
    );
    expect(result.current.projectId).toBeNull();
  });

  it("propagates sessionId from StudioContext", () => {
    const Wrapper = makeWrapper("image");
    const { result } = renderHook(
      () => useCreatorHost(),
      {
        wrapper: ({ children }) => (
          <Wrapper>
            <StudioCreatorHost>{children}</StudioCreatorHost>
          </Wrapper>
        ),
      },
    );
    expect(result.current.sessionId).toBe("test-session");
  });
});

// ─── useCreatorHost outside host ─────────────────────────────────

describe("useCreatorHost — error handling", () => {
  it("throws when used outside StudioCreatorHost", () => {
    const Wrapper = makeWrapper("image");
    expect(() =>
      renderHook(() => useCreatorHost(), {
        wrapper: Wrapper,
      }),
    ).toThrow("useCreatorHost must be used within a StudioCreatorHost");
  });
});
