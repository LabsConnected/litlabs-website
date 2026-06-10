"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

// User profile type
export interface UserProfile {
  displayName: string;
  username: string;
  bio: string;
  mood: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  location: string;
  website: string;
  interests: string[];
  musicLinks: {
    spotify?: string;
    youtube?: string;
    soundcloud?: string;
    appleMusic?: string;
  };
  videoLinks: {
    youtube?: string;
    vimeo?: string;
  };
  socialLinks: {
    twitter?: string;
    instagram?: string;
    github?: string;
    linkedin?: string;
  };
  badges: string[];
}

// Default profile
const defaultProfile: UserProfile = {
  displayName: "LiTreeCeo",
  username: "litree_ceo",
  bio: "CEO & Founder of LiTreeLabStudios. Building the future of AI agents. Welcome to my corner of the internet!",
  mood: "creative",
  avatarUrl: null,
  coverUrl: null,
  location: "Everywhere",
  website: "https://litlabs.net",
  interests: ["Web Development", "AI", "Music Production", "Entrepreneurship"],
  musicLinks: {},
  videoLinks: {},
  socialLinks: {},
  badges: ["🔥 Early Adopter", "🤖 Agent Builder", "💬 Community"],
};

// Context
interface ProfileContextType {
  profile: UserProfile;
  updateProfile: (updates: Partial<UserProfile>) => void;
  resetProfile: () => void;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [mounted, setMounted] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("litlabs-profile");
    if (stored) {
      try {
        setProfile(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse profile", e);
      }
    }
    setMounted(true);
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    if (mounted) {
      localStorage.setItem("litlabs-profile", JSON.stringify(profile));
    }
  }, [profile, mounted]);

  const updateProfile = (updates: Partial<UserProfile>) => {
    setProfile((prev) => ({ ...prev, ...updates }));
  };

  const resetProfile = () => {
    setProfile(defaultProfile);
  };

  return (
    <ProfileContext.Provider value={{ profile, updateProfile, resetProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error("useProfile must be used within ProfileProvider");
  }
  return context;
}