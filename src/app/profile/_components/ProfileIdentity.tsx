"use client";

import Image from "next/image";
import {
  Camera,
  MapPin,
  Globe,
  CalendarDays,
  BadgeCheck,
  Share2,
  MoreHorizontal,
  UserPlus,
  MessageSquare,
  Pencil,
} from "lucide-react";
import { useRef } from "react";
import type { UserProfile } from "@/context/ProfileContext";

interface ProfileIdentityProps {
  profile: UserProfile;
  isOwner: boolean;
  saving: boolean;
  avatarPreview: string | null;
  onAvatarSelect: (file: File) => void;
  onAvatarConfirm: () => void;
  onAvatarCancel: () => void;
  onEditProfile: () => void;
}

const STATS = [
  { label: "Followers", key: "followers", value: "2.4K" },
  { label: "Following", key: "following", value: "186" },
  { label: "Projects", key: "projects", value: "38" },
  { label: "Agents", key: "agents", value: "12" },
  { label: "Artifacts", key: "artifacts", value: "146" },
  { label: "Views", key: "views", value: "22K" },
];

export function ProfileIdentity({
  profile,
  isOwner,
  saving,
  avatarPreview,
  onAvatarSelect,
  onAvatarConfirm,
  onAvatarCancel,
  onEditProfile,
}: ProfileIdentityProps) {
  const avatarRef = useRef<HTMLInputElement>(null);
  const avatarSrc = avatarPreview || profile.avatarUrl;
  const initial = (profile.displayName?.[0] || "C").toUpperCase();

  return (
    <div className="profile-identity">
      {/* Avatar — overlaps the cover by -56px on desktop */}
      <div className="profile-avatar-wrap group">
        <div className="profile-avatar-ring">
          <div className="profile-avatar-inner">
            {avatarSrc ? (
              <Image
                src={avatarSrc}
                alt="Avatar"
                fill
                className="object-cover rounded-full"
                sizes="144px"
                unoptimized={!!avatarPreview}
                priority
              />
            ) : (
              <div className="avatar-initial">{initial}</div>
            )}
          </div>
        </div>

        {/* Online indicator */}
        <span className="avatar-online" />

        {/* Owner: change avatar overlay */}
        {isOwner && !avatarPreview && (
          <button
            onClick={() => avatarRef.current?.click()}
            className="avatar-edit-btn"
            aria-label="Change avatar"
          >
            <Camera size={16} />
          </button>
        )}

        {/* Upload confirm */}
        {avatarPreview && (
          <div className="avatar-confirm-overlay">
            <button
              onClick={onAvatarConfirm}
              disabled={saving}
              className="avatar-confirm-btn"
            >
              {saving ? "…" : "Set"}
            </button>
            <button onClick={onAvatarCancel} className="avatar-cancel-btn">
              ✕
            </button>
          </div>
        )}

        <input
          ref={avatarRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onAvatarSelect(f);
          }}
        />
      </div>

      {/* Identity text + actions */}
      <div className="identity-body">
        <div className="identity-top">
          {/* Name + badge + level */}
          <div className="identity-name-row">
            <h1 className="identity-name">{profile.displayName}</h1>
            <BadgeCheck
              size={20}
              className="identity-verified"
              aria-label="Verified creator"
            />
            <span className="identity-level">Lv 18</span>
          </div>

          {/* Username + role */}
          <p className="identity-username">
            @{profile.username}
            <span className="identity-role-sep">·</span>
            <span className="identity-role">AI Creator · Founder</span>
          </p>

          {/* Bio */}
          {profile.bio && <p className="identity-bio">{profile.bio}</p>}

          {/* Meta row */}
          <div className="identity-meta">
            {profile.location && (
              <span className="meta-chip">
                <MapPin size={12} />
                {profile.location}
              </span>
            )}
            {profile.website && (
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className="meta-chip meta-link"
              >
                <Globe size={12} />
                {profile.website.replace(/^https?:\/\//, "")}
              </a>
            )}
            <span className="meta-chip">
              <CalendarDays size={12} />
              Joined 2024
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="identity-actions">
          {isOwner ? (
            <>
              <button onClick={onEditProfile} className="btn-primary">
                <Pencil size={14} />
                Edit profile
              </button>
              <button className="btn-secondary" aria-label="Share profile">
                <Share2 size={14} />
              </button>
              <button className="btn-secondary" aria-label="More options">
                <MoreHorizontal size={14} />
              </button>
            </>
          ) : (
            <>
              <button className="btn-primary">
                <UserPlus size={14} />
                Follow
              </button>
              <button className="btn-secondary">
                <MessageSquare size={14} />
                Message
              </button>
              <button className="btn-secondary" aria-label="Share">
                <Share2 size={14} />
              </button>
              <button className="btn-secondary" aria-label="More">
                <MoreHorizontal size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stats strip */}
      <div className="profile-stats-strip">
        {STATS.map((s, i) => (
          <div key={s.key} className="stat-item">
            {i > 0 && <div className="stat-divider" />}
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <style>{`
        .profile-identity {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        /* Avatar */
        .profile-avatar-wrap {
          position: relative;
          width: 144px;
          height: 144px;
          margin-top: -72px;
          margin-left: 28px;
          z-index: 10;
          flex-shrink: 0;
        }
        .profile-avatar-ring {
          width: 144px;
          height: 144px;
          border-radius: 999px;
          padding: 4px;
          background: linear-gradient(135deg, #a855f7, #30e7ff, #f472b6);
          box-shadow: 0 0 0 4px #07070b, 0 18px 40px rgba(0,0,0,0.5);
        }
        .profile-avatar-inner {
          position: relative;
          width: 100%;
          height: 100%;
          border-radius: 999px;
          overflow: hidden;
          background: #101014;
        }
        .avatar-initial {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 3rem;
          font-weight: 900;
          background: linear-gradient(135deg, rgba(168,85,247,0.3), rgba(48,231,255,0.15));
          color: #a855f7;
        }
        .avatar-online {
          position: absolute;
          bottom: 6px;
          right: 6px;
          width: 16px;
          height: 16px;
          border-radius: 999px;
          background: #34d399;
          border: 3px solid #07070b;
        }
        .avatar-edit-btn {
          position: absolute;
          inset: 0;
          border-radius: 999px;
          background: rgba(0,0,0,0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          opacity: 0;
          transition: opacity 180ms;
          cursor: pointer;
          border: none;
        }
        .group:hover .avatar-edit-btn { opacity: 1; }
        .avatar-confirm-overlay {
          position: absolute;
          inset: 0;
          border-radius: 999px;
          background: rgba(0,0,0,0.7);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }
        .avatar-confirm-btn {
          padding: 4px 10px;
          border-radius: 6px;
          background: #a855f7;
          color: white;
          font-size: 11px;
          font-weight: 700;
          border: none;
          cursor: pointer;
        }
        .avatar-cancel-btn {
          padding: 2px 8px;
          border-radius: 6px;
          background: rgba(255,255,255,0.1);
          color: white;
          font-size: 11px;
          border: none;
          cursor: pointer;
        }

        /* Identity body */
        .identity-body {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 12px 28px 0;
          flex-wrap: wrap;
        }
        .identity-top { flex: 1; min-width: 0; }
        .identity-name-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .identity-name {
          font-size: 2rem;
          font-weight: 750;
          color: #f5f5f7;
          line-height: 1.1;
          letter-spacing: -0.02em;
        }
        .identity-verified { color: #a855f7; flex-shrink: 0; }
        .identity-level {
          font-size: 11px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 999px;
          background: linear-gradient(135deg, rgba(168,85,247,0.2), rgba(48,231,255,0.1));
          border: 1px solid rgba(168,85,247,0.3);
          color: #c084fc;
          letter-spacing: 0.04em;
        }
        .identity-username {
          font-size: 14px;
          color: #71717a;
          margin-top: 4px;
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .identity-role-sep { color: #3f3f46; }
        .identity-role { color: #a1a1aa; }
        .identity-bio {
          font-size: 14px;
          line-height: 1.6;
          color: #a1a1aa;
          margin-top: 8px;
          max-width: 520px;
        }
        .identity-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 10px;
        }
        .meta-chip {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: #71717a;
        }
        .meta-link { color: #30e7ff; text-decoration: none; }
        .meta-link:hover { text-decoration: underline; }

        /* Actions */
        .identity-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
          padding-top: 4px;
        }
        .btn-primary {
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 40px;
          padding: 0 18px;
          border-radius: 12px;
          background: linear-gradient(135deg, #a855f7, #c084fc);
          color: #09090b;
          font-size: 13px;
          font-weight: 700;
          border: none;
          cursor: pointer;
          transition: transform 180ms, box-shadow 180ms;
          white-space: nowrap;
        }
        .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(168,85,247,0.35); }
        .btn-secondary {
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 40px;
          padding: 0 14px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.035);
          color: #f5f5f7;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 180ms, border-color 180ms;
          white-space: nowrap;
        }
        .btn-secondary:hover { transform: translateY(-1px); border-color: rgba(255,255,255,0.25); }

        /* Stats strip */
        .profile-stats-strip {
          display: flex;
          align-items: center;
          gap: 0;
          padding: 16px 28px 0;
          flex-wrap: wrap;
          row-gap: 8px;
        }
        .stat-item {
          display: flex;
          align-items: center;
          gap: 0;
        }
        .stat-divider {
          width: 1px;
          height: 28px;
          background: rgba(255,255,255,0.08);
          margin: 0 20px;
        }
        .stat-value {
          font-size: 18px;
          font-weight: 750;
          color: #f5f5f7;
          line-height: 1;
        }
        .stat-label {
          font-size: 11px;
          color: #71717a;
          margin-left: 5px;
          font-weight: 500;
        }

        /* Mobile */
        @media (max-width: 767px) {
          .profile-avatar-wrap {
            width: 96px;
            height: 96px;
            margin-top: -48px;
            margin-left: 16px;
          }
          .profile-avatar-ring { width: 96px; height: 96px; }
          .avatar-initial { font-size: 2rem; }
          .identity-name { font-size: 1.4rem; }
          .identity-body { padding: 10px 16px 0; }
          .identity-actions { width: 100%; flex-wrap: wrap; }
          .btn-primary, .btn-secondary { flex: 1; justify-content: center; }
          .profile-stats-strip { padding: 12px 16px 0; overflow-x: auto; flex-wrap: nowrap; }
          .stat-divider { margin: 0 12px; }
        }
      `}</style>
    </div>
  );
}
