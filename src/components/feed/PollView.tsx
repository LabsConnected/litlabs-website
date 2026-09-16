"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { BarChart3, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PollDTO } from "./types";
import { formatCountdown } from "./formatTimeAgo";

/**
 * Poll with animated percentage bars and optimistic vote flow.
 * POST /api/posts/[id]/poll/vote {optionId} → 200 {poll} / 409 already-voted / 410 closed.
 */
export function PollView({
  postId,
  poll: initialPoll,
  onPollUpdate,
}: {
  postId: string;
  poll: PollDTO;
  onPollUpdate?: (poll: PollDTO) => void;
}) {
  const { tokens } = useTheme();
  const { isSignedIn } = useClerkAuth();
  const [poll, setPoll] = useState<PollDTO>(initialPoll);
  const [voting, setVoting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const closed = poll.endsAt ? new Date(poll.endsAt).getTime() <= Date.now() : false;
  const showResults = closed || poll.viewerVotedOptionId !== null || poll.totalVotes > 0;

  const vote = async (optionId: string) => {
    if (voting || closed) return;
    if (!isSignedIn) {
      setNotice("Sign in to vote in polls.");
      return;
    }
    setVoting(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/posts/${postId}/poll/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId }),
      });
      if (res.status === 409) {
        setNotice("You've already voted in this poll.");
        // Refresh the authoritative poll state without clearing the vote.
        try {
          const ref = await fetch(`/api/posts/${postId}`);
          if (ref.ok) {
            const data = await ref.json();
            if (data?.post?.poll) {
              setPoll(data.post.poll);
              onPollUpdate?.(data.post.poll);
            }
          }
        } catch {
          /* keep local state */
        }
        return;
      }
      if (res.status === 410) {
        setNotice("This poll is closed.");
        return;
      }
      if (!res.ok) throw new Error("vote failed");
      const data = await res.json();
      const next = data.poll as PollDTO;
      setPoll(next);
      onPollUpdate?.(next);
    } catch {
      setNotice("Couldn't record your vote. Try again.");
    } finally {
      setVoting(false);
    }
  };

  return (
    <div
      className="mt-2 rounded-xl border p-3"
      style={{ borderColor: tokens.border, backgroundColor: tokens.background }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: tokens.textMuted }}>
        <BarChart3 size={14} style={{ color: tokens.primary }} />
        <span className="break-words text-sm font-semibold" style={{ color: tokens.text }}>
          {poll.question}
        </span>
      </div>

      <div className="mt-2 space-y-1.5">
        {poll.options.map((opt) => {
          const pct = poll.totalVotes > 0 ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;
          const voted = poll.viewerVotedOptionId === opt.id;
          const clickable = !showResults && !closed && !voting;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={!clickable}
              onClick={() => vote(opt.id)}
              className={cn(
                "relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-sm min-h-[44px]",
                clickable && "hover:opacity-90",
              )}
              style={{
                borderColor: voted ? tokens.primary : tokens.border,
                color: tokens.text,
                backgroundColor: tokens.surface,
                cursor: clickable ? "pointer" : "default",
              }}
              aria-label={clickable ? `Vote for ${opt.text}` : `${opt.text}, ${pct}%`}
            >
              {showResults && (
                <span
                  className="absolute inset-y-0 left-0 transition-[width] duration-500"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: voted ? tokens.primary + "55" : tokens.primary + "22",
                  }}
                />
              )}
              <span className="relative flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 break-words min-w-0">
                  {voted && <Check size={14} style={{ color: tokens.primary }} className="shrink-0" />}
                  <span className="break-words">{opt.text}</span>
                </span>
                {showResults && (
                  <span className="text-xs font-semibold shrink-0" style={{ color: tokens.textMuted }}>
                    {pct}%
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs" style={{ color: tokens.textMuted }}>
        <span>
          {poll.totalVotes} {poll.totalVotes === 1 ? "vote" : "votes"}
        </span>
        {poll.endsAt && (
          <span>{closed ? "Poll ended" : formatCountdown(poll.endsAt)}</span>
        )}
      </div>
      {notice && (
        <div className="mt-1.5 text-xs" style={{ color: tokens.warning }}>
          {notice}
        </div>
      )}
    </div>
  );
}
