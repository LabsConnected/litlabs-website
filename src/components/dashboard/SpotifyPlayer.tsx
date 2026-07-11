"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Search, Music2,
  ExternalLink, LogOut, Loader2, AlertCircle,
} from "lucide-react";

const ACCENT = "#1DB954"; // Spotify green
const CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID ?? "";
const REDIRECT_URI = `${typeof window !== "undefined" ? window.location.origin : "https://litlabs.net"}/api/auth/spotify/callback`;
const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
].join(" ");

interface SpotifyTrack {
  id: string;
  spotifyId: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  preview_url: string | null;
  uri: string;
}

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady: () => void;
    Spotify: {
      Player: new (config: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume: number;
      }) => SpotifyPlayerInstance;
    };
  }
}

interface SpotifyPlayerInstance {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (data: unknown) => void): void;
  removeListener(event: string, cb?: (data: unknown) => void): void;
  getCurrentState(): Promise<SpotifyState | null>;
  setVolume(v: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  previousTrack(): Promise<void>;
  nextTrack(): Promise<void>;
  seek(ms: number): Promise<void>;
}

interface SpotifyState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: {
    current_track: {
      id: string;
      name: string;
      artists: { name: string }[];
      album: { name: string; images: { url: string }[] };
      uri: string;
      duration_ms: number;
    };
  };
}

function formatTime(s: number) {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function connectToSpotify() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    show_dialog: "true",
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

export default function SpotifyPlayer() {
  const { resolvedColors: T } = useTheme();
  const playerRef = useRef<SpotifyPlayerInstance | null>(null);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  const [connected, setConnected] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [state, setState] = useState<SpotifyState | null>(null);
  const [volume, setVolume] = useState(70);
  const [muted, setMuted] = useState(false);
  const [position, setPosition] = useState(0);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPremium, setIsPremium] = useState<boolean | null>(null);

  const currentTrack = state?.track_window?.current_track;
  const playing = state ? !state.paused : false;
  const duration = state?.duration ?? 0;

  const checkPremium = useCallback(async (token: string) => {
    try {
      const res = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setIsPremium(data.product === "premium");
    } catch { /* silent */ }
  }, []);

  /* ── Check if already connected ─────────────────────────────── */
  useEffect(() => {
    fetch("/api/spotify/token")
      .then((r) => r.json())
      .then((d) => {
        if (d.access_token) {
          setConnected(true);
          checkPremium(d.access_token);
        }
      })
      .catch(() => {});

    // Check URL params for OAuth return
    const params = new URLSearchParams(window.location.search);
    const spotifyParam = params.get("spotify");
    if (spotifyParam === "connected") {
      window.history.replaceState({}, "", window.location.pathname + "?app=music");
      queueMicrotask(() => setConnected(true));
    } else if (spotifyParam === "error") {
      window.history.replaceState({}, "", window.location.pathname + "?app=music");
      queueMicrotask(() => setError("Spotify connection failed. Try again."));
    }
  }, [checkPremium]);

  /* ── Load Spotify Web Playback SDK ───────────────────────────── */
  useEffect(() => {
    if (!connected || typeof window === "undefined") return;

    if (window.Spotify) { queueMicrotask(() => setSdkReady(true)); return; }

    window.onSpotifyWebPlaybackSDKReady = () => setSdkReady(true);
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    document.body.appendChild(script);

    return () => { document.body.removeChild(script); };
  }, [connected]);

  /* ── Init player once SDK is ready ──────────────────────────── */
  useEffect(() => {
    if (!sdkReady || !isPremium) return;

    const player = new window.Spotify.Player({
      name: "LiTT Code LabStudios",
      getOAuthToken: async (cb) => {
        const res = await fetch("/api/spotify/token");
        const data = await res.json();
        if (data.access_token) cb(data.access_token);
      },
      volume: volume / 100,
    });

    player.addListener("ready", (data) => {
      const { device_id } = data as { device_id: string };
      setDeviceId(device_id);
      // Transfer playback to this device
      fetch("/api/spotify/player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "transfer", device_id }),
      });
    });

    player.addListener("player_state_changed", (s) => {
      if (s) setState(s as SpotifyState);
    });

    player.addListener("not_ready", () => setDeviceId(null));
    player.addListener("initialization_error", () => setError("Player failed to init."));
    player.addListener("authentication_error", () => setError("Auth error — reconnect Spotify."));
    player.addListener("account_error", () => {
      setIsPremium(false);
      setError("Spotify Premium required for full playback.");
    });

    player.connect();
    playerRef.current = player;

    return () => { player.disconnect(); playerRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkReady, isPremium]);

  /* ── Progress ticker ─────────────────────────────────────────── */
  useEffect(() => {
    if (progressInterval.current) clearInterval(progressInterval.current);
    if (playing) {
      progressInterval.current = setInterval(() => {
        setPosition((p) => Math.min(p + 1000, duration));
      }, 1000);
    }
    return () => { if (progressInterval.current) clearInterval(progressInterval.current); };
  }, [playing, duration]);

  // Derive position directly from state — no extra effect needed

  /* ── Controls ────────────────────────────────────────────────── */
  const togglePlay = async () => {
    const p = playerRef.current;
    if (!p) return;
    if (playing) await p.pause();
    else await p.resume();
  };

  const prev = () => playerRef.current?.previousTrack();
  const next = () => playerRef.current?.nextTrack();

  const seek = (ms: number) => {
    playerRef.current?.seek(ms);
    setPosition(ms);
  };

  const changeVolume = useCallback(async (v: number) => {
    setVolume(v);
    setMuted(false);
    await playerRef.current?.setVolume(v / 100);
  }, []);

  const toggleMute = useCallback(async () => {
    const next = !muted;
    setMuted(next);
    await playerRef.current?.setVolume(next ? 0 : volume / 100);
  }, [muted, volume]);

  /* ── Search ──────────────────────────────────────────────────── */
  const doSearch = async () => {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(search)}&limit=15`);
      const data = await res.json();
      setResults(data.tracks ?? []);
    } catch { setError("Search failed."); }
    finally { setSearching(false); }
  };

  const playTrack = async (uri: string) => {
    if (!deviceId) { setError("Player not ready yet."); return; }
    await fetch("/api/spotify/player", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "play", device_id: deviceId, uri }),
    });
  };

  const playPreview = (url: string) => {
    const audio = new Audio(url);
    audio.volume = (muted ? 0 : volume) / 100;
    audio.play().catch(() => {});
  };

  const disconnect = async () => {
    playerRef.current?.disconnect();
    await fetch("/api/spotify/token", { method: "DELETE" });
    setConnected(false);
    setDeviceId(null);
    setState(null);
    setIsPremium(null);
  };

  /* ══════════════════════════════════════════════════════════════
     NOT CONNECTED
  ══════════════════════════════════════════════════════════════ */
  if (!connected) {
    return (
      <div className="rounded-2xl p-8 flex flex-col items-center gap-5 text-center"
        style={{ backgroundColor: `${T.boxBg}80`, border: `1px solid ${ACCENT}20` }}>
        <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: ACCENT + "20", border: `2px solid ${ACCENT}40` }}>
          <Music2 size={28} style={{ color: ACCENT }} />
        </div>
        <div>
          <div className="text-base font-black mb-1" style={{ color: T.textColor }}>Connect Spotify</div>
          <div className="text-xs" style={{ color: T.textMuted }}>Stream your music directly in LiTT Code LabStudios</div>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: "#ff444420", color: "#ff4444" }}>
            <AlertCircle size={13} /> {error}
          </div>
        )}
        <button onClick={connectToSpotify}
          className="px-6 py-2.5 rounded-full text-sm font-black transition-all hover:scale-105 active:scale-95"
          style={{ backgroundColor: ACCENT, color: "#000" }}>
          Connect with Spotify
        </button>
        <p className="text-[10px]" style={{ color: T.textMuted }}>
          Full streaming requires Spotify Premium · Free accounts get 30s previews
        </p>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════
     CONNECTED — FREE TIER (search + preview only)
  ══════════════════════════════════════════════════════════════ */
  if (isPremium === false) {
    return (
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: `${T.boxBg}80`, border: `1px solid ${ACCENT}20` }}>
        <div className="p-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${T.borderColor}15` }}>
          <div className="flex items-center gap-2">
            <Music2 size={14} style={{ color: ACCENT }} />
            <span className="text-xs font-bold" style={{ color: T.textColor }}>Spotify</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: "#fbbf2420", color: "#fbbf24" }}>FREE</span>
          </div>
          <button onClick={disconnect} className="p-1.5 rounded-lg hover:bg-white/10" style={{ color: T.textMuted }} title="Disconnect">
            <LogOut size={13} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-[10px] px-3 py-2 rounded-lg" style={{ backgroundColor: "#fbbf2415", color: "#fbbf24" }}>
            ⚡ Upgrade to Spotify Premium for full streaming. Free tier = 30s previews only.
          </div>

          {/* Search */}
          <div className="flex gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              placeholder="Search Spotify…"
              className="flex-1 text-xs px-3 py-1.5 rounded-lg outline-none"
              style={{ backgroundColor: T.bgColor + "80", border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
            <button onClick={doSearch} disabled={searching}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
              style={{ backgroundColor: ACCENT, color: "#000" }}>
              {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            </button>
          </div>

          {/* Results */}
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {results.map((t) => (
              <div key={t.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-all group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {t.cover ? <img src={t.cover} alt={t.title} className="w-9 h-9 rounded object-cover shrink-0" /> : <div className="w-9 h-9 rounded shrink-0" style={{ backgroundColor: ACCENT + "20" }} />}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold truncate" style={{ color: T.textColor }}>{t.title}</div>
                  <div className="text-[10px] truncate" style={{ color: T.textMuted }}>{t.artist} · {t.album}</div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {t.preview_url && (
                    <button onClick={() => playPreview(t.preview_url!)}
                      className="p-1.5 rounded-full text-[10px] font-bold"
                      style={{ backgroundColor: ACCENT, color: "#000" }} title="Preview 30s">
                      <Play size={10} />
                    </button>
                  )}
                  <a href={`https://open.spotify.com/track/${t.spotifyId}`} target="_blank" rel="noopener noreferrer"
                    className="p-1.5 rounded hover:bg-white/10" style={{ color: T.textMuted }}>
                    <ExternalLink size={11} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════
     CONNECTED — PREMIUM (full SDK playback)
  ══════════════════════════════════════════════════════════════ */
  return (
    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: `${T.boxBg}80`, border: `1px solid ${ACCENT}20` }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ background: `linear-gradient(90deg, ${ACCENT}15, transparent)`, borderBottom: `1px solid ${T.borderColor}15` }}>
        <div className="flex items-center gap-2">
          <Music2 size={14} style={{ color: ACCENT }} />
          <span className="text-xs font-bold" style={{ color: T.textColor }}>Spotify</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: ACCENT + "20", color: ACCENT }}>PREMIUM</span>
          {!deviceId && <Loader2 size={11} className="animate-spin" style={{ color: T.textMuted }} />}
        </div>
        <button onClick={disconnect} className="p-1.5 rounded-lg hover:bg-white/10 transition-all" style={{ color: T.textMuted }} title="Disconnect Spotify">
          <LogOut size={13} />
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 text-[10px] px-3 py-2 rounded-lg" style={{ backgroundColor: "#ff444420", color: "#ff4444" }}>
          <AlertCircle size={11} /> {error}
          <button onClick={() => setError(null)} className="ml-auto">✕</button>
        </div>
      )}

      {/* Now playing */}
      <div className="p-5 pb-3" style={{ background: `linear-gradient(180deg, ${ACCENT}08 0%, transparent 100%)` }}>
        <div className="flex items-center gap-4 mb-4">
          {currentTrack?.album.images[0]?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentTrack.album.images[0].url} alt={currentTrack.name}
              className="w-20 h-20 rounded-xl object-cover shadow-lg shrink-0" />
          ) : (
            <div className="w-20 h-20 rounded-xl shrink-0 flex items-center justify-center"
              style={{ backgroundColor: ACCENT + "20", border: `1px solid ${ACCENT}30` }}>
              <Music2 size={28} style={{ color: ACCENT, opacity: 0.5 }} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-base font-black truncate" style={{ color: T.textColor }}>
              {currentTrack?.name ?? "Nothing playing"}
            </div>
            <div className="text-sm truncate mb-1" style={{ color: T.textMuted }}>
              {currentTrack?.artists.map((a) => a.name).join(", ") ?? "Play a track to start"}
            </div>
            {currentTrack && (
              <a href={`https://open.spotify.com/track/${currentTrack.id}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[9px] font-bold hover:opacity-70 transition-opacity"
                style={{ color: T.textMuted }}>
                <ExternalLink size={9} /> Open in Spotify
              </a>
            )}
          </div>
        </div>

        {/* Progress */}
        <div className="space-y-1 mb-4">
          <div className="relative h-2 rounded-full cursor-pointer group" style={{ backgroundColor: T.borderColor + "30" }}
            onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); seek(Math.round(((e.clientX - rect.left) / rect.width) * duration)); }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${duration ? (position / duration) * 100 : 0}%`, backgroundColor: ACCENT, boxShadow: `0 0 8px ${ACCENT}60` }} />
          </div>
          <div className="flex justify-between text-[10px]" style={{ color: T.textMuted }}>
            <span>{formatTime(position / 1000)}</span>
            <span>{formatTime(duration / 1000)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 mb-4">
          <button onClick={prev} className="p-2 rounded-lg hover:bg-white/10 transition-all" style={{ color: T.textColor }}>
            <SkipBack size={20} />
          </button>
          <button onClick={togglePlay} disabled={!deviceId}
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95 disabled:opacity-40"
            style={{ backgroundColor: ACCENT, color: "#000", boxShadow: `0 0 24px ${ACCENT}50` }}>
            {playing ? <Pause size={22} /> : <Play size={22} />}
          </button>
          <button onClick={next} className="p-2 rounded-lg hover:bg-white/10 transition-all" style={{ color: T.textColor }}>
            <SkipForward size={20} />
          </button>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-3">
          <button onClick={toggleMute} className="shrink-0" style={{ color: T.textMuted }}>
            {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <div className="relative flex-1 h-2 rounded-full cursor-pointer" style={{ backgroundColor: T.borderColor + "30" }}
            onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); changeVolume(Math.round(((e.clientX - rect.left) / rect.width) * 100)); }}>
            <div className="h-full rounded-full" style={{ width: `${muted ? 0 : volume}%`, backgroundColor: T.textMuted }} />
          </div>
          <span className="text-[10px] w-8 text-right shrink-0" style={{ color: T.textMuted }}>{muted ? 0 : volume}%</span>
        </div>
      </div>

      {/* Search */}
      <div style={{ borderTop: `1px solid ${T.borderColor}15` }}>
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              placeholder="Search Spotify…"
              className="flex-1 text-xs px-3 py-1.5 rounded-lg outline-none"
              style={{ backgroundColor: T.bgColor + "80", border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
            <button onClick={doSearch} disabled={searching}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
              style={{ backgroundColor: ACCENT, color: "#000" }}>
              {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            </button>
          </div>

          <div className="space-y-1 max-h-64 overflow-y-auto">
            {results.map((t) => (
              <button key={t.id} onClick={() => playTrack(t.uri)}
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-all text-left group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {t.cover ? <img src={t.cover} alt={t.title} className="w-9 h-9 rounded object-cover shrink-0" /> : <div className="w-9 h-9 rounded shrink-0" style={{ backgroundColor: ACCENT + "20" }} />}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold truncate" style={{ color: T.textColor }}>{t.title}</div>
                  <div className="text-[10px] truncate" style={{ color: T.textMuted }}>{t.artist} · {t.album}</div>
                </div>
                <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: ACCENT }}>
                    <Play size={11} style={{ color: "#000" }} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
