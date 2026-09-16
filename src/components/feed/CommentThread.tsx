"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { Heart, Reply, Pencil, Trash2, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommentDTO } from "./types";
import { Avatar } from "./Avatar";
import { Toast, useToastState } from "./Toast";
import { formatTimeAgo } from "./formatTimeAgo";

const PAGE_SIZE = 20;

function CommentItem({
  comment,
  postId,
  depth,
  onUpdate,
  onRemove,
  onAuthRequired,
}: {
  comment: CommentDTO;
  postId: string;
  depth: number;
  onUpdate: (id: string, patch: Partial<CommentDTO>) => void;
  onRemove: (id: string) => void;
  onAuthRequired: () => void;
}) {
  const { tokens } = useTheme();
  const { isSignedIn, userId } = useClerkAuth();
  const [toast, showToast] = useToastState();
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.content);
  const [editBusy, setEditBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const isOwner = !!userId && comment.author.id === userId;

  const toggleLike = async () => {
    if (!isSignedIn) {
      onAuthRequired();
      return;
    }
    const liked = !comment.viewerLiked;
    const prev = { likes: comment.likes, viewerLiked: comment.viewerLiked };
    onUpdate(comment.id, { likes: comment.likes + (liked ? 1 : -1), viewerLiked: liked });
    try {
      const res = await fetch(`/api/posts/comments/${comment.id}/like`, {
        method: liked ? "POST" : "DELETE",
      });
      if (res.status === 401) {
        onUpdate(comment.id, prev);
        onAuthRequired();
        return;
      }
      if (!res.ok) throw new Error("like failed");
    } catch {
      onUpdate(comment.id, prev);
      showToast("Couldn't like that comment. Try again.", "error");
    }
  };

  const submitReply = async () => {
    const content = replyText.trim();
    if (!content || replyBusy || !isSignedIn) return;
    setReplyBusy(true);
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, parentId: comment.id }),
      });
      if (!res.ok) throw new Error("reply failed");
      const data = await res.json();
      const nextReplies = [...(comment.replies ?? []), data.comment as CommentDTO];
      onUpdate(comment.id, { replies: nextReplies });
      setReplyText("");
      setReplyOpen(false);
    } catch {
      showToast("Couldn't post your reply. Try again.", "error");
    } finally {
      setReplyBusy(false);
    }
  };

  const saveEdit = async () => {
    const content = editText.trim();
    if (!content || editBusy) return;
    setEditBusy(true);
    try {
      const res = await fetch(`/api/posts/comments/${comment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("edit failed");
      const data = await res.json();
      onUpdate(comment.id, { content: data.comment.content, updatedAt: data.comment.updatedAt });
      setEditing(false);
    } catch {
      showToast("Couldn't save your edit. Try again.", "error");
    } finally {
      setEditBusy(false);
    }
  };

  const doDelete = async () => {
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/posts/comments/${comment.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      onRemove(comment.id);
    } catch {
      showToast("Couldn't delete that comment. Try again.", "error");
      setDeleteBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className={cn("min-w-0", depth > 0 && "ml-8 sm:ml-10 border-l pl-3")} style={depth > 0 ? { borderColor: tokens.border } : undefined}>
      <div className="flex items-start gap-2 min-w-0 py-2">
        <Link href={`/u/${comment.author.username}`} className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <Avatar src={comment.author.avatarUrl} name={comment.author.displayName} size={32} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <Link
              href={`/u/${comment.author.username}`}
              className="text-xs font-bold"
              style={{ color: tokens.text }}
              onClick={(e) => e.stopPropagation()}
            >
              {comment.author.displayName}
            </Link>
            <span className="text-[11px]" style={{ color: tokens.textMuted }}>
              {formatTimeAgo(comment.createdAt)}
            </span>
            {comment.updatedAt !== comment.createdAt && (
              <span className="text-[11px]" style={{ color: tokens.textMuted }}>· edited</span>
            )}
          </div>

          {editing ? (
            <div className="mt-1">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value.slice(0, 2000))}
                rows={2}
                maxLength={2000}
                className="w-full resize-y rounded-lg border p-2 text-sm outline-none"
                style={{ backgroundColor: tokens.background, borderColor: tokens.border, color: tokens.text }}
                aria-label="Edit comment"
              />
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={editBusy || !editText.trim()}
                  className="min-h-[40px] rounded-lg px-3 text-xs font-bold disabled:opacity-40"
                  style={{ backgroundColor: tokens.primary, color: tokens.textInverse }}
                >
                  {editBusy ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={editBusy}
                  className="min-h-[40px] rounded-lg border px-3 text-xs"
                  style={{ borderColor: tokens.border, color: tokens.textMuted }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-0.5 text-sm break-words whitespace-pre-wrap" style={{ color: tokens.text }}>
              {comment.content}
            </p>
          )}

          <div className="mt-1 flex items-center gap-1">
            <button
              type="button"
              onClick={toggleLike}
              aria-pressed={comment.viewerLiked}
              aria-label={comment.viewerLiked ? "Unlike comment" : "Like comment"}
              className="flex min-h-[36px] min-w-[36px] items-center gap-1 rounded-md px-1.5 text-xs"
              style={{ color: comment.viewerLiked ? tokens.danger : tokens.textMuted }}
            >
              <Heart size={14} fill={comment.viewerLiked ? "currentColor" : "none"} />
              {comment.likes > 0 && <span className="tabular-nums">{comment.likes}</span>}
            </button>
            {depth < 2 && (
              <button
                type="button"
                onClick={() => {
                  if (!isSignedIn) {
                    onAuthRequired();
                    return;
                  }
                  setReplyOpen((o) => !o);
                }}
                aria-label="Reply"
                className="flex min-h-[36px] items-center gap-1 rounded-md px-1.5 text-xs"
                style={{ color: tokens.textMuted }}
              >
                <Reply size={14} /> Reply
              </button>
            )}
            {isOwner && !editing && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditText(comment.content);
                    setEditing(true);
                  }}
                  aria-label="Edit comment"
                  className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md px-1.5"
                  style={{ color: tokens.textMuted }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete comment"
                  className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md px-1.5"
                  style={{ color: tokens.textMuted }}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>

          {replyOpen && (
            <div className="mt-1.5">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value.slice(0, 2000))}
                rows={2}
                maxLength={2000}
                placeholder={`Reply to ${comment.author.displayName}…`}
                className="w-full resize-y rounded-lg border p-2 text-sm outline-none"
                style={{ backgroundColor: tokens.background, borderColor: tokens.border, color: tokens.text }}
                aria-label="Write a reply"
              />
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  onClick={submitReply}
                  disabled={replyBusy || !replyText.trim()}
                  className="min-h-[40px] rounded-lg px-3 text-xs font-bold disabled:opacity-40"
                  style={{ backgroundColor: tokens.primary, color: tokens.textInverse }}
                >
                  {replyBusy ? "Posting…" : "Reply"}
                </button>
                <button
                  type="button"
                  onClick={() => setReplyOpen(false)}
                  disabled={replyBusy}
                  className="min-h-[40px] rounded-lg border px-3 text-xs"
                  style={{ borderColor: tokens.border, color: tokens.textMuted }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {confirmDelete && (
            <div
              className="mt-1.5 flex items-center gap-2 rounded-lg border p-2"
              style={{ borderColor: tokens.danger + "60", backgroundColor: tokens.danger + "10" }}
              role="alertdialog"
              aria-label="Delete comment"
            >
              <span className="text-xs" style={{ color: tokens.text }}>
                Delete this comment?
              </span>
              <button
                type="button"
                onClick={doDelete}
                disabled={deleteBusy}
                className="min-h-[36px] rounded-md px-2.5 text-xs font-bold disabled:opacity-40"
                style={{ backgroundColor: tokens.danger, color: "#fff" }}
              >
                {deleteBusy ? "…" : "Delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleteBusy}
                className="min-h-[36px] rounded-md border px-2.5 text-xs"
                style={{ borderColor: tokens.border, color: tokens.textMuted }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {(comment.replies ?? []).map((r) => (
        <CommentItem
          key={r.id}
          comment={r}
          postId={postId}
          depth={depth + 1}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onAuthRequired={onAuthRequired}
        />
      ))}
      <Toast toast={toast} />
    </div>
  );
}

/**
 * Threaded comments for a post. Loads top-level comments with cursor
 * pagination; each comment manages its own replies, likes, edits and deletes.
 */
export function CommentThread({
  postId,
  initialCount,
  expanded = false,
  onCountChange,
  onAuthRequired,
}: {
  postId: string;
  initialCount: number;
  expanded?: boolean;
  onCountChange?: (count: number) => void;
  onAuthRequired?: () => void;
}) {
  const { tokens } = useTheme();
  const { isSignedIn } = useClerkAuth();
  const [toast, showToast] = useToastState();

  const [comments, setComments] = useState<CommentDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(expanded);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const countRef = useRef(initialCount);

  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadedOnce = useRef(false);

  const requireAuth = () => {
    if (onAuthRequired) onAuthRequired();
    else showToast("Sign in to join the conversation.", "info");
  };

  const fetchPage = useCallback(
    async (cur: string | null): Promise<boolean> => {
      const url = new URL(`/api/posts/${postId}/comments`, window.location.origin);
      url.searchParams.set("limit", String(PAGE_SIZE));
      if (cur) url.searchParams.set("cursor", cur);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const page: CommentDTO[] = data.comments ?? [];
      setComments((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...page.filter((c) => !seen.has(c.id))];
      });
      setCursor(data.nextCursor ?? null);
      return !!data.nextCursor;
    },
    [postId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await fetchPage(null);
    } catch {
      setError("Couldn't load comments.");
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    if (expanded && !loadedOnce.current) {
      loadedOnce.current = true;
      load();
    }
  }, [expanded, load]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && cursor && !loadingMore && !loading) {
          setLoadingMore(true);
          fetchPage(cursor)
            .catch(() => showToast("Couldn't load more comments.", "error"))
            .finally(() => setLoadingMore(false));
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, loadingMore, loading, fetchPage]);

  // Recursively patch or remove a comment by id (top-level or nested).
  const patchComment = useCallback((id: string, patch: Partial<CommentDTO>) => {
    const walk = (list: CommentDTO[]): CommentDTO[] =>
      list.map((c) =>
        c.id === id
          ? { ...c, ...patch }
          : { ...c, replies: walk(c.replies ?? []) },
      );
    setComments((prev) => walk(prev));
  }, []);

  const removeComment = useCallback((id: string) => {
    const walk = (list: CommentDTO[]): CommentDTO[] =>
      list
        .filter((c) => c.id !== id)
        .map((c) => ({ ...c, replies: walk(c.replies ?? []) }));
    setComments((prev) => walk(prev));
    const nextCount = Math.max(0, countRef.current - 1);
    countRef.current = nextCount;
    onCountChange?.(nextCount);
  }, [onCountChange]);

  const submitComment = async () => {
    const content = draft.trim();
    if (!content || posting) return;
    if (!isSignedIn) {
      requireAuth();
      return;
    }
    setPosting(true);
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.status === 401) {
        requireAuth();
        return;
      }
      if (!res.ok) throw new Error("comment failed");
      const data = await res.json();
      setComments((prev) => [data.comment as CommentDTO, ...prev]);
      setDraft("");
      const nextCount = countRef.current + 1;
      countRef.current = nextCount;
      onCountChange?.(nextCount);
    } catch {
      showToast("Couldn't post your comment. Try again.", "error");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="mt-2 border-t pt-2 min-w-0" style={{ borderColor: tokens.border }}>
      {/* New-comment box */}
      {isSignedIn ? (
        <div className="flex items-start gap-2 min-w-0">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 2000))}
            rows={1}
            maxLength={2000}
            placeholder="Write a comment…"
            className="min-h-[44px] w-full min-w-0 resize-y rounded-xl border p-2.5 text-sm outline-none"
            style={{ backgroundColor: tokens.background, borderColor: tokens.border, color: tokens.text }}
            aria-label="Write a comment"
          />
          <button
            type="button"
            onClick={submitComment}
            disabled={posting || !draft.trim()}
            className="min-h-[44px] shrink-0 rounded-xl px-4 text-sm font-bold disabled:opacity-40"
            style={{ backgroundColor: tokens.primary, color: tokens.textInverse }}
          >
            {posting ? <Loader2 size={16} className="animate-spin" /> : "Post"}
          </button>
        </div>
      ) : (
        <Link
          href="/sign-in"
          className="flex min-h-[44px] items-center justify-center rounded-xl border text-sm"
          style={{ borderColor: tokens.border, color: tokens.textMuted }}
        >
          Sign in to join the conversation
        </Link>
      )}

      {loading && (
        <div className="space-y-2 py-3" aria-label="Loading comments">
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-2">
              <div className="h-8 w-8 rounded-full animate-pulse" style={{ backgroundColor: tokens.border }} />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-1/3 rounded animate-pulse" style={{ backgroundColor: tokens.border }} />
                <div className="h-3 w-full rounded animate-pulse" style={{ backgroundColor: tokens.border }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="py-3 text-center">
          <div className="text-sm" style={{ color: tokens.danger }}>
            {error}
          </div>
          <button
            type="button"
            onClick={load}
            className="mt-2 min-h-[44px] rounded-lg border px-4 text-sm"
            style={{ borderColor: tokens.border, color: tokens.text }}
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && comments.length === 0 && (
        <div className="py-3 text-center text-sm" style={{ color: tokens.textMuted }}>
          No comments yet — be the first.
        </div>
      )}

      <div className="min-w-0">
        {comments.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            postId={postId}
            depth={0}
            onUpdate={patchComment}
            onRemove={removeComment}
            onAuthRequired={requireAuth}
          />
        ))}
      </div>

      <div ref={sentinelRef} />
      {loadingMore && (
        <div className="flex justify-center py-2" style={{ color: tokens.textMuted }}>
          <Loader2 size={18} className="animate-spin" />
        </div>
      )}
      {cursor && typeof IntersectionObserver === "undefined" && (
        <button
          type="button"
          onClick={() => {
            setLoadingMore(true);
            fetchPage(cursor)
              .catch(() => showToast("Couldn't load more comments.", "error"))
              .finally(() => setLoadingMore(false));
          }}
          disabled={loadingMore}
          className="mx-auto mt-2 flex min-h-[44px] items-center gap-1 rounded-lg border px-4 text-sm disabled:opacity-40"
          style={{ borderColor: tokens.border, color: tokens.text }}
        >
          <ChevronDown size={16} /> Load more comments
        </button>
      )}

      <Toast toast={toast} />
    </div>
  );
}
