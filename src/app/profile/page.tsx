"use client";
export const dynamic = "force-dynamic";

import { useState, useCallback, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useProfile } from "@/context/ProfileContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import Link from "next/link";

import { ProfileCover } from "./_components/ProfileCover";
import { ProfileIdentity } from "./_components/ProfileIdentity";
import { ProfileTabs } from "./_components/ProfileTabs";
import { ProfileOverview } from "./_components/ProfileOverview";
import { ProfileRightRail } from "./_components/ProfileRightRail";
import { EditProfileDialog } from "./_components/EditProfileDialog";
import { CreatorActionPanel } from "./_components/CreatorActionPanel";

function ProfilePageInner() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, updateProfile } = useProfile();

  const [saving, setSaving] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [editOpen, setEditOpen] = useState(false);

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
      if (field === "avatar_url") updateProfile({ avatarUrl: data.url });
      if (field === "cover_url") updateProfile({ coverUrl: data.url });
      await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: data.url }),
      });
    },
    [updateProfile],
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
    await uploadAndSave(avatarFile, "avatar_url").catch(() => {
      updateProfile({ avatarUrl: URL.createObjectURL(avatarFile) });
    });
    setSaving(false);
    setAvatarFile(null);
    setAvatarPreview(null);
  }, [avatarFile, uploadAndSave, updateProfile]);

  const confirmCoverUpload = useCallback(async () => {
    if (!coverFile) return;
    setSaving(true);
    await uploadAndSave(coverFile, "cover_url").catch(() => {
      updateProfile({ coverUrl: URL.createObjectURL(coverFile) });
    });
    setSaving(false);
    setCoverFile(null);
    setCoverPreview(null);
  }, [coverFile, uploadAndSave, updateProfile]);

  const handleSaveProfile = useCallback(
    async (updates: Partial<typeof profile>) => {
      setSaving(true);
      try {
        updateProfile(updates);
        const body: Record<string, unknown> = {};
        if (updates.displayName !== undefined) body.name = updates.displayName;
        if (updates.username !== undefined) body.username = updates.username;
        if (updates.bio !== undefined) body.bio = updates.bio;
        if (updates.location !== undefined) body.location = updates.location;
        if (updates.website !== undefined) body.website = updates.website;
        await fetch("/api/settings/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } finally {
        setSaving(false);
      }
    },
    [updateProfile],
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
        <ProfileCover
          coverUrl={profile.coverUrl}
          coverPreview={coverPreview}
          isOwner={true}
          saving={saving}
          onFileSelect={handleCoverSelect}
          onConfirm={confirmCoverUpload}
          onCancel={() => {
            setCoverFile(null);
            setCoverPreview(null);
          }}
        />

        <ProfileIdentity
          profile={profile}
          isOwner={true}
          saving={saving}
          avatarPreview={avatarPreview}
          onAvatarSelect={handleAvatarSelect}
          onAvatarConfirm={confirmAvatarUpload}
          onAvatarCancel={() => {
            setAvatarFile(null);
            setAvatarPreview(null);
          }}
          onEditProfile={() => setEditOpen(true)}
        />

        <div style={{ marginTop: "24px" }}>
          <ProfileTabs />
        </div>

        {(activeTab === "overview" || activeTab === "about") && (
          <div
            className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_340px]"
            style={{ marginTop: "24px" }}
          >
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
        onClose={() => setEditOpen(false)}
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
        @media (max-width: 1099px) {
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
