"use client";

import Image from "next/image";
import { Camera } from "lucide-react";
import { useRef } from "react";

interface ProfileCoverProps {
  coverUrl: string | null;
  coverPreview: string | null;
  isOwner: boolean;
  saving: boolean;
  onFileSelect: (file: File) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ProfileCover({
  coverUrl,
  coverPreview,
  isOwner,
  saving,
  onFileSelect,
  onConfirm,
  onCancel,
}: ProfileCoverProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const src = coverPreview || coverUrl;

  return (
    <div className="profile-cover group">
      {/* Image or branded default */}
      {src ? (
        <Image
          src={src}
          alt="Profile cover"
          fill
          className="object-cover"
          sizes="100vw"
          priority
          unoptimized={!!coverPreview}
        />
      ) : (
        /* Branded CSS-only default cover */
        <div className="absolute inset-0 branded-cover" aria-hidden />
      )}

      {/* Bottom gradient so identity text is readable */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, transparent 30%, rgba(7,7,11,0.55) 70%, rgba(7,7,11,0.92) 100%)",
        }}
      />

      <input
        ref={inputRef}
        id="profile-cover-file"
        name="profileCoverFile"
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFileSelect(f);
        }}
      />

      {/* Upload confirm bar */}
      {coverPreview && (
        <div className="absolute inset-0 flex items-center justify-center gap-3 bg-black/60">
          <button
            onClick={onConfirm}
            disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-[#a855f7] text-white disabled:opacity-50 transition hover:bg-[#c084fc]"
          >
            {saving ? "Uploading…" : "Set cover"}
          </button>
          <button
            onClick={onCancel}
            className="px-5 py-2 rounded-xl text-sm font-bold border border-white/20 bg-black/40 text-white transition hover:bg-white/10"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Owner: add/change cover button (top-right) */}
      {isOwner && !coverPreview && (
        <button
          onClick={() => inputRef.current?.click()}
          className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/20 bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
        >
          <Camera size={12} />
          {coverUrl ? "Change cover" : "Add cover"}
        </button>
      )}

      <style>{`
        .profile-cover {
          position: relative;
          height: 280px;
          overflow: hidden;
          border-radius: 22px;
          border: 1px solid rgba(255,255,255,0.08);
        }
        @media (max-width: 1099px) { .profile-cover { height: 230px; } }
        @media (max-width: 767px)  { .profile-cover { height: 170px; border-radius: 14px; } }

        .branded-cover {
          background:
            radial-gradient(circle at 20% 35%, rgba(168,85,247,0.55) 0%, transparent 38%),
            radial-gradient(circle at 78% 38%, rgba(48,231,255,0.22) 0%, transparent 35%),
            radial-gradient(circle at 50% 90%, rgba(168,85,247,0.18) 0%, transparent 40%),
            #090912;
        }
        .branded-cover::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: radial-gradient(ellipse at 50% 50%, black 20%, transparent 80%);
          -webkit-mask-image: radial-gradient(ellipse at 50% 50%, black 20%, transparent 80%);
        }
      `}</style>
    </div>
  );
}
