"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  Type,
  ImageIcon,
  Clapperboard,
  Link2,
  FolderGit2,
  Music2,
  BarChart3,
  X,
  Loader2,
  Globe,
  Users,
  Lock,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  PostDTO,
  PostType,
  Visibility,
  LinkDTO,
  StudioProjectSummary,
} from "./types";
import { MAX_CONTENT_LENGTH, MAX_MEDIA_FILES } from "./types";
import { LinkCard } from "./LinkCard";
import { Toast, useToastState } from "./Toast";

type ComposerType = "text" | "image" | "video" | "link" | "project" | "music" | "poll";

const TYPE_BUTTONS: { id: ComposerType; label: string; icon: typeof Type }[] = [
  { id: "text", label: "Text", icon: Type },
  { id: "image", label: "Image", icon: ImageIcon },
  { id: "video", label: "Video", icon: Clapperboard },
  { id: "link", label: "Link", icon: Link2 },
  { id: "project", label: "Project", icon: FolderGit2 },
  { id: "music", label: "Music", icon: Music2 },
  { id: "poll", label: "Poll", icon: BarChart3 },
];

const VISIBILITY_OPTIONS: {
  id: Visibility;
  label: string;
  helper: string;
  icon: typeof Globe;
}[] = [
  { id: "public", label: "Public", helper: "Everyone can see it", icon: Globe },
  { id: "followers", label: "Followers", helper: "Only your followers", icon: Users },
  { id: "crew", label: "Crew", helper: "Only your crew", icon: Users },
  { id: "private", label: "Private", helper: "Only you", icon: Lock },
];

const POLL_DURATIONS = [
  { label: "1 hour", ms: 3_600_000 },
  { label: "1 day", ms: 86_400_000 },
  { label: "3 days", ms: 259_200_000 },
  { label: "7 days", ms: 604_800_000 },
];

interface PendingFile {
  id: string;
  file: File;
  previewUrl: string;
  uploadedUrl: string | null;
  error: string | null;
}

/**
 * Working post composer. Draft is only cleared after the server confirms
 * the post (response.ok); failures keep the draft and surface a retry.
 */
export function Composer({
  onPosted,
  compact = false,
}: {
  onPosted: (post: PostDTO) => void;
  compact?: boolean;
}) {
  const { tokens } = useTheme();
  const { isSignedIn, isLoaded } = useClerkAuth();
  const [toast, showToast] = useToastState();

  const [content, setContent] = useState("");
  const [kind, setKind] = useState<ComposerType>("text");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [visibilityOpen, setVisibilityOpen] = useState(false);

  const [files, setFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const visRef = useRef<HTMLDivElement>(null);

  const [linkUrl, setLinkUrl] = useState("");
  const [linkPreview, setLinkPreview] = useState<LinkDTO | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkTitle, setLinkTitle] = useState("");

  const [projects, setProjects] = useState<StudioProjectSummary[] | null>(null);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [projectName, setProjectName] = useState("");

  const [musicTitle, setMusicTitle] = useState("");
  const [musicArtist, setMusicArtist] = useState("");
  const [musicUrl, setMusicUrl] = useState("");

  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollDuration, setPollDuration] = useState(POLL_DURATIONS[1].ms);

  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [content]);

  // Close visibility dropdown on outside click.
  useEffect(() => {
    if (!visibilityOpen) return;
    const close = (e: MouseEvent) => {
      if (visRef.current && !visRef.current.contains(e.target as Node)) {
        setVisibilityOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [visibilityOpen]);

  // Load the user's projects lazily when the project type is picked.
  useEffect(() => {
    if (kind !== "project" || projects !== null) return;
    (async () => {
      try {
        const res = await fetch("/api/studio-projects");
        if (!res.ok) {
          setProjects([]);
          return;
        }
        const data = await res.json();
        const list = [...(data.projects ?? []), ...(data.legacyOnly ?? [])];
        setProjects(
          list
            .filter((p: { id?: string; name?: string }) => p?.id && p?.name)
            .map((p: { id: string; name: string; slug?: string }) => ({
              id: p.id,
              name: p.name,
              slug: p.slug,
            })),
        );
      } catch {
        setProjects([]);
      }
    })();
  }, [kind, projects]);

  // Only plain text posts can go out with just a body; every other type
  // (including polls) must have its attachment fields filled in.
  const requiresAttachment = kind !== "text";

  const hasAttachment = (): boolean => {
    switch (kind) {
      case "image":
      case "video":
        return files.some((f) => f.uploadedUrl);
      case "link":
        return linkPreview !== null;
      case "project":
        return projectName.trim().length > 0 || selectedProject.length > 0;
      case "music":
        return musicTitle.trim().length > 0;
      case "poll":
        return (
          pollQuestion.trim().length > 0 &&
          pollOptions.filter((o) => o.trim().length > 0).length >= 2
        );
      default:
        return true;
    }
  };

  const isValid = content.trim().length > 0 && (!requiresAttachment || hasAttachment());

  const handleFiles = (list: FileList | null, mediaKind: "image" | "video") => {
    if (!list) return;
    const accept = mediaKind === "image" ? "image/" : "video/";
    const incoming = Array.from(list)
      .filter((f) => f.type.startsWith(accept))
      .slice(0, MAX_MEDIA_FILES - files.length);
    if (incoming.length === 0) {
      showToast(mediaKind === "image" ? "Pick image files (JPG, PNG, WebP, GIF)." : "Pick video files (MP4, WebM).", "error");
      return;
    }
    setFiles((prev) => [
      ...prev,
      ...incoming.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        uploadedUrl: null,
        error: null as string | null,
      })),
    ]);
  };

  const uploadPending = async (): Promise<boolean> => {
    const pending = files.filter((f) => !f.uploadedUrl && !f.error);
    if (pending.length === 0) return true;
    setUploading(true);
    let allOk = true;
    for (const pf of pending) {
      try {
        const form = new FormData();
        form.append("file", pf.file); // upload route reads the "file" field
        form.append("purpose", "post-media");
        const res = await fetch("/api/upload", { method: "POST", body: form });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || `Upload failed (${res.status})`);
        }
        const data = await res.json();
        if (!data?.url) throw new Error("Upload returned no URL");
        setFiles((prev) => prev.map((f) => (f.id === pf.id ? { ...f, uploadedUrl: data.url as string } : f)));
      } catch (e) {
        allOk = false;
        const msg = e instanceof Error ? e.message : "Upload failed";
        setFiles((prev) => prev.map((f) => (f.id === pf.id ? { ...f, error: msg } : f)));
      }
    }
    setUploading(false);
    return allOk;
  };

  const retryUpload = (id: string) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, error: null } : f)));
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  const fetchLinkPreview = async () => {
    const url = linkUrl.trim();
    if (!url) return;
    setLinkLoading(true);
    setLinkPreview(null);
    try {
      const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error("preview failed");
      const data = await res.json();
      setLinkPreview(data as LinkDTO);
      setLinkTitle(data?.title ?? "");
    } catch {
      showToast("Couldn't fetch a preview for that link.", "error");
    } finally {
      setLinkLoading(false);
    }
  };

  const buildPayload = (): Record<string, unknown> | null => {
    const postType: PostType = kind === "image" || kind === "video" ? kind : kind === "text" ? "text" : kind;
    const payload: Record<string, unknown> = {
      content: content.trim(),
      postType,
      visibility,
    };
    if (kind === "image" || kind === "video") {
      payload.mediaUrls = files.filter((f) => f.uploadedUrl).map((f) => f.uploadedUrl);
    }
    if (kind === "link" && linkPreview) {
      payload.link = {
        url: linkPreview.url,
        title: linkTitle.trim() || linkPreview.title,
        description: linkPreview.description,
        imageUrl: linkPreview.imageUrl,
      };
    }
    if (kind === "project") {
      const chosen = projects?.find((p) => p.id === selectedProject);
      payload.projectRef = {
        projectId: chosen?.id ?? null,
        name: (projectName.trim() || chosen?.name || "").trim(),
        url: null,
      };
    }
    if (kind === "music") {
      payload.music = {
        title: musicTitle.trim(),
        artist: musicArtist.trim() || null,
        url: musicUrl.trim() || null,
      };
    }
    if (kind === "poll") {
      payload.poll = {
        question: pollQuestion.trim(),
        options: pollOptions.filter((o) => o.trim().length > 0).map((o) => o.trim()),
        endsAt: new Date(Date.now() + pollDuration).toISOString(),
      };
    }
    return payload;
  };

  const resetForm = () => {
    setContent("");
    setFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.previewUrl));
      return [];
    });
    setLinkUrl("");
    setLinkPreview(null);
    setLinkTitle("");
    setSelectedProject("");
    setProjectName("");
    setMusicTitle("");
    setMusicArtist("");
    setMusicUrl("");
    setPollQuestion("");
    setPollOptions(["", ""]);
    setError(null);
  };

  const submit = async () => {
    if (!isValid || posting || uploading) return;
    setError(null);
    setPosting(true);
    try {
      // Upload media first; the draft stays until the post is confirmed.
      if (kind === "image" || kind === "video") {
        const ok = await uploadPending();
        if (!ok) {
          setError("Some files failed to upload. Retry them or remove them, then post again.");
          return;
        }
      }
      const payload = buildPayload();
      if (!payload) {
        setError("This post is missing its attachment.");
        return;
      }
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        setError("You were signed out. Sign in and try again.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Post failed (${res.status})`);
      }
      const data = await res.json();
      if (!data?.post) throw new Error("Server returned no post");
      onPosted(data.post as PostDTO);
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't publish. Your draft is kept — try again.");
    } finally {
      setPosting(false);
    }
  };

  if (isLoaded && !isSignedIn) {
    return (
      <div
        className="border-b p-4 text-center"
        style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
      >
        <div className="text-sm font-semibold" style={{ color: tokens.text }}>
          Join the conversation
        </div>
        <div className="mt-1 text-xs" style={{ color: tokens.textMuted }}>
          Sign in to post, react and comment.
        </div>
        <Link
          href="/sign-in"
          className="mt-3 inline-flex min-h-[44px] items-center rounded-xl px-6 text-sm font-bold"
          style={{ backgroundColor: tokens.primary, color: tokens.textInverse }}
        >
          Sign in
        </Link>
        <Toast toast={toast} />
      </div>
    );
  }

  const VisIcon = VISIBILITY_OPTIONS.find((v) => v.id === visibility)!.icon;
  const visHelper = VISIBILITY_OPTIONS.find((v) => v.id === visibility)!.helper;
  const remaining = MAX_CONTENT_LENGTH - content.length;

  const inputStyle = {
    backgroundColor: tokens.background,
    borderColor: tokens.border,
    color: tokens.text,
  } as const;

  return (
    <div
      className={cn("border-b min-w-0", compact ? "p-3" : "p-3 sm:p-4")}
      style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
    >
      {/* Type selector */}
      <div className="flex gap-1 overflow-x-auto pb-1 min-w-0" role="tablist" aria-label="Post type">
        {TYPE_BUTTONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={kind === id}
            onClick={() => setKind(id)}
            title={label}
            className={cn(
              "flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg px-2.5",
              kind === id && "border",
            )}
            style={{
              color: kind === id ? tokens.primary : tokens.textMuted,
              borderColor: kind === id ? tokens.primary : "transparent",
              backgroundColor: kind === id ? tokens.primary + "14" : "transparent",
            }}
          >
            <Icon size={19} />
            <span className="sr-only sm:not-sr-only sm:ml-1.5 sm:text-xs">{label}</span>
          </button>
        ))}
      </div>

      {/* Text */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value.slice(0, MAX_CONTENT_LENGTH))}
        rows={kind === "text" ? 3 : 2}
        maxLength={MAX_CONTENT_LENGTH}
        placeholder="What's happening?"
        className="mt-1 w-full resize-none rounded-xl border p-3 text-[15px] outline-none min-w-0"
        style={inputStyle}
        aria-label="Post text"
      />
      <div className="mt-1 flex justify-end text-[11px] tabular-nums" style={{ color: tokens.textMuted }}>
        {remaining < 500 && <span>{remaining} left</span>}
      </div>

      {/* Image/Video attachments */}
      {(kind === "image" || kind === "video") && (
        <div className="mt-1 min-w-0">
          <input
            ref={fileInputRef}
            type="file"
            accept={kind === "image" ? "image/jpeg,image/png,image/webp,image/gif" : "video/mp4,video/webm,video/quicktime"}
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files, kind);
              e.target.value = "";
            }}
            aria-label={`Choose ${kind} files`}
          />
          {files.length < MAX_MEDIA_FILES && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-[44px] items-center gap-2 rounded-xl border border-dashed px-4 text-sm"
              style={{ borderColor: tokens.border, color: tokens.textMuted }}
            >
              {kind === "image" ? <ImageIcon size={18} /> : <Clapperboard size={18} />}
              Add {kind === "image" ? "images" : "video"} ({files.length}/{MAX_MEDIA_FILES})
            </button>
          )}
          {files.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {files.map((f) => (
                <div key={f.id} className="relative overflow-hidden rounded-xl border" style={{ borderColor: tokens.border }}>
                  {f.file.type.startsWith("video/") ? (
                    <video src={f.previewUrl} className="aspect-video w-full object-cover" preload="metadata" />
                  ) : (
                    <img src={f.previewUrl} alt="" className="aspect-video w-full object-cover" />
                  )}
                  {f.uploadedUrl && (
                    <span
                      className="absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                      style={{ backgroundColor: tokens.success, color: "#fff" }}
                    >
                      Ready
                    </span>
                  )}
                  {f.error && (
                    <button
                      type="button"
                      onClick={() => retryUpload(f.id)}
                      className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-2 text-xs font-semibold text-white"
                    >
                      Upload failed — tap to retry
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    aria-label="Remove file"
                    className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Link */}
      {kind === "link" && (
        <div className="mt-1 min-w-0">
          <div className="flex gap-2">
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://example.com/article"
              className="min-h-[44px] min-w-0 flex-1 rounded-xl border px-3 text-sm outline-none"
              style={inputStyle}
              aria-label="Link URL"
            />
            <button
              type="button"
              onClick={fetchLinkPreview}
              disabled={linkLoading || !linkUrl.trim()}
              className="min-h-[44px] shrink-0 rounded-xl border px-4 text-sm font-semibold disabled:opacity-40"
              style={{ borderColor: tokens.border, color: tokens.text }}
            >
              {linkLoading ? <Loader2 size={16} className="animate-spin" /> : "Preview"}
            </button>
          </div>
          {linkPreview && (
            <div className="mt-2 min-w-0">
              <LinkCard link={{ ...linkPreview, title: linkTitle.trim() || linkPreview.title }} />
              <input
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="Edit title (optional)"
                className="mt-2 min-h-[44px] w-full rounded-xl border px-3 text-sm outline-none"
                style={inputStyle}
                aria-label="Edit link title"
              />
            </div>
          )}
        </div>
      )}

      {/* Project */}
      {kind === "project" && (
        <div className="mt-1 space-y-2 min-w-0">
          {projects === null ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: tokens.textMuted }}>
              <Loader2 size={16} className="animate-spin" /> Loading your projects…
            </div>
          ) : projects.length > 0 ? (
            <div className="relative">
              <select
                value={selectedProject}
                onChange={(e) => {
                  setSelectedProject(e.target.value);
                  const chosen = projects.find((p) => p.id === e.target.value);
                  if (chosen) setProjectName(chosen.name);
                }}
                className="min-h-[44px] w-full appearance-none rounded-xl border px-3 pr-10 text-sm outline-none"
                style={inputStyle}
                aria-label="Select one of your projects"
              >
                <option value="">Select one of your projects…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: tokens.textMuted }} />
            </div>
          ) : null}
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Or type a project name"
            className="min-h-[44px] w-full rounded-xl border px-3 text-sm outline-none"
            style={inputStyle}
            aria-label="Project name"
          />
        </div>
      )}

      {/* Music */}
      {kind === "music" && (
        <div className="mt-1 space-y-2 min-w-0">
          <input
            value={musicTitle}
            onChange={(e) => setMusicTitle(e.target.value)}
            placeholder="Track title"
            className="min-h-[44px] w-full rounded-xl border px-3 text-sm outline-none"
            style={inputStyle}
            aria-label="Track title"
          />
          <input
            value={musicArtist}
            onChange={(e) => setMusicArtist(e.target.value)}
            placeholder="Artist (optional)"
            className="min-h-[44px] w-full rounded-xl border px-3 text-sm outline-none"
            style={inputStyle}
            aria-label="Artist"
          />
          <input
            type="url"
            value={musicUrl}
            onChange={(e) => setMusicUrl(e.target.value)}
            placeholder="Link to the track (optional)"
            className="min-h-[44px] w-full rounded-xl border px-3 text-sm outline-none"
            style={inputStyle}
            aria-label="Track URL"
          />
        </div>
      )}

      {/* Poll */}
      {kind === "poll" && (
        <div className="mt-1 space-y-2 min-w-0">
          <input
            value={pollQuestion}
            onChange={(e) => setPollQuestion(e.target.value.slice(0, 280))}
            placeholder="Ask a question…"
            maxLength={280}
            className="min-h-[44px] w-full rounded-xl border px-3 text-sm outline-none"
            style={inputStyle}
            aria-label="Poll question"
          />
          {pollOptions.map((opt, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={opt}
                onChange={(e) => {
                  const next = [...pollOptions];
                  next[i] = e.target.value.slice(0, 100);
                  setPollOptions(next);
                }}
                placeholder={`Option ${i + 1}`}
                maxLength={100}
                className="min-h-[44px] min-w-0 flex-1 rounded-xl border px-3 text-sm outline-none"
                style={inputStyle}
                aria-label={`Poll option ${i + 1}`}
              />
              {pollOptions.length > 2 && (
                <button
                  type="button"
                  onClick={() => setPollOptions(pollOptions.filter((_, j) => j !== i))}
                  aria-label={`Remove option ${i + 1}`}
                  className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl border"
                  style={{ borderColor: tokens.border, color: tokens.textMuted }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
          {pollOptions.length < 4 && (
            <button
              type="button"
              onClick={() => setPollOptions([...pollOptions, ""])}
              className="flex min-h-[44px] items-center rounded-xl border border-dashed px-4 text-sm"
              style={{ borderColor: tokens.border, color: tokens.textMuted }}
            >
              + Add option
            </button>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="poll-duration" className="text-xs" style={{ color: tokens.textMuted }}>
              Runs for
            </label>
            <select
              id="poll-duration"
              value={pollDuration}
              onChange={(e) => setPollDuration(Number(e.target.value))}
              className="min-h-[44px] rounded-xl border px-3 text-sm outline-none"
              style={inputStyle}
            >
              {POLL_DURATIONS.map((d) => (
                <option key={d.ms} value={d.ms}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div className="text-[11px]" style={{ color: tokens.textMuted }}>
            A poll needs a question and at least 2 options.
          </div>
        </div>
      )}

      {/* Footer: visibility + post button */}
      <div className="mt-3 flex items-center justify-between gap-2 min-w-0">
        <div className="relative" ref={visRef}>
          <button
            type="button"
            onClick={() => setVisibilityOpen((o) => !o)}
            aria-label={`Visibility: ${visibility}`}
            aria-expanded={visibilityOpen}
            title={visHelper}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 text-sm"
            style={{ borderColor: tokens.border, color: tokens.textMuted }}
          >
            <VisIcon size={16} style={{ color: tokens.primary }} />
            <span className="hidden sm:inline">{VISIBILITY_OPTIONS.find((v) => v.id === visibility)!.label}</span>
            <ChevronDown size={14} />
          </button>
          {visibilityOpen && (
            <div
              role="menu"
              className="absolute bottom-12 left-0 z-50 w-60 overflow-hidden rounded-xl border shadow-xl"
              style={{ backgroundColor: tokens.surfaceElevated, borderColor: tokens.border }}
            >
              {VISIBILITY_OPTIONS.map(({ id, label, helper, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={visibility === id}
                  onClick={() => {
                    setVisibility(id);
                    setVisibilityOpen(false);
                  }}
                  className="flex min-h-[44px] w-full items-center gap-2.5 px-4 text-left"
                >
                  <Icon size={16} style={{ color: visibility === id ? tokens.primary : tokens.textMuted }} />
                  <span>
                    <span className="block text-sm font-semibold" style={{ color: tokens.text }}>
                      {label}
                    </span>
                    <span className="block text-[11px]" style={{ color: tokens.textMuted }}>
                      {helper}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={!isValid || posting || uploading}
          className="min-h-[44px] rounded-xl px-8 text-sm font-bold disabled:opacity-40"
          style={{ backgroundColor: tokens.primary, color: tokens.textInverse }}
          aria-label="Publish post"
        >
          {posting || uploading ? (
            <span className="flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              {uploading ? "Uploading…" : "Posting…"}
            </span>
          ) : (
            "Post"
          )}
        </button>
      </div>

      {error && (
        <div
          className="mt-2 flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm"
          style={{ borderColor: tokens.danger + "60", backgroundColor: tokens.danger + "10", color: tokens.text }}
          role="alert"
        >
          <span className="break-words">{error}</span>
          <button
            type="button"
            onClick={submit}
            disabled={posting || uploading}
            className="min-h-[44px] shrink-0 rounded-lg px-3 text-sm font-bold disabled:opacity-40"
            style={{ backgroundColor: tokens.primary, color: tokens.textInverse }}
          >
            Retry
          </button>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}
