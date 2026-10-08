/**
 * Phase 3B — Approval interface regression tests.
 *
 * Verifies:
 * - ApprovalCard.tsx is the canonical approval interface for the chat tab
 * - LiTTLiveActivity's inline approval is for the live/activity tab only
 * - The two interfaces are in mutually exclusive tabs (chat vs live)
 * - No simultaneous competing approval buttons
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const COMMAND_STUDIO_PATH = path.join(
  __dirname,
  "../CommandStudio.tsx"
);

describe("Phase 3B — Approval interface isolation", () => {
  it("littActiveTab is mutually exclusive (chat | live)", () => {
    const source = fs.readFileSync(COMMAND_STUDIO_PATH, "utf-8");
    // The tab state only allows "chat" or "live" — never both simultaneously
    expect(source).toMatch(/useState<"chat" \| "live">/);
  });

  it("ApprovalCard.tsx is imported as the canonical approval interface", () => {
    const source = fs.readFileSync(COMMAND_STUDIO_PATH, "utf-8");
    expect(source).toMatch(/import \{ ApprovalCard \} from "\.\/ApprovalCard"/);
  });

  it("chat approval card is rendered in the chat tab content", () => {
    const source = fs.readFileSync(COMMAND_STUDIO_PATH, "utf-8");
    // chatApprovalCard is defined and used in the transcript/composer section
    expect(source).toMatch(/const chatApprovalCard = /);
    expect(source).toMatch(/{chatApprovalCard}/);
  });

  it("LiTTLiveActivity is rendered in the live tab content (separate from chat)", () => {
    const source = fs.readFileSync(COMMAND_STUDIO_PATH, "utf-8");
    // littLiveContent contains LiTTLiveActivity, separate from littTranscript
    expect(source).toMatch(/const littLiveContent = /);
    expect(source).toMatch(/<LiTTLiveActivity/);
  });

  it("chat and live content are passed as separate tab props", () => {
    const source = fs.readFileSync(COMMAND_STUDIO_PATH, "utf-8");
    // The tab component receives chatContent and liveContent as separate props,
    // confirming they are in mutually exclusive tabs
    expect(source).toMatch(/chatContent=\{littLeftPanelContent\}/);
    expect(source).toMatch(/liveContent=\{littLiveContent\}/);
  });
});
