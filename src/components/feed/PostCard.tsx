"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  MessageCircle,
  Repeat2,
  Bookmark,
  Share2,
  MoreHorizontal,
  Globe,
  Users,
  Lock,
  FolderGit2,
  Music2,
  Pencil,
  Trash2,
  Link2,
  Flag,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PostDTO, Visibility } from "./types";
import { Avatar } from "./Avatar";
import { ReactionBar, formatCount } from "./ReactionBar";
import { PollView } from "./PollView";
import { LinkCard } from "./LinkCard";
import { CommentThread } from "./CommentThread";
import { Toast, useToastState } from "./Toast";
import { formatTimeAgo } from "./formatTimeAgo";

const VISIBILITY_ICON: Record<Visibility, typeof Globe> = {
  public: Globe,
  followers: Users,
  crew: Users,
  private: Lock,
};

const VISIBILITY_LABEL: Record<Visibility, string> = {
  public: "Public",
  followers: "Followers only",
  crew: "Crew only",
  private: "Only me",
};

/** Render plain text with URLs linkified. No HTML is ever injected. */
export function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
            style={{ color: "inherit" }}
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function MediaGrid({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  const shown = urls.slice(0, 4);
  const isVideo = (u: string) => /^data:video|\.(mp4|webm|mov)(\?|#|$)/i.test(u);
  return (
    <div
      className={cn(
        "mt-2 grid gap-1.5 overflow-hidden rounded-xl min-w-0",
        shown.length === 1 ? "grid-cols-1" : "grid-cols-2",
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {shown.map((url, i) => (
        <div key={i} className="relative min-h-[120px] min-w-0 overflow-hidden rounded-lg bg-black/20">
          {isVideo(url) ? (
            <video
              src={url}
              controls
              preload="metadata"
              playsInline
              className="max-h-[420px] w-full object-contain"
            />
          ) : (
            // Plain <img>: media hosts are arbitrary and may be data URLs,
            // which next/image cannot optimize.
            <img
              src={url}
              alt=""
              loading="lazy"
              className="max-h-[420px] w-full object-cover"
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ActionButton({
  onClick,
  label,
  active,
  activeColor,
  count,
  children,
}: {
  onClick: (e: React.MouseEvent) => void;
  label: string;
  active?: boolean;
  activeColor?: string;
  count?: number;
  children: React.ReactNode;
}) {
  const { tokens } = useTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg px-2 transition-opacity hover:opacity-80"
      style={{ color: active ? activeColor : tokens.textMuted }}
    >
      {children}
      {typeof count === "number" && count > 0 && (
        <span className="text-xs font-semibold tabular-nums">{formatCount(count)}</span>
      )}
    </button>
  );
}

/**
 * A single feed post. All mutations are optimistic with rollback;
 * nothing claims persistence before the response confirms it.
 */
export function PostCard({
  post,
  onUpdate,
  onDelete,
  onAuthRequired,
  compact = false,
}: {
  post: PostDTO;
  onUpdate: (post: PostDTO) => void;
  onDelete: (id: string) => void;
  onAuthRequired?: () => void;
  compact?: boolean;
}) {
  const { tokens } = useTheme();
  const router = useRouter();
  const { isSignedIn, userId } = useClerkAuth();
  const [toast, showToast] = useToastState();

  const [menuOpen, setMenuOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.content);
  const [editBusy, setEditBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const requireAuth = () => {
    if (onAuthRequired) onAuthRequired();
    else showToast("Sign in to do that.", "info");
  };

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const isOwner = !!userId && post.author.id === userId;
  const VisIcon = VISIBILITY_ICON[post.visibility];

  const openPost = () => router.push(`/post/${post.id}`);

  const guardClick = (e: React.SyntheticEvent) => {
    // Post-body click navigates; interactive descendants stop propagation themselves.
    const t = e.target as HTMLElement;
    if (t.closest("a,button,video,input,textarea,select,[role='dialog']")) return;
    openPost();
  };

  const share = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isSignedIn) {
      requireAuth();
      return;
    }
    const url = `${window.location.origin}/post/${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Post by ${post.author.displayName}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        showToast("Link copied to clipboard.", "success");
      }
    } catch {
      // User dismissed the share sheet — not an error.
      if (!navigator.share) showToast("Couldn't copy the link.", "error");
      return;
    }
    // Record the share server-side (best-effort; never blocks the UI).
    try {
      const res = await fetch(`/api/posts/${post.id}/share`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.shares === "number") {
          onUpdate({ ...post, counts: { ...post.counts, shares: data.shares } });
        }
      }
    } catch {
      /* share still happened; count update is best-effort */
    }
  };

  const toggleRepost = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isSignedIn) {
      requireAuth();
      return;
    }
    const prev = post;
    const next: PostDTO = {
      ...post,
      viewer: { ...post.viewer, reposted: !post.viewer.reposted },
      counts: { ...post.counts, reposts: post.counts.reposts + (post.viewer.reposted ? -1 : 1) },
    };
    onUpdate(next);
    try {
      const res = await fetch(`/api/posts/${post.id}/repost`, {
        method: post.viewer.reposted ? "DELETE" : "POST",
      });
      if (res.status === 401) {
        onUpdate(prev);
        requireAuth();
        return;
      }
      if (res.status === 409) {
        // Already reposted server-side: adopt server state.
        showToast("You've already reposted this.", "info");
        return;
      }
      if (!res.ok) throw new Error("repost failed");
      const data = await res.json();
      if (typeof data?.reposts === "number") {
        onUpdate({ ...next, counts: { ...next.counts, reposts: data.reposts } });
      }
    } catch {
      onUpdate(prev);
      showToast("Repost failed. Try again.", "error");
    }
  };

  const toggleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isSignedIn) {
      requireAuth();
      return;
    }
    const prev = post;
    const next: PostDTO = {
      ...post,
      viewer: { ...post.viewer, saved: !post.viewer.saved },
      counts: { ...post.counts, saves: post.counts.saves + (post.viewer.saved ? -1 : 1) },
    };
    onUpdate(next);
    try {
      const res = await fetch(`/api/posts/${post.id}/save`, {
        method: post.viewer.saved ? "DELETE" : "POST",
      });
      if (res.status === 401) {
        onUpdate(prev);
        requireAuth();
        return;
      }
      if (!res.ok) throw new Error("save failed");
    } catch {
      onUpdate(prev);
      showToast("Couldn't save this post. Try again.", "error");
    }
  };

  const copyLink = async () => {
    setMenuOpen(false);
    const url = `${window.location.origin}/post/${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied to clipboard.", "success");
    } catch {
      showToast("Couldn't copy the link.", "error");
    }
  };

  const saveEdit = async () => {
    const trimmed = editText.trim();
    if (!trimmed || editBusy) return;
    setEditBusy(true);
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (!res.ok) throw new Error("edit failed");
      const data = await res.json();
      onUpdate(data.post as PostDTO);
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
      const res = await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      onDelete(post.id);
    } catch {
      showToast("Couldn't delete this post. Try again.", "error");
      setDeleteBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <article
      className={cn(
        "border-b min-w-0",
        compact ? "px-3 py-3" : "px-3 py-3 sm:px-4 sm:py-4",
      )}
      style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
      aria-label={`Post by ${post.author.displayName}`}
    >
      {/* Header */}
      <div className="flex items-start gap-2.5 min-w-0">
        <Link href={`/u/${post.author.username}`} className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <Avatar src={post.author.avatarUrl} name={post.author.displayName} size={44} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <Link
              href={`/u/${post.author.username}`}
              className="truncate text-sm font-bold"
              style={{ color: tokens.text }}
              onClick={(e) => e.stopPropagation()}
            >
              {post.author.displayName}
            </Link>
            <span className="truncate text-xs" style={{ color: tokens.textMuted }}>
              @{post.author.username}
            </span>
            <span className="shrink-0 text-xs" style={{ color: tokens.textMuted }}>
              · {formatTimeAgo(post.createdAt)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: tokens.textMuted }}>
            <VisIcon size={12} />
            <span title={VISIBILITY_LABEL[post.visibility]}>{VISIBILITY_LABEL[post.visibility]}</span>
            {post.updatedAt !== post.createdAt && <span title="Edited">· edited</span>}
          </div>
        </div>

        {/* Overflow menu */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            aria-label="More options"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition-opacity hover:opacity-80"
            style={{ color: tokens.textMuted }}
          >
            <MoreHorizontal size={20} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-11 z-50 w-48 overflow-hidden rounded-xl border shadow-xl"
              style={{ backgroundColor: tokens.surfaceElevated, borderColor: tokens.border }}
            >
              <MenuItem icon={<Link2 size={16} />} label="Copy link" onClick={copyLink} tokens={tokens} />
              {isOwner ? (
                <>
                  <MenuItem
                    icon={<Pencil size={16} />}
                    label="Edit"
                    onClick={() => {
                      setMenuOpen(false);
                      setEditText(post.content);
                      setEditing(true);
                    }}
                    tokens={tokens}
                  />
                  <MenuItem
                    icon={<Trash2 size={16} />}
                    label="Delete"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDelete(true);
                    }}
                    tokens={tokens}
                    danger
                  />
                </>
              ) : (
                <MenuItem
                  icon={<Flag size={16} />}
                  label="Report"
                  onClick={() => {
                    setMenuOpen(false);
                    showToast("Reports arrive in Phase 4.", "info");
                  }}
                  tokens={tokens}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body — clicking navigates to the dedicated post route */}
      <div className="mt-2 cursor-pointer min-w-0" onClick={guardClick} role="button" aria-label="Open post" tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") openPost();
        }}
      >
        {editing ? (
          <div onClick={(e) => e.stopPropagation()}>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value.slice(0, 5000))}
              rows={4}
              maxLength={5000}
              className="w-full resize-y rounded-xl border p-3 text-sm outline-none"
              style={{
                backgroundColor: tokens.background,
                borderColor: tokens.border,
                color: tokens.text,
              }}
              aria-label="Edit post"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={saveEdit}
                disabled={editBusy || !editText.trim()}
                className="min-h-[44px] rounded-lg px-4 text-sm font-bold disabled:opacity-40"
                style={{ backgroundColor: tokens.primary, color: tokens.textInverse }}
              >
                {editBusy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={editBusy}
                className="flex min-h-[44px] items-center gap-1 rounded-lg border px-4 text-sm"
                style={{ borderColor: tokens.border, color: tokens.textMuted }}
              >
                <X size={14} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          post.content && (
            <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap" style={{ color: tokens.text }}>
              <LinkifiedText text={post.content} />
            </p>
          )
        )}

        {!editing && (
          <>
            <MediaGrid urls={post.mediaUrls} />
            {post.link && (
              <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                <LinkCard link={post.link} />
              </div>
            )}
            {post.poll && (
              <PollView
                postId={post.id}
                poll={post.poll}
                onPollUpdate={(poll) => onUpdate({ ...post, poll })}
              />
            )}
            {post.projectRef && (
              <div
                className="mt-2 flex items-center gap-2.5 rounded-xl border p-3 min-w-0"
                style={{ borderColor: tokens.border, backgroundColor: tokens.background }}
                onClick={(e) => e.stopPropagation()}
              >
                <FolderGit2 size={20} style={{ color: tokens.primary }} className="shrink-0" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold" style={{ color: tokens.text }}>
                    {post.projectRef.name}
                  </div>
                  <div className="text-xs" style={{ color: tokens.textMuted }}>
                    Project update
                  </div>
                </div>
              </div>
            )}
            {post.music && (
              <div
                className="mt-2 flex items-center gap-2.5 rounded-xl border p-3 min-w-0"
                style={{ borderColor: tokens.border, backgroundColor: tokens.background }}
                onClick={(e) => e.stopPropagation()}
              >
                <Music2 size={20} style={{ color: tokens.primary }} className="shrink-0" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold" style={{ color: tokens.text }}>
                    {post.music.title}
                  </div>
                  {post.music.artist && (
                    <div className="truncate text-xs" style={{ color: tokens.textMuted }}>
                      {post.music.artist}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Action bar */}
      <div
        className="mt-1 flex items-center justify-between min-w-0"
        onClick={(e) => e.stopPropagation()}
      >
        <ReactionBar post={post} onUpdate={onUpdate} onAuthRequired={requireAuth} />
        <ActionButton
          onClick={(e) => {
            e.stopPropagation();
            if (!isSignedIn) {
              requireAuth();
              return;
            }
            setCommentsOpen((o) => !o);
          }}
          label={commentsOpen ? "Hide comments" : "Show comments"}
          count={post.counts.comments}
        >
          <MessageCircle size={20} />
        </ActionButton>
        <ActionButton
          onClick={toggleRepost}
          label={post.viewer.reposted ? "Undo repost" : "Repost"}
          active={post.viewer.reposted}
          activeColor={tokens.success}
          count={post.counts.reposts}
        >
          <Repeat2 size={20} />
        </ActionButton>
        <ActionButton
          onClick={toggleSave}
          label={post.viewer.saved ? "Unsave" : "Save"}
          active={post.viewer.saved}
          activeColor={tokens.primary}
          count={post.counts.saves}
        >
          <Bookmark size={20} fill={post.viewer.saved ? "currentColor" : "none"} />
        </ActionButton>
        <ActionButton onClick={share} label="Share" count={post.counts.shares}>
          <Share2 size={20} />
        </ActionButton>
      </div>

      {commentsOpen && (
        <div onClick={(e) => e.stopPropagation()} className="min-w-0">
          <CommentThread
            postId={post.id}
            initialCount={post.counts.comments}
            expanded
            onCountChange={(n) => onUpdate({ ...post, counts: { ...post.counts, comments: n } })}
          />
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
          role="alertdialog"
          aria-label="Delete post"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="w-full max-w-sm rounded-2xl border p-5"
            style={{ backgroundColor: tokens.surfaceElevated, borderColor: tokens.border }}
          >
            <div className="text-base font-bold" style={{ color: tokens.text }}>
              Delete this post?
            </div>
            <div className="mt-1 text-sm" style={{ color: tokens.textMuted }}>
              This can&rsquo;t be undone.
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleteBusy}
                className="min-h-[44px] flex-1 rounded-lg border text-sm font-semibold"
                style={{ borderColor: tokens.border, color: tokens.text }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doDelete}
                disabled={deleteBusy}
                className="min-h-[44px] flex-1 rounded-lg text-sm font-bold disabled:opacity-40"
                style={{ backgroundColor: tokens.danger, color: "#fff" }}
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </article>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  tokens,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tokens: { text: string; textMuted: string; danger: string; border: string };
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex min-h-[44px] w-full items-center gap-2.5 px-4 text-sm font-medium"
      style={{ color: danger ? tokens.danger : tokens.text }}
    >
      {icon}
      {label}
    </button>
  );
}
