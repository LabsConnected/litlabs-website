import { describe, it, expect } from "vitest";
import { dedupeTasksByConversation } from "./task-types";

describe("dedupeTasksByConversation", () => {
  it("keeps one worktab per conversation — the most recent", () => {
    const tasks = [
      { id: "t3", conversationId: "c1", title: "Current work" },
      { id: "t2", conversationId: "c1", title: "Current work" },
      { id: "t1", conversationId: "c1", title: "Current work" },
      { id: "t4", conversationId: "c2", title: "Other" },
      { id: "t5", conversationId: null, title: "Loose" },
      { id: "t6", conversationId: null, title: "Loose 2" },
    ];
    expect(dedupeTasksByConversation(tasks).map((t) => t.id)).toEqual(["t3", "t4", "t5", "t6"]);
  });
});
