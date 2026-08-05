import { describe, expect, it } from "vitest";
import { buildChatRedirectUrl } from "@/lib/chat/redirect";

describe("/chat redirect", () => {
  it("preserves conversation and arbitrary query parameters", () => {
    expect(buildChatRedirectUrl({ conversation: "conv_123", agent: "litt", source: "shared" })).toBe(
      "/studio?conversation=conv_123&agent=litt&source=shared&tool=chat",
    );
  });

  it("preserves repeated query values and forces the chat tool", () => {
    expect(buildChatRedirectUrl({ tool: "image", tag: ["one", "two"] })).toBe(
      "/studio?tool=chat&tag=one&tag=two",
    );
    expect(buildChatRedirectUrl({ tool: "image", conversation: "conv_123" })).toBe(
      "/studio?tool=chat&conversation=conv_123",
    );
  });
});
