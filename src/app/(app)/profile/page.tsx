"use client";
export const dynamic = "force-dynamic";

import { useState, useCallback, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useProfile } from "@/context/ProfileContext";
import type { UserProfile } from "@/context/ProfileContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import Link from "next/link";

import { ProfileCover } from "./_components/ProfileCover";
import { ProfileIdentity } from "./_components/ProfileIdentity";
import { ProfileTabs } from "./_components/ProfileTabs";
import { ProfileOverview } from "./_components/ProfileOverview";
import { ProfileRightRail } from "./_components/ProfileRightRail";
import { EditProfileDialog } from "./_components/EditProfileDialog";
import { CreatorActionPanel } from "./_components/CreatorActionPanel";

/**
 * The server is the source of truth for persisted profile data.
 * Maps the POST /api/settings/profile response `user` object onto the
 * client-side UserProfile shape, falling back to the last confirmed values
 * for fields the server did not return.
 */
function mapServerUserToProfile(
  user: Record<string, unknown>,
  prev: UserProfile,
): Partial<UserProfile> {
  return {
    displayName:
      typeof user.name === "string" && user.name
        ? user.name
        : prev.displayName,
    username:
      typeof user.username === "string" && user.username
        ? user.username
        : prev.username,
    bio: typeof user.bio === "string" ? user.bio : prev.bio,
    location:
      typeof user.location === "string" ? user.location : prev.location,
    website: typeof user.website === "string" ? user.website : prev.website,
    avatarUrl:
      user.avatar_url === null || typeof user.avatar_url === "string"
        ? user.avatar_url
        : prev.avatarUrl,
    coverUrl:
      user.cover_url === null || typeof user.cover_url === "string"
        ? user.cover_url
        : prev.coverUrl,
  };
}

function ProfilePageInner() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, updateProfile, syncError } = useProfile();

  const [saving, setSaving] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in?redirect_url=/profile");
    }
  }, [isLoaded, isSignedIn, router]);

  const uploadAndSave = useCallback(
    async (file: File, field: "avatar_url" | "cover_url") => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Upload failed");
      // The upload is only "saved" if the profile record was persisted too.
      // Check the response before touching the UI, so a failed save can never
      // masquerade as success.
      const saveRes = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: data.url }),
      });
      const saveData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok || !saveData?.user) {
        throw new Error(
          typeof saveData?.error === "string" && saveData.error
            ? saveData.error
            : "Profile save failed",
        );
      }
      updateProfile(
        mapServerUserToProfile(
          saveData.user as Record<string, unknown>,
          profile,
        ),
      );
    },
    [updateProfile, profile],
  );

  const handleAvatarSelect = useCallback((file: File) => {
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }, []);

  const handleCoverSelect = useCallback((file: File) => {
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  }, []);

  const confirmAvatarUpload = useCallback(async () => {
    if (!avatarFile) return;
    setSaving(true);
    setUploadError(null);
    try {
      await uploadAndSave(avatarFile, "avatar_url");
      // Only dismiss the preview once the save is confirmed persisted.
      setAvatarFile(null);
      setAvatarPreview(null);
    } catch {
      // Keep the file/preview so the user can retry without re-selecting.
      setUploadError("Avatar save failed — not saved. Try again.");
    }
    setSaving(false);
  }, [avatarFile, uploadAndSave]);

  const confirmCoverUpload = useCallback(async () => {
    if (!coverFile) return;
    setSaving(true);
    setUploadError(null);
    try {
      await uploadAndSave(coverFile, "cover_url");
      setCoverFile(null);
      setCoverPreview(null);
    } catch {
      setUploadError("Cover save failed — not saved. Try again.");
    }
    setSaving(false);
  }, [coverFile, uploadAndSave]);

  // Returns true only when the server confirmed the save. The UI is updated
  // exclusively from the server-returned profile data — never optimistically —
  // so the user can never see values that were not persisted.
  const handleSaveProfile = useCallback(
    async (updates: Partial<UserProfile>): Promise<boolean> => {
      setSaving(true);
      setSaveError(null);
      try {
        const body: Record<string, unknown> = {};
        if (updates.displayName !== undefined) body.name = updates.displayName;
        if (updates.username !== undefined) body.username = updates.username;
        if (updates.bio !== undefined) body.bio = updates.bio;
        if (updates.location !== undefined) body.location = updates.location;
        if (updates.website !== undefined) body.website = updates.website;
        const res = await fetch("/api/settings/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.user) {
          setSaveError(
            typeof data?.error === "string" && data.error
              ? `Save failed: ${data.error}`
              : "Save failed — your changes were not saved. Try again.",
          );
          return false;
        }
        updateProfile(
          mapServerUserToProfile(
            data.user as Record<string, unknown>,
            profile,
          ),
        );
        return true;
      } catch {
        setSaveError(
          "Save failed — couldn't reach the server. Your changes were not saved.",
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [updateProfile, profile],
  );

  const activeTab = searchParams.get("tab") || "overview";

  if (!isLoaded) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#07070b",
          color: "#a1a1aa",
          fontSize: "14px",
        }}
      >
        Loading profile…
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          background: "#07070b",
          color: "#a1a1aa",
          fontSize: "14px",
        }}
      >
        <p>Please sign in to view your profile.</p>
        <Link
          href="/sign-in?redirect_url=/profile"
          style={{
            padding: "10px 20px",
            borderRadius: "12px",
            background: "#a855f7",
            color: "#09090b",
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <div className="profile-container">
        {syncError && (
          <p
            role="alert"
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "#fca5a5",
              background: "rgba(248,113,113,0.08)",
              border: "1px solid rgba(248,113,113,0.25)",
              borderRadius: "10px",
              padding: "10px 12px",
              marginBottom: "12px",
            }}
          >
            {syncError}
          </p>
        )}
        <ProfileCover
          coverUrl={profile.coverUrl}
          coverPreview={coverPreview}
          isOwner={true}
          saving={saving}
          uploadError={uploadError}
          onFileSelect={handleCoverSelect}
          onConfirm={confirmCoverUpload}
          onCancel={() => {
            setCoverFile(null);
            setCoverPreview(null);
            setUploadError(null);
          }}
        />

        <ProfileIdentity
          profile={profile}
          isOwner={true}
          saving={saving}
          avatarPreview={avatarPreview}
          uploadError={uploadError}
          onAvatarSelect={handleAvatarSelect}
          onAvatarConfirm={confirmAvatarUpload}
          onAvatarCancel={() => {
            setAvatarFile(null);
            setAvatarPreview(null);
            setUploadError(null);
          }}
          onEditProfile={() => {
            setSaveError(null);
            setEditOpen(true);
          }}
        />

        <div style={{ marginTop: "24px" }}>
          <ProfileTabs />
        </div>

        {(activeTab === "overview" || activeTab === "about") && (
          <div className="profile-content-grid" style={{ marginTop: "24px" }}>
            <ProfileOverview hasProjects hasAgents />
            <ProfileRightRail profile={profile} />
          </div>
        )}

        {activeTab === "projects" && (
          <div style={{ marginTop: "24px" }}>
            <ProfileOverview hasProjects />
          </div>
        )}

        {activeTab === "agents" && (
          <div style={{ marginTop: "24px" }}>
            <ProfileOverview hasAgents />
          </div>
        )}

        {(activeTab === "artifacts" ||
          activeTab === "posts" ||
          activeTab === "activity") && (
          <div style={{ marginTop: "24px" }}>
            <ProfileOverview />
          </div>
        )}

        <div style={{ marginTop: "32px" }}>
          <CreatorActionPanel />
        </div>
      </div>

      <EditProfileDialog
        open={editOpen}
        profile={profile}
        saving={saving}
        saveError={saveError}
        onClose={() => {
          setEditOpen(false);
          setSaveError(null);
        }}
        onSave={handleSaveProfile}
      />

      <style>{`
        .profile-page {
          min-height: 100dvh;
          background:
            radial-gradient(circle at 15% 5%, rgba(168,85,247,0.08), transparent 28%),
            radial-gradient(circle at 90% 15%, rgba(48,231,255,0.05), transparent 24%),
            #07070b;
          color: #f5f5f7;
        }
        .profile-container {
          width: min(100%, 1500px);
          margin: 0 auto;
          padding: 24px 28px 100px;
        }
        .profile-content-grid {
          display: grid;
          grid-template-columns: 1fr 340px;
          gap: 20px;
          align-items: start;
        }
        @media (max-width: 1099px) {
          .profile-content-grid { grid-template-columns: 1fr; }
          .profile-container { padding-inline: 20px; }
        }
        @media (max-width: 767px) {
          .profile-container { padding: 12px 12px 110px; }
        }
      `}</style>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense>
      <ProfilePageInner />
    </Suspense>
  );
}
