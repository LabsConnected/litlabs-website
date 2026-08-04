"use client";

import { useCallback, useRef, useState } from "react";
import {
  type Attachment,
  type AttachmentCategory,
  type AttachmentStatus,
  MAX_ATTACHMENTS,
  validateFile,
  isLinkUrl,
  linkCategory,
  classifyFile,
  getExtension,
  EXTENSION_MAP,
} from "../lib/attachment-types";

// ---------------------------------------------------------------------------
// Upload result from /api/upload
// ---------------------------------------------------------------------------

interface UploadResult {
  url: string;
  path?: string;
  fallback?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseStudioAttachments {
  attachments: Attachment[];
  canAdd: boolean;
  addFiles: (files: File[] | FileList) => void;
  addLink: (url: string) => boolean;
  addProjectFile: (name: string, path: string, mimeType: string, size: number) => void;
  addRecording: (file: File, source: "record-audio" | "record-video" | "screen") => void;
  addCameraPhoto: (file: File) => void;
  removeAttachment: (id: string) => void;
  retryAttachment: (id: string) => void;
  reorderAttachment: (id: string, direction: "left" | "right") => void;
  clearAll: () => void;
  /** Returns the URLs/data for ready attachments, for passing to onSend. */
  getReadyUrls: () => string[];
  /** Returns true if any attachment is still processing. */
  isProcessing: () => boolean;
}

function genId(): string {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function genUploadId(): string {
  return `up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function makePreview(file: File): string | null {
  if (file.type.startsWith("image/")) {
    return URL.createObjectURL(file);
  }
  if (file.type.startsWith("video/")) {
    return URL.createObjectURL(file);
  }
  return null;
}

export function useStudioAttachments(): UseStudioAttachments {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  /** Stores original File objects keyed by attachment ID for retry support. */
  const fileStoreRef = useRef<Map<string, File>>(new Map());

  // ── Internal: upload a single file to /api/upload ──────────────────
  const uploadFile = useCallback(async (attachmentId: string, file: File) => {
    const uploadId = genUploadId();
    const controller = new AbortController();
    abortControllersRef.current.set(uploadId, controller);

    setAttachments((prev) =>
      prev.map((a) =>
        a.id === attachmentId
          ? { ...a, status: "uploading" as AttachmentStatus, progress: 0, uploadId, error: null }
          : a,
      ),
    );

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("purpose", "studio-attachment");

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed (${res.status})`);
      }

      const result: UploadResult = await res.json();

      // For images, the URL is directly usable. For other types, we may
      // need to mark as "analyzing" before "ready".
      const isMedia = file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/");

      setAttachments((prev) =>
        prev.map((a) =>
          a.id === attachmentId
            ? {
                ...a,
                status: "ready" as AttachmentStatus,
                progress: 100,
                url: result.url,
                uploadId: null,
              }
            : a,
        ),
      );

      // If audio/video, we could trigger transcription here in the future.
      // For now, mark as ready immediately.
      void isMedia;
    } catch (err) {
      if (controller.signal.aborted) {
        // Canceled — remove the attachment
        setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
      } else {
        const message = err instanceof Error ? err.message : "Upload failed";
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === attachmentId
              ? { ...a, status: "failed" as AttachmentStatus, error: message, progress: null, uploadId: null }
              : a,
          ),
        );
      }
    } finally {
      abortControllersRef.current.delete(uploadId);
    }
  }, []);

  // ── Internal: create an attachment from a file and start upload ────
  const createAndUpload = useCallback(
    (file: File, source: Attachment["source"]) => {
      setAttachments((prev) => {
        if (prev.length >= MAX_ATTACHMENTS) return prev;

        const validation = validateFile(file);
        if (!validation.ok) {
          // Create a failed attachment so the user sees the error
          const failed: Attachment = {
            id: genId(),
            category: classifyFile(file),
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            status: "failed",
            progress: null,
            url: null,
            previewUrl: makePreview(file),
            error: validation.error,
            source,
            uploadId: null,
          };
          return [...prev, failed];
        }

        const attachment: Attachment = {
          id: genId(),
          category: validation.category,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          status: "uploading",
          progress: 0,
          url: null,
          previewUrl: makePreview(file),
          error: null,
          source,
          uploadId: null,
        };

        // Store the original File for retry support
        fileStoreRef.current.set(attachment.id, file);

        // Kick off the upload (async, non-blocking)
        void uploadFile(attachment.id, file);

        return [...prev, attachment];
      });
    },
    [uploadFile],
  );

  // ── Public: add files from file input or drag-drop ─────────────────
  const addFiles = useCallback(
    (files: File[] | FileList) => {
      const list = Array.from(files);
      setAttachments((prev) => {
        const remaining = MAX_ATTACHMENTS - prev.length;
        if (remaining <= 0) return prev;
        const toAdd = list.slice(0, remaining);
        // Process each file
        for (const file of toAdd) {
          createAndUpload(file, "upload");
        }
        return prev; // createAndUpload updates state internally
      });
    },
    [createAndUpload],
  );

  // ── Public: add a pasted link ──────────────────────────────────────
  const addLink = useCallback((url: string): boolean => {
    const trimmed = url.trim();
    if (!isLinkUrl(trimmed)) return false;

    setAttachments((prev) => {
      if (prev.length >= MAX_ATTACHMENTS) return prev;
      const attachment: Attachment = {
        id: genId(),
        category: linkCategory(trimmed),
        name: trimmed,
        mimeType: "link/*",
        size: 0,
        status: "ready",
        progress: 100,
        url: trimmed,
        previewUrl: null,
        error: null,
        source: "paste",
        uploadId: null,
      };
      return [...prev, attachment];
    });
    return true;
  }, []);

  // ── Public: add a project file (already in workspace) ──────────────
  const addProjectFile = useCallback(
    (name: string, path: string, mimeType: string, size: number) => {
      setAttachments((prev) => {
        if (prev.length >= MAX_ATTACHMENTS) return prev;
        const ext = getExtension(name);
        const category: AttachmentCategory = EXTENSION_MAP_LOOKUP[ext] ?? "document";
        const attachment: Attachment = {
          id: genId(),
          category,
          name,
          mimeType: mimeType || "application/octet-stream",
          size,
          status: "ready",
          progress: 100,
          url: path, // project file path, not a URL
          previewUrl: null,
          error: null,
          source: "project-file",
          uploadId: null,
        };
        return [...prev, attachment];
      });
    },
    [],
  );

  // ── Public: add a recording (audio/video/screen) ───────────────────
  const addRecording = useCallback(
    (file: File, source: "record-audio" | "record-video" | "screen") => {
      createAndUpload(file, source);
    },
    [createAndUpload],
  );

  // ── Public: add a camera photo ─────────────────────────────────────
  const addCameraPhoto = useCallback(
    (file: File) => {
      createAndUpload(file, "camera");
    },
    [createAndUpload],
  );

  // ── Public: remove an attachment ───────────────────────────────────
  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.uploadId) {
        const controller = abortControllersRef.current.get(target.uploadId);
        controller?.abort();
      }
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      fileStoreRef.current.delete(id);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  // ── Public: retry a failed attachment ──────────────────────────────
  const retryAttachment = useCallback(
    (id: string) => {
      const file = fileStoreRef.current.get(id);
      if (!file) {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id
              ? { ...a, status: "failed", error: "Original file unavailable — re-add it to retry", progress: null }
              : a,
          ),
        );
        return;
      }
      void uploadFile(id, file);
    },
    [uploadFile],
  );

  // ── Public: reorder attachments ────────────────────────────────────
  const reorderAttachment = useCallback((id: string, direction: "left" | "right") => {
    setAttachments((prev) => {
      const idx = prev.findIndex((a) => a.id === id);
      if (idx < 0) return prev;
      const swapWith = direction === "left" ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next;
    });
  }, []);

  // ── Public: clear all ──────────────────────────────────────────────
  const clearAll = useCallback(() => {
    abortControllersRef.current.forEach((c) => c.abort());
    abortControllersRef.current.clear();
    fileStoreRef.current.clear();
    setAttachments((prev) => {
      prev.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
      return [];
    });
  }, []);

  // ── Public: get ready URLs for sending ─────────────────────────────
  const getReadyUrls = useCallback(() => {
    return attachments
      .filter((a) => a.status === "ready" && a.url)
      .map((a) => a.url as string);
  }, [attachments]);

  // ── Public: check if any attachment is processing ──────────────────
  const isProcessing = useCallback(() => {
    return attachments.some((a) => a.status === "uploading" || a.status === "transcribing" || a.status === "analyzing");
  }, [attachments]);

  const canAdd = attachments.length < MAX_ATTACHMENTS;

  return {
    attachments,
    canAdd,
    addFiles,
    addLink,
    addProjectFile,
    addRecording,
    addCameraPhoto,
    removeAttachment,
    retryAttachment,
    reorderAttachment,
    clearAll,
    getReadyUrls,
    isProcessing,
  };
}

// Lookup helper for addProjectFile
const EXTENSION_MAP_LOOKUP: Record<string, AttachmentCategory> = EXTENSION_MAP;
