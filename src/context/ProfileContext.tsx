"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
} from "react";

export type WallpaperId =
  | "default"
  | "gradient"
  | "mesh"
  | "dark"
  | "custom"
  | "nebula"
  | "cyberpunk"
  | "aurora"
  | "matrix"
  | "sunset"
  | "ocean"
  | "forest"
  | "cosmic"
  | "minimal"
  | "glass"
  | "lava"
  | "crystal"
  | "tokyo"
  | "solar"
  | "honeycomb";

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
  wallpaper: WallpaperId;
  customWallpaperUrl: string | null;
  sidebarStyle: "compact" | "comfortable" | "spacious";
  accentColor: string;
}

const defaultProfile: UserProfile = {
  displayName: "Creator",
  username: "creator",
  bio: "Welcome to your creator dashboard. Build agents, generate content, and connect with the community.",
  mood: "creative",
  avatarUrl: null,
  coverUrl: null,
  location: "Everywhere",
  website: process.env.NEXT_PUBLIC_SITE_URL || "https://litlabs.net",
  interests: ["Web Development", "AI", "Music Production", "Entrepreneurship"],
  musicLinks: {},
  videoLinks: {},
  socialLinks: {},
  badges: ["🔥 Early Adopter", "🤖 Agent Creator", "💬 Community"],
  wallpaper: "mesh",
  customWallpaperUrl: null,
  sidebarStyle: "comfortable",
  accentColor: "#fbbf24",
};

interface ProfileContextType {
  profile: UserProfile;
  updateProfile: (updates: Partial<UserProfile>) => void;
  resetProfile: () => void;
  loading: boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

function loadLocal(): UserProfile {
  if (typeof window === "undefined") return defaultProfile;
  try {
    const stored = localStorage.getItem("litlabs-profile");
    if (stored) return { ...defaultProfile, ...JSON.parse(stored) };
  } catch {
    /* ignore */
  }
  return defaultProfile;
}

function saveLocal(profile: UserProfile) {
  try {
    localStorage.setItem("litlabs-profile", JSON.stringify(profile));
  } catch {
    /* ignore */
  }
}

function profileToApi(p: UserProfile) {
  return {
    name: p.displayName,
    username: p.username,
    bio: p.bio,
    location: p.location,
    website: p.website,
    avatar_url: p.avatarUrl,
  };
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [mounted, setMounted] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Hydrate from localStorage after mount
  useEffect(() => {
    const stored = loadLocal();
    setProfile(stored); // eslint-disable-line react-hooks/set-state-in-effect -- valid hydration pattern
    setHydrated(true);
  }, []);

  // Load from API on mount
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    fetch("/api/settings/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data?.user) {
          const api = data.user;
          setProfile((prev) => ({
            ...prev,
            displayName: api.name || prev.displayName,
            username: api.username || prev.username,
            bio: api.bio ?? prev.bio,
            location: api.location ?? prev.location,
            website: api.website ?? prev.website,
            avatarUrl: api.avatar_url ?? prev.avatarUrl,
          }));
        }
      })
      .catch(() => {
        // API unavailable — keep localStorage data
      })
      .finally(() => setLoading(false));
  }, []);

  // Save to localStorage on change + debounce API sync
  useEffect(() => {
    if (!hydrated) return;
    saveLocal(profile);

    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      const body = profileToApi(profile);
      fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {
        // silent fail — localStorage has the data
      });
    }, 2000);

    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [profile, mounted]);

  const updateProfile = useCallback((updates: Partial<UserProfile>) => {
    setProfile((prev) => ({ ...prev, ...updates }));
  }, []);

  const resetProfile = useCallback(() => {
    setProfile(defaultProfile);
  }, []);

  return (
    <ProfileContext.Provider
      value={{ profile, updateProfile, resetProfile, loading }}
    >
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
