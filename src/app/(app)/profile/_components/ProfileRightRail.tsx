"use client";

import { MapPin, Globe, CalendarDays } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import type { UserProfile } from "@/context/ProfileContext";

function formatJoined(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`profile-card ${className}`}
      style={{
        background:
          "linear-gradient(145deg, rgba(168,85,247,0.035), transparent 42%), rgba(16,16,20,0.88)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "18px",
        padding: "20px",
        boxShadow: "0 18px 50px rgba(0,0,0,0.26)",
        backdropFilter: "blur(14px)",
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: "13px",
        fontWeight: 700,
        color: "#a1a1aa",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        marginBottom: "14px",
      }}
    >
      {children}
    </h3>
  );
}

interface Props {
  profile: UserProfile;
}

export function ProfileRightRail({ profile }: Props) {
  const { user } = useUser();
  const joinedLabel = user?.createdAt ? formatJoined(user.createdAt) : null;
  return (
    <div className="right-rail">
      {/* About */}
      <Card>
        <SectionTitle>About</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {profile.bio && (
            <p style={{ fontSize: "13px", color: "#a1a1aa", lineHeight: 1.6 }}>
              {profile.bio}
            </p>
          )}
          {profile.location && (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                color: "#71717a",
              }}
            >
              <MapPin size={13} /> {profile.location}
            </span>
          )}
          {profile.website && (
            <a
              href={profile.website}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                color: "#30e7ff",
                textDecoration: "none",
              }}
            >
              <Globe size={13} />
              {profile.website.replace(/^https?:\/\//, "")}
            </a>
          )}
          {joinedLabel && (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                color: "#71717a",
              }}
            >
              <CalendarDays size={13} /> Joined {joinedLabel}
            </span>
          )}
        </div>
      </Card>

      {/* Availability */}
      <Card>
        <SectionTitle>Availability</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "999px",
              background: "#34d399",
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: "13px", color: "#a1a1aa" }}>
            Open to collaboration
          </span>
        </div>
      </Card>

      {/* Social Links */}
      {(profile.socialLinks?.github || profile.socialLinks?.twitter) && (
        <Card>
          <SectionTitle>Links</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {profile.socialLinks.github && (
              <a
                href={`https://github.com/${profile.socialLinks.github}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  color: "#a1a1aa",
                  textDecoration: "none",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
                {profile.socialLinks.github}
              </a>
            )}
            {profile.socialLinks.twitter && (
              <a
                href={`https://x.com/${profile.socialLinks.twitter}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  color: "#a1a1aa",
                  textDecoration: "none",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                @{profile.socialLinks.twitter}
              </a>
            )}
          </div>
        </Card>
      )}

      <style>{`
        .right-rail {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
      `}</style>
    </div>
  );
}
