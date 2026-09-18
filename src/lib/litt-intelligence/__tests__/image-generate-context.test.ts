import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateMediaForUser } = vi.hoisted(() => ({ generateMediaForUser: vi.fn() }));
vi.mock("@/lib/media/image-generation-service", () => ({ generateMediaForUser }));

import { handleImageGenerate } from "@/lib/litt-intelligence/tool-handlers";

describe("image.generate execution context", () => {
  beforeEach(() => generateMediaForUser.mockReset());
  it("uses trusted transport identity and ignores input userId", async () => {
    generateMediaForUser.mockResolvedValue(new Response(JSON.stringify({ success: true, downloadUrl: "https://cdn/image.png" }), { status: 200 }));
    const transport = { userId: "trusted-user", projectId: "project-1" };

    await handleImageGenerate({ prompt: "a lighthouse", userId: "attacker", projectId: "project-1" }, transport);

    expect(generateMediaForUser).toHaveBeenCalledWith("trusted-user", expect.objectContaining({ prompt: "a lighthouse" }));
    expect(generateMediaForUser.mock.calls[0][1]).not.toHaveProperty("userId");
  });

  it("rejects a project outside the authenticated transport context", async () => {
    const result = await handleImageGenerate({ prompt: "a lighthouse", projectId: "other-project" }, { userId: "trusted-user", projectId: "project-1" });
    expect(result).toEqual({ success: false, error: "Project is not owned by the authenticated workspace" });
    expect(generateMediaForUser).not.toHaveBeenCalled();
  });
});
