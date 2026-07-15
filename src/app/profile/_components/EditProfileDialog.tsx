"use client";

import { useState } from "react";
import { X, Save, Loader2 } from "lucide-react";
import type { UserProfile } from "@/context/ProfileContext";

interface Props {
  open: boolean;
  profile: UserProfile;
  saving: boolean;
  onClose: () => void;
  onSave: (updates: Partial<UserProfile>) => Promise<void>;
}

export function EditProfileDialog({
  open,
  profile,
  saving,
  onClose,
  onSave,
}: Props) {
  const [form, setForm] = useState(() => ({
    displayName: profile.displayName,
    username: profile.username,
    bio: profile.bio,
    location: profile.location,
    website: profile.website,
  }));

  if (!open) return null;

  const field = (
    label: string,
    key: keyof typeof form,
    placeholder = "",
    maxLen = 200,
    multiline = false,
  ) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label
        style={{
          fontSize: "12px",
          fontWeight: 700,
          color: "#a1a1aa",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </label>
      {multiline ? (
        <textarea
          id="edit-profile-bio"
          name="editProfileBio"
          value={form[key]}
          maxLength={maxLen}
          onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
          rows={3}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.04)",
            color: "#f5f5f7",
            fontSize: "13px",
            resize: "vertical",
            outline: "none",
            fontFamily: "inherit",
            lineHeight: 1.5,
          }}
          placeholder={placeholder}
        />
      ) : (
        <input
          id="edit-profile-name"
          name="editProfileName"
          type="text"
          value={form[key]}
          maxLength={maxLen}
          onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.04)",
            color: "#f5f5f7",
            fontSize: "13px",
            outline: "none",
            fontFamily: "inherit",
          }}
          placeholder={placeholder}
        />
      )}
      <p style={{ fontSize: "10px", color: "#52525b", textAlign: "right" }}>
        {form[key].length}/{maxLen}
      </p>
    </div>
  );

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(6px)",
          zIndex: 1000,
        }}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit profile"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(480px, 100vw)",
          background: "rgba(11,11,16,0.98)",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          zIndex: 1001,
          display: "flex",
          flexDirection: "column",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#f5f5f7" }}>
            Edit Profile
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)",
              color: "#71717a",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Fields */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            gap: "18px",
          }}
        >
          {field("Display name", "displayName", "Your name", 50)}
          {field("Username", "username", "your_username", 30)}
          {field("Bio", "bio", "Tell the world about you…", 200, true)}
          {field("Location", "location", "City, Country", 80)}
          {field("Website", "website", "https://yoursite.com", 200)}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            gap: "10px",
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              flex: 1,
              minHeight: "42px",
              borderRadius: "12px",
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.035)",
              color: "#f5f5f7",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            disabled={saving}
            onClick={async () => {
              await onSave(form);
              onClose();
            }}
            style={{
              flex: 2,
              minHeight: "42px",
              borderRadius: "12px",
              border: "none",
              background: saving
                ? "rgba(168,85,247,0.5)"
                : "linear-gradient(135deg, #a855f7, #c084fc)",
              color: "#09090b",
              fontSize: "13px",
              fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </>
  );
}
