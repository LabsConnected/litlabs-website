"use client";

/**
 * MusicTool — the Music studio workspace.
 *
 * Three-column layout:
 *   LEFT  — Music rail (Create / Library / Playlists / Likes / Uploads)
 *   CENTER— Creation surface (Quick Create / Custom / Remix / Upload) +
 *           recent generations as rich TrackCards.
 *   RIGHT — LiTT Producer panel (AI producer chat + one-tap transformations).
 *
 * Playback routes through MusicPlayerContext so audio persists across tool
 * switches; the PersistentMusicPlayer bar (mounted in CommandStudio) shows
 * the transport.
 */

import { useState, useEffect, useCallback, useMemo, type CSSProperties } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useMusicGeneration } from "@/hooks/use-music-generation";
import { useMusicVault, type VaultTrack } from "@/hooks/use-music-vault";
import { useMusicPlayer } from "@/context/MusicPlayerContext";
import {
  Music,
  Wand2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Sparkles,
  X,
  Mic,
  Clock,
  Plus,
  SlidersHorizontal,
  Library,
  Disc3,
  Heart,
  Upload,
  ListMusic,
  Headphones,
  AudioLines,
  Wand,
  Zap,
  Smile,
  Flame,
  Droplets,
  Send,
  Moon,
} from "lucide-react";
import { apiFetch, type ApiJson } from "@/lib/api-response";
import { notifyAssetsChanged } from "../hooks/useAssetsRefresh";
import { useStudioContext } from "../context/StudioContext";
import TrackCard from "../components/music/TrackCard";

const MUSIC_LBC_COST = {
  concept: 8,
  instrumentalFull: 20,
  songFull: 30,
};

const VOCAL_TYPES = [
  { id: "male", label: "Male", desc: "Deep & resonant" },
  { id: "female", label: "Female", desc: "Warm & clear" },
  { id: "choir", label: "Choir", desc: "Layered harmonies" },
  { id: "rap", label: "Rap", desc: "Rhythmic flow" },
  { id: "duo", label: "Duo", desc: "Male + Female" },
  { id: "none", label: "None", desc: "Instrumental only" },
];

const MOODS = ["Dark", "Happy", "Aggressive", "Dreamy", "Epic", "Chill", "Sad", "Energetic", "Mysterious", "Romantic"];

const MUSICAL_KEYS = ["C Major", "C Minor", "C# Major", "C# Minor", "D Major", "D Minor", "E♭ Major", "E♭ Minor", "E Major", "E Minor", "F Major", "F Minor", "F# Major", "F# Minor", "G Major", "G Minor", "A♭ Major", "A♭ Minor", "A Major", "A Minor", "B♭ Major", "B♭ Minor", "B Major", "B Minor"];

const GENRE_PRESETS = [
  "Energetic EDM festival anthem",
  "Dark trap beat with heavy 808s",
  "Dreamy lo-fi hip hop for studying",
  "Uplifting house with piano chords",
  "Aggressive techno for the club",
  "Melancholic piano ballad",
  "Epic orchestral cinematic score",
  "Chillwave retro synthwave",
];

const SURPRISE_PROMPTS = [
  "Dark melodic trap, distorted 808s, eerie female hook, 128 BPM",
  "Sunset deep house with warm analog bass and a single lingering piano note",
  "Lo-fi boom-bap, vinyl crackle, sleepy Rhodes, rainy window mood",
  "Anthemic synthwave, gated drums, neon guitar solo, 110 BPM",
  "Cinematic orchestral build, taiko drums, choir swell, heroic climax",
  "Neo-soul R&B, buttery Wurlitzer, muted trumpet, 2-step groove",
];

type RailTab = "create" | "library" | "playlists" | "likes" | "uploads";
type CreateTab = "quick" | "custom" | "remix" | "upload";

export default function MusicTool() {
  const { resolvedColors: T } = useTheme();
  const accent = T.accentColor || "#a855f7";
  const { setActiveAssetId } = useStudioContext();
  const {
    status,
    progress,
    error: genError,
    lbcCharged,
    lbcRefunded,
    tracks: genTracks,
    isGenerating,
    isCancelling,
    startGeneration,
    cancelGeneration,
  } = useMusicGeneration();
  const { tracks: vaultTracks, loading: vaultLoading, deleteTrack, updateTrack, refresh } = useMusicVault();
  const player = useMusicPlayer();

  const [railTab, setRailTab] = useState<RailTab>("create");
  const [createTab, setCreateTab] = useState<CreateTab>("quick");
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [styles, setStyles] = useState("");
  const [negativeStyles, setNegativeStyles] = useState("");
  const [weirdness, setWeirdness] = useState(35);
  const [styleInfluence] = useState(70);
  const [instrumental, setInstrumental] = useState(false);
  const [duration, setDuration] = useState<"concept" | "full">("concept");
  const [vocalType, setVocalType] = useState("male");
  const [explicit, setExplicit] = useState(false);
  const [lyrics, setLyrics] = useState("");
  const [energy, setEnergy] = useState(5);
  const [mood, setMood] = useState<string>("");
  const [bpm, setBpm] = useState<number>(120);
  const [musicalKey, setMusicalKey] = useState<string>("");
  const [creativity, setCreativity] = useState<number>(50);
  const [promptStrength, setPromptStrength] = useState<number>(70);
  const [seed, setSeed] = useState<string>("");
  const [showLyrics, setShowLyrics] = useState(true);
  const [remixSource, setRemixSource] = useState<VaultTrack | null>(null);
  const [producerMessages, setProducerMessages] = useState<{ role: "user" | "litt"; text: string }[]>([
    { role: "litt", text: "I'm your LiTT Music Producer. Describe a vibe or pick a track and I'll suggest how to make it hit harder." },
  ]);
  const [producerInput, setProducerInput] = useState("");

  const cost = duration === "concept"
    ? MUSIC_LBC_COST.concept
    : instrumental
      ? MUSIC_LBC_COST.instrumentalFull
      : MUSIC_LBC_COST.songFull;

  const generationPrompt = useMemo(() => {
    const parts = [
      prompt.trim(),
      mood ? `Mood: ${mood}.` : "",
      bpm ? `BPM: ${bpm}.` : "",
      musicalKey ? `Key: ${musicalKey}.` : "",
      createTab === "custom" && title.trim() ? `Working title: ${title.trim()}.` : "",
      (createTab === "custom" || styles.trim()) && styles.trim() ? `Style: ${styles.trim()}.` : "",
      (createTab === "custom" || negativeStyles.trim()) && negativeStyles.trim() ? `Avoid: ${negativeStyles.trim()}.` : "",
      createTab === "custom" ? `Creative variation ${weirdness}%. Style influence ${styleInfluence}%.` : "",
      createTab === "custom" ? `Prompt strength ${promptStrength}%. Creativity ${creativity}%.` : "",
      seed.trim() ? `Seed: ${seed.trim()}.` : "",
      remixSource ? `Remix of "${remixSource.title}" — reinterpreting its vibe.` : "",
    ].filter(Boolean);
    return parts.join(" ").slice(0, 600);
  }, [prompt, mood, bpm, musicalKey, createTab, title, styles, negativeStyles, weirdness, styleInfluence, promptStrength, creativity, seed, remixSource]);

  const handleGenerate = useCallback(() => {
    if (!generationPrompt || isGenerating) return;
    void startGeneration({
      prompt: generationPrompt,
      instrumental,
      duration,
      vocalType: instrumental ? undefined : vocalType === "none" ? undefined : vocalType,
      explicit,
      lyrics: instrumental ? undefined : lyrics.trim() || undefined,
      energy,
    });
  }, [generationPrompt, instrumental, duration, vocalType, explicit, lyrics, energy, isGenerating, startGeneration]);

  const handleCancel = useCallback(() => {
    void cancelGeneration();
  }, [cancelGeneration]);

  const handleDelete = useCallback(
    async (track: VaultTrack) => {
      if (player.current?.id === track.id) {
        player.togglePlay();
      }
      await deleteTrack(track.id);
    },
    [deleteTrack, player],
  );

  const handleDownload = useCallback(async (track: VaultTrack) => {
    try {
      const streamData = await apiFetch<ApiJson>(`/api/music/tracks/${track.id}/stream`, { credentials: "include" });
      const url = streamData.url as string;
      const a = document.createElement("a");
      a.href = url;
      a.download = `${track.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.mp3`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      // ignore
    }
  }, []);

  const handleRename = useCallback(
    async (track: VaultTrack, newTitle: string) => {
      await updateTrack(track.id, { title: newTitle });
    },
    [updateTrack],
  );

  const handleShare = useCallback(async (track: VaultTrack) => {
    try {
      await navigator.clipboard.writeText(`https://litlabs.net/track/${track.id}`);
      setProducerMessages((m) => [...m, { role: "litt", text: `Share link copied for "${track.title}".` }]);
    } catch {
      // ignore
    }
  }, []);

  const handleDuplicate = useCallback((track: VaultTrack) => {
    setPrompt(`Inspired by "${track.title}"`);
    setRemixSource(track);
    setCreateTab("remix");
    setRailTab("create");
    setProducerMessages((m) => [...m, { role: "litt", text: `Started a new variation from "${track.title}". Tweak the prompt and generate.` }]);
  }, []);

  const handleUseAsStyle = useCallback((track: VaultTrack) => {
    const genre = track.blueprint?.genre?.join(", ");
    if (genre) setStyles(genre);
    if (track.bpm) setBpm(track.bpm);
    if (track.musical_key) setMusicalKey(track.musical_key);
    setPrompt(`Generate a new track inspired by the sound of "${track.title}"`);
    setCreateTab("custom");
    setRailTab("create");
    setProducerMessages((m) => [...m, { role: "litt", text: `Borrowed the style from "${track.title}" — BPM ${track.bpm ?? "?"}, key ${track.musical_key ?? "?"}. Adjust and generate.` }]);
  }, []);

  const handleRemix = useCallback((track: VaultTrack) => {
    setRemixSource(track);
    setCreateTab("remix");
    setRailTab("create");
    setPrompt(`Remix "${track.title}" — give it a fresh interpretation with a new groove`);
    setProducerMessages((m) => [...m, { role: "litt", text: `Remixing "${track.title}". I'll keep the identity but reshape the energy. Hit GENERATE when ready.` }]);
  }, []);

  const handleExtend = useCallback((track: VaultTrack) => {
    setRemixSource(track);
    setCreateTab("remix");
    setRailTab("create");
    setPrompt(`Extend "${track.title}" — add an intro, verse, hook and outro`);
    setDuration("full");
    setProducerMessages((m) => [...m, { role: "litt", text: `Extending "${track.title}" to a full-length track. I'll add intro → verse → hook → outro structure.` }]);
  }, []);

  const handleEditLyrics = useCallback((track: VaultTrack) => {
    setShowLyrics(true);
    setCreateTab("custom");
    setRailTab("create");
    setProducerMessages((m) => [...m, { role: "litt", text: `Editing lyrics for "${track.title}". Write your new words below, then regenerate.` }]);
  }, []);

  const [isEnhancing, setIsEnhancing] = useState(false);

  const handleImprovePrompt = useCallback(async () => {
    if (!prompt.trim()) {
      setPrompt("A soulful late-night R&B track with warm keys, deep bass, intimate vocals and a huge final chorus at 92 BPM");
      return;
    }
    setIsEnhancing(true);
    try {
      const res = await fetch("/api/music/enhance-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.enhanced) {
          setPrompt(data.enhanced);
          // Auto-fill style fields if provided
          if (data.genre || data.subgenre) {
            const styles = [data.genre, data.subgenre].filter(Boolean).join(", ");
            if (styles) setStyles(styles);
          }
          if (data.tempo) {
            const bpmMatch = data.tempo.match(/(\d+)/);
            if (bpmMatch) setBpm(Number(bpmMatch[1]));
          }
          if (data.key && data.key !== "auto") setMusicalKey(data.key);
        }
      }
    } catch {
      // silent fail — keep original prompt
    } finally {
      setIsEnhancing(false);
    }
  }, [prompt]);

  const handleSurprise = useCallback(() => {
    const pick = SURPRISE_PROMPTS[Math.floor(Math.random() * SURPRISE_PROMPTS.length)];
    setPrompt(pick);
  }, []);

  const [isProducerLoading, setIsProducerLoading] = useState(false);

  const handleProducerSend = useCallback(async () => {
    const text = producerInput.trim();
    if (!text) return;
    setProducerMessages((m) => [...m, { role: "user", text }]);
    setProducerInput("");
    setIsProducerLoading(true);

    try {
      const res = await fetch("/api/music/producer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          prompt: text,
          currentSettings: { mood, bpm, energy, instrumental, vocalType, styles, negativeStyles },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Apply structured changes
        if (data.bpm) setBpm(data.bpm);
        if (data.energy) setEnergy(data.energy);
        if (data.key && data.key !== "auto") setMusicalKey(data.key);
        if (data.styles?.length) setStyles(data.styles.join(", "));
        if (data.avoidStyles?.length) setNegativeStyles(data.avoidStyles.join(", "));
        if (data.vocalDirection && !instrumental) {
          setProducerMessages((m) => [...m, { role: "litt", text: data.producerNote || data.vocalDirection }]);
        } else {
          setProducerMessages((m) => [...m, { role: "litt", text: data.producerNote || "Got it — I've updated the settings. Hit Generate to hear it." }]);
        }
        if (data.enhancedPrompt) {
          setPrompt(data.enhancedPrompt);
        }
      } else {
        setProducerMessages((m) => [...m, { role: "litt", text: "I couldn't process that right now. Try rephrasing or hit Generate with your current settings." }]);
      }
    } catch {
      setProducerMessages((m) => [...m, { role: "litt", text: "Connection issue — try again in a moment." }]);
    } finally {
      setIsProducerLoading(false);
    }
  }, [producerInput, mood, bpm, energy, instrumental, vocalType, styles, negativeStyles]);

  const applyProducerTransform = useCallback(async (kind: "harder" | "catchier" | "emotional" | "variation") => {
    const userText = kind === "harder" ? "Make it harder" : kind === "catchier" ? "Make it catchier" : kind === "emotional" ? "Make it more emotional" : "Generate a variation";
    setProducerMessages((m) => [...m, { role: "user", text: userText }]);
    setIsProducerLoading(true);

    // Apply quick local changes for immediate feedback
    if (kind === "harder") {
      setEnergy((e) => Math.min(10, e + 2));
      setMood("Aggressive");
    } else if (kind === "catchier") {
      setEnergy((e) => Math.max(4, Math.min(8, e + 1)));
      setMood("Happy");
    } else if (kind === "emotional") {
      setEnergy((e) => Math.max(2, e - 2));
      setMood("Sad");
    } else {
      setWeirdness((w) => Math.min(100, w + 15));
    }

    try {
      const res = await fetch("/api/music/producer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          prompt: userText,
          currentSettings: { mood, bpm, energy, instrumental, vocalType, styles, negativeStyles },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.bpm) setBpm(data.bpm);
        if (data.energy) setEnergy(data.energy);
        if (data.styles?.length) setStyles(data.styles.join(", "));
        if (data.enhancedPrompt) setPrompt(data.enhancedPrompt);
        setProducerMessages((m) => [...m, { role: "litt", text: data.producerNote || "Updated — generate to hear the change." }]);
      } else {
        setProducerMessages((m) => [...m, { role: "litt", text: "Updated settings locally. Generate to hear it." }]);
      }
    } catch {
      setProducerMessages((m) => [...m, { role: "litt", text: "Updated settings locally. Generate to hear it." }]);
    } finally {
      setIsProducerLoading(false);
    }
  }, [mood, bpm, energy, instrumental, vocalType, styles, negativeStyles]);

  // Refresh vault when generation completes.
  useEffect(() => {
    if (status === "completed") {
      void refresh();
      // Notify the Asset Lake that new persistent music tracks exist.
      // The server already created music_tracks rows — the Assets
      // panel just needs to refresh to pick them up.
      notifyAssetsChanged();
      // Auto-select the first generated track as the active asset.
      // The canonical Asset Lake ID for music is music_track:<id>.
      if (genTracks.length > 0 && genTracks[0].id) {
        setActiveAssetId(`music_track:${genTracks[0].id}`);
      }
    }
  }, [status, refresh, genTracks, setActiveAssetId]);

  const isBusy = isGenerating || ["queued", "claimed", "preparing", "generating", "processing"].includes(status);

  // ── Style helpers ──────────────────────────────────────────────
  const labelStyle: CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--text-muted)",
  };

  const inputStyle: CSSProperties = {
    background: "var(--studio-surface)",
    border: "1px solid var(--studio-border)",
    borderRadius: 8,
    color: "var(--text-primary)",
    fontSize: 13,
    padding: "8px 12px",
    outline: "none",
    width: "100%",
  };

  const chipBtn: CSSProperties = {
    background: "transparent",
    border: "1px solid var(--studio-border)",
    color: "var(--text-secondary)",
    borderRadius: 999,
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 5,
  };

  const tabBtn = (active: boolean): CSSProperties => ({
    background: active ? `${accent}15` : "transparent",
    border: `1px solid ${active ? accent : "var(--studio-border)"}`,
    color: active ? accent : "var(--text-muted)",
    borderRadius: 8,
    padding: "7px 12px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    gap: 6,
  });

  const railBtn = (active: boolean): CSSProperties => ({
    background: active ? `${accent}12` : "transparent",
    border: "none",
    color: active ? accent : "var(--text-muted)",
    borderRadius: 8,
    padding: "9px 12px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: "100%",
    textAlign: "left",
  });

  const cardStyle: CSSProperties = {
    background: "var(--studio-surface)",
    border: "1px solid var(--studio-border)",
    borderRadius: 12,
    padding: 16,
  };

  // ── Filtered library views ─────────────────────────────────────
  const likedTracks = useMemo(() => vaultTracks.filter(() => false), [vaultTracks]); // likes not yet persisted
  const playlistTracks = useMemo(() => vaultTracks, [vaultTracks]);
  const uploadTracks = useMemo(() => vaultTracks.filter((t) => t.provider === "upload"), [vaultTracks]);
  const libraryTracks = railTab === "likes" ? likedTracks : railTab === "uploads" ? uploadTracks : railTab === "playlists" ? playlistTracks : vaultTracks;

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        overflow: "hidden",
        background: "radial-gradient(circle at 12% 0%, rgba(168,85,247,.08), transparent 28%)",
      }}
    >
      {/* ── LEFT RAIL ────────────────────────────────────────────── */}
      <aside
        style={{
          width: 200,
          minWidth: 200,
          borderRight: "1px solid var(--studio-border)",
          background: "var(--studio-bg)",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          overflowY: "auto",
        }}
        className="music-left-rail"
      >
        <div style={{ ...labelStyle, color: accent, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <Headphones size={12} /> MUSIC
        </div>
        {([
          { id: "create" as const, label: "Create", icon: Wand2 },
          { id: "library" as const, label: "Library", icon: Library },
          { id: "playlists" as const, label: "Playlists", icon: ListMusic },
          { id: "likes" as const, label: "Likes", icon: Heart },
          { id: "uploads" as const, label: "Uploads", icon: Upload },
        ]).map((item) => {
          const Icon = item.icon;
          const count = item.id === "library" ? vaultTracks.length : item.id === "uploads" ? uploadTracks.length : undefined;
          return (
            <button key={item.id} onClick={() => setRailTab(item.id)} style={railBtn(railTab === item.id)}>
              <Icon size={14} />
              <span style={{ flex: 1 }}>{item.label}</span>
              {count !== undefined && (
                <span style={{ fontSize: 10, opacity: 0.6 }}>{count}</span>
              )}
            </button>
          );
        })}

        <div style={{ ...labelStyle, marginTop: 18, marginBottom: 6 }}>Recent</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {vaultTracks.slice(0, 6).map((t) => (
            <button
              key={t.id}
              onClick={() => player.playTrack(
                { id: t.id, title: t.title, version_label: t.version_label, duration: t.duration, bpm: t.bpm, musical_key: t.musical_key, visibility: t.visibility, blueprint: t.blueprint, provider: t.provider, created_at: t.created_at },
                vaultTracks.map((vt) => ({ id: vt.id, title: vt.title, version_label: vt.version_label, duration: vt.duration, bpm: vt.bpm, musical_key: vt.musical_key, visibility: vt.visibility, blueprint: vt.blueprint, provider: vt.provider, created_at: vt.created_at })),
              )}
              style={{
                background: player.current?.id === t.id ? `${accent}12` : "transparent",
                border: "none",
                color: player.current?.id === t.id ? accent : "var(--text-muted)",
                borderRadius: 6,
                padding: "6px 8px",
                cursor: "pointer",
                fontSize: 11,
                textAlign: "left",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {player.current?.id === t.id && player.isPlaying ? "▶ " : ""}
              {t.title}
            </button>
          ))}
          {vaultTracks.length === 0 && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", padding: "6px 8px" }}>No tracks yet</span>
          )}
        </div>
      </aside>

      {/* ── CENTER ───────────────────────────────────────────────── */}
      <main style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "clamp(12px, 2vw, 24px)" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          {/* Header */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ ...labelStyle, color: accent, marginBottom: 6 }}>LiTTree Audio</div>
            <h1 style={{ margin: 0, fontSize: "clamp(22px, 3.5vw, 34px)", lineHeight: 1.05, letterSpacing: "-.04em", color: "var(--text-primary)" }}>
              {railTab === "create" ? "Make the track in your head." : railTab === "library" ? "Your library" : railTab === "playlists" ? "Playlists" : railTab === "likes" ? "Liked tracks" : "Your uploads"}
            </h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
              {railTab === "create"
                ? "Start with one sentence or shape the lyrics, voice, style and production controls yourself."
                : `${libraryTracks.length} track${libraryTracks.length === 1 ? "" : "s"}`}
            </p>
          </div>

          {railTab === "create" ? (
            <>
              {/* Create tabs */}
              <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                {([
                  { id: "quick" as const, label: "Quick Create", icon: Sparkles },
                  { id: "custom" as const, label: "Custom", icon: SlidersHorizontal },
                  { id: "remix" as const, label: "Remix / Extend", icon: Wand },
                  { id: "upload" as const, label: "Upload Audio", icon: Upload },
                ]).map((t) => {
                  const Icon = t.icon;
                  return (
                    <button key={t.id} onClick={() => setCreateTab(t.id)} disabled={isBusy} style={tabBtn(createTab === t.id)}>
                      <Icon size={12} />
                      {t.label}
                    </button>
                  );
                })}
              </div>

              {createTab === "upload" ? (
                <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px" }}>
                  <div style={{ width: 72, height: 72, margin: "0 auto 16px", borderRadius: 18, display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${accent}22, rgba(168,85,247,.18))`, border: "1px solid var(--studio-border)" }}>
                    <Upload size={30} style={{ color: accent }} />
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)", marginBottom: 6 }}>Upload your own audio</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 380, margin: "0 auto 18px", lineHeight: 1.5 }}>
                    Drop an MP3, WAV or FLAC to bring it into your studio library. You can then remix, extend or use it as a style reference.
                  </div>
                  <button style={{ ...tabBtn(true), padding: "10px 20px" }} disabled>
                    <Upload size={14} /> Choose file
                  </button>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 10 }}>Coming soon — upload pipeline in progress</div>
                </div>
              ) : (
                <div style={{ ...cardStyle, padding: "clamp(16px, 2vw, 22px)" }}>
                  {/* Remix source banner */}
                  {createTab === "remix" && remixSource && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 12px", background: `${accent}10`, border: `1px solid ${accent}30`, borderRadius: 10 }}>
                      <Disc3 size={16} style={{ color: accent }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>Source: {remixSource.title}</div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{remixSource.version_label} · {remixSource.provider}</div>
                      </div>
                      <button onClick={() => setRemixSource(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)" }} aria-label="Clear remix source">
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  {/* Big prompt */}
                  <div style={{ ...labelStyle, marginBottom: 6 }}>{createTab === "remix" ? "Describe the remix / extension" : "Describe your song"}</div>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Dark melodic trap, distorted 808s, eerie female hook, 128 BPM…"
                    rows={4}
                    style={{ ...inputStyle, resize: "vertical", minHeight: 110, fontFamily: "inherit", fontSize: 15, lineHeight: 1.55 }}
                    disabled={isBusy}
                  />

                  {/* Prompt chips */}
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    <button onClick={handleImprovePrompt} style={chipBtn} disabled={isBusy || isEnhancing}>
                      {isEnhancing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} {isEnhancing ? "Enhancing…" : "Improve Prompt"}
                    </button>
                    <button onClick={handleSurprise} style={chipBtn} disabled={isBusy}>
                      <Wand2 size={11} /> Surprise Me
                    </button>
                    <button
                      onClick={() => { setInstrumental(false); setVocalType("male"); }}
                      style={{ ...chipBtn, borderColor: !instrumental ? accent : "var(--studio-border)", color: !instrumental ? accent : "var(--text-secondary)" }}
                      disabled={isBusy}
                    >
                      <Mic size={11} /> Vocals
                    </button>
                    <button
                      onClick={() => setInstrumental(true)}
                      style={{ ...chipBtn, borderColor: instrumental ? accent : "var(--studio-border)", color: instrumental ? accent : "var(--text-secondary)" }}
                      disabled={isBusy}
                    >
                      <Music size={11} /> Instrumental
                    </button>
                  </div>

                  {/* Genre presets (quick mode) */}
                  {createTab === "quick" && (
                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      {GENRE_PRESETS.map((preset) => (
                        <button key={preset} onClick={() => setPrompt(preset)} style={chipBtn} disabled={isBusy}>
                          <Sparkles size={10} />
                          {preset.split(" ").slice(0, 3).join(" ")}…
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Custom controls */}
                  {(createTab === "custom" || createTab === "remix") && (
                    <div style={{ marginTop: 16, display: "grid", gap: 12, padding: 14, border: "1px solid var(--studio-border)", borderRadius: 12, background: "rgba(0,0,0,.12)" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                        <label>
                          <span style={{ ...labelStyle, display: "block", marginBottom: 6 }}>Title</span>
                          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled track" style={inputStyle} disabled={isBusy} />
                        </label>
                        <label>
                          <span style={{ ...labelStyle, display: "block", marginBottom: 6 }}>Style</span>
                          <input value={styles} onChange={(e) => setStyles(e.target.value)} placeholder="R&B, neo-soul, cinematic" style={inputStyle} disabled={isBusy} />
                        </label>
                      </div>

                      <label>
                        <span style={{ ...labelStyle, display: "block", marginBottom: 6 }}>Exclude styles</span>
                        <input value={negativeStyles} onChange={(e) => setNegativeStyles(e.target.value)} placeholder="No harsh distortion, no comedy vocals" style={inputStyle} disabled={isBusy} />
                      </label>

                      {/* Mood */}
                      <div>
                        <span style={{ ...labelStyle, display: "block", marginBottom: 6 }}>Mood</span>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {MOODS.map((m) => (
                            <button
                              key={m}
                              onClick={() => setMood(mood === m ? "" : m)}
                              disabled={isBusy}
                              style={{
                                ...chipBtn,
                                background: mood === m ? `${accent}15` : "transparent",
                                borderColor: mood === m ? accent : "var(--studio-border)",
                                color: mood === m ? accent : "var(--text-muted)",
                              }}
                            >
                              {m === "Dark" ? <Moon size={10} /> : m === "Happy" ? <Smile size={10} /> : m === "Aggressive" ? <Flame size={10} /> : m === "Dreamy" ? <Droplets size={10} /> : null}
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* BPM + Key */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <label>
                          <span style={{ ...labelStyle, display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                            <span>BPM</span><b style={{ color: accent }}>{bpm}</b>
                          </span>
                          <input type="range" min={60} max={200} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} disabled={isBusy} style={{ width: "100%", accentColor: accent }} />
                        </label>
                        <label>
                          <span style={{ ...labelStyle, display: "block", marginBottom: 6 }}>Key</span>
                          <select value={musicalKey} onChange={(e) => setMusicalKey(e.target.value)} disabled={isBusy} style={inputStyle}>
                            <option value="">Auto</option>
                            {MUSICAL_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                          </select>
                        </label>
                      </div>

                      {/* Vocals */}
                      {!instrumental && (
                        <div>
                          <span style={{ ...labelStyle, display: "block", marginBottom: 6 }}>Vocals</span>
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            {VOCAL_TYPES.map((v) => (
                              <button
                                key={v.id}
                                onClick={() => setVocalType(v.id)}
                                disabled={isBusy}
                                style={{
                                  ...chipBtn,
                                  background: vocalType === v.id ? `${accent}15` : "transparent",
                                  borderColor: vocalType === v.id ? accent : "var(--studio-border)",
                                  color: vocalType === v.id ? accent : "var(--text-muted)",
                                }}
                                title={v.desc}
                              >
                                {v.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Sliders */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                        <label>
                          <span style={{ ...labelStyle, display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                            <span>Creativity</span><b style={{ color: accent }}>{creativity}%</b>
                          </span>
                          <input type="range" min={0} max={100} value={creativity} onChange={(e) => setCreativity(Number(e.target.value))} disabled={isBusy} style={{ width: "100%", accentColor: accent }} />
                        </label>
                        <label>
                          <span style={{ ...labelStyle, display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                            <span>Prompt Strength</span><b style={{ color: accent }}>{promptStrength}%</b>
                          </span>
                          <input type="range" min={0} max={100} value={promptStrength} onChange={(e) => setPromptStrength(Number(e.target.value))} disabled={isBusy} style={{ width: "100%", accentColor: accent }} />
                        </label>
                        <label>
                          <span style={{ ...labelStyle, display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                            <span>Variation</span><b style={{ color: accent }}>{weirdness}%</b>
                          </span>
                          <input type="range" min={0} max={100} value={weirdness} onChange={(e) => setWeirdness(Number(e.target.value))} disabled={isBusy} style={{ width: "100%", accentColor: accent }} />
                        </label>
                        <label>
                          <span style={{ ...labelStyle, display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                            <span>Energy</span><b style={{ color: accent }}>{energy}/10</b>
                          </span>
                          <input type="range" min={1} max={10} value={energy} onChange={(e) => setEnergy(Number(e.target.value))} disabled={isBusy} style={{ width: "100%", accentColor: accent }} />
                        </label>
                      </div>

                      {/* Seed */}
                      <label>
                        <span style={{ ...labelStyle, display: "block", marginBottom: 6 }}>Seed (optional — reproduce variations)</span>
                        <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="e.g. 42" style={inputStyle} disabled={isBusy} />
                      </label>
                    </div>
                  )}

                  {/* Duration + Explicit */}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ ...labelStyle, marginBottom: 6 }}>Duration</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {(["concept", "full"] as const).map((d) => (
                          <button key={d} onClick={() => setDuration(d)} disabled={isBusy} style={tabBtn(duration === d)}>
                            <Clock size={11} />
                            {d === "concept" ? "30s" : "Full song"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => setExplicit(!explicit)}
                      disabled={isBusy}
                      style={{
                        ...chipBtn,
                        background: explicit ? "#ef444415" : "transparent",
                        borderColor: explicit ? "#ef4444" : "var(--studio-border)",
                        color: explicit ? "#ef4444" : "var(--text-muted)",
                      }}
                    >
                      <AlertTriangle size={11} /> Explicit
                    </button>
                  </div>

                  {/* Lyrics editor */}
                  {!instrumental && (
                    <div style={{ marginTop: 14 }}>
                      <button onClick={() => setShowLyrics(!showLyrics)} style={{ ...chipBtn, marginBottom: showLyrics ? 6 : 0 }}>
                        {showLyrics ? <X size={11} /> : <Plus size={11} />}
                        Lyrics Editor
                      </button>
                      {showLyrics && (
                        <textarea
                          value={lyrics}
                          onChange={(e) => setLyrics(e.target.value)}
                          placeholder={"[Verse 1]\nWrite your lyrics here, or leave blank to let the AI write them…\n\n[Chorus]\n…"}
                          rows={6}
                          style={{ ...inputStyle, resize: "vertical", minHeight: 120, fontFamily: "inherit", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}
                          disabled={isBusy}
                        />
                      )}
                    </div>
                  )}

                  {/* GENERATE button */}
                  <div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center" }}>
                    <button
                      onClick={handleGenerate}
                      disabled={isBusy || !prompt.trim()}
                      style={{
                        flex: 1,
                        background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                        color: "#000",
                        fontWeight: 800,
                        border: "none",
                        borderRadius: 12,
                        padding: "14px 24px",
                        cursor: isBusy || !prompt.trim() ? "not-allowed" : "pointer",
                        opacity: isBusy || !prompt.trim() ? 0.5 : 1,
                        fontSize: 15,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 10,
                        boxShadow: isBusy ? "none" : `0 8px 24px ${accent}33`,
                        transition: "all 0.2s",
                      }}
                    >
                      {isBusy ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                      {isBusy ? "Generating…" : `✨ Generate Track`}
                      {!isBusy && <span style={{ opacity: 0.7, fontSize: 12 }}>{cost} LBC</span>}
                    </button>
                    {isBusy && (
                      <button onClick={handleCancel} disabled={isCancelling} style={{ ...chipBtn, borderColor: "#ef4444", color: "#ef4444", opacity: isCancelling ? 0.6 : 1 }}>
                        {isCancelling ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                        {isCancelling ? "Cancelling…" : "Cancel"}
                      </button>
                    )}
                  </div>

                  {/* Progress */}
                  {isBusy && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ height: 4, background: "var(--studio-border)", borderRadius: 2, overflow: "hidden" }}>
                        {progress > 0 ? (
                          <div style={{ height: "100%", width: `${progress}%`, background: `linear-gradient(90deg, ${accent}, ${accent})`, transition: "width 0.5s ease" }} />
                        ) : (
                          <div style={{ height: "100%", width: "40%", background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, animation: "music-progress-indeterminate 1.5s ease-in-out infinite" }} />
                        )}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                        <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "capitalize" }}>
                          {status === "queued" ? "Queued — waiting for producer" :
                           status === "preparing" ? "Preparing — building blueprint" :
                           status === "generating" ? "Writing — composing your track" :
                           status === "processing" ? "Rendering — saving audio" :
                           `${status}…`}
                        </span>
                        {progress > 0 && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{progress}%</span>}
                      </div>
                    </div>
                  )}

                  {/* Error / refund */}
                  {genError && (
                    <div style={{ marginTop: 12, padding: "10px 12px", background: "#ef444410", border: "1px solid #ef444430", borderRadius: 8, display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <AlertTriangle size={14} style={{ color: "#ef4444", flexShrink: 0, marginTop: 1 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: "#ef4444", fontWeight: 600 }}>{genError}</div>
                        {lbcRefunded && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Your {lbcCharged} LBC has been refunded.</div>}
                        {!isBusy && prompt.trim() && (
                          <button onClick={handleGenerate} style={{ ...chipBtn, marginTop: 8, borderColor: "#ef4444", color: "#ef4444" }}>
                            <RefreshCw size={11} /> Retry
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Success */}
                  {status === "completed" && genTracks.length > 0 && (
                    <div style={{ marginTop: 12, padding: "10px 12px", background: "#22c55e10", border: "1px solid #22c55e30", borderRadius: 8, display: "flex", alignItems: "center", gap: 8 }}>
                      <CheckCircle2 size={14} style={{ color: "#22c55e" }} />
                      <span style={{ fontSize: 12, color: "#22c55e", fontWeight: 600 }}>
                        Generated {genTracks.length} track{genTracks.length > 1 ? "s" : ""}! Scroll down to listen.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Recent generations */}
              <div style={{ marginTop: 22 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <AudioLines size={14} style={{ color: accent }} />
                  <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text-primary)" }}>Recent Generations</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>({vaultTracks.length})</span>
                  <button onClick={() => void refresh()} style={{ ...chipBtn, marginLeft: "auto", padding: "4px 10px" }}>
                    <RefreshCw size={11} /> Refresh
                  </button>
                </div>

                {vaultLoading ? (
                  <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)", fontSize: 12 }}>
                    <Loader2 size={22} className="animate-spin" style={{ margin: "0 auto 8px" }} />
                    Loading tracks…
                  </div>
                ) : vaultTracks.length === 0 ? (
                  <div style={{ ...cardStyle, textAlign: "center", padding: "40px 20px" }}>
                    <div style={{ width: 76, height: 76, margin: "0 auto 16px", borderRadius: 18, display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${accent}22, rgba(168,85,247,.18))`, border: "1px solid var(--studio-border)" }}>
                      <Music size={30} style={{ color: accent, opacity: 0.8 }} />
                    </div>
                    <div style={{ fontSize: 15, color: "var(--text-primary)", fontWeight: 800, marginBottom: 6 }}>Your next sound starts here</div>
                    <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>Generate a pair of versions, compare them, then keep building from the strongest idea.</div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {vaultTracks.map((track) => (
                      <TrackCard
                        key={track.id}
                        track={track}
                        accent={accent}
                        queue={vaultTracks}
                        onRemix={handleRemix}
                        onExtend={handleExtend}
                        onEditLyrics={handleEditLyrics}
                        onRename={handleRename}
                        onDelete={handleDelete}
                        onDownload={handleDownload}
                        onShare={handleShare}
                        onDuplicate={handleDuplicate}
                        onUseAsStyle={handleUseAsStyle}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Library / Playlists / Likes / Uploads view */
            <div>
              {vaultLoading ? (
                <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)", fontSize: 12 }}>
                  <Loader2 size={22} className="animate-spin" style={{ margin: "0 auto 8px" }} />
                  Loading…
                </div>
              ) : libraryTracks.length === 0 ? (
                <div style={{ ...cardStyle, textAlign: "center", padding: "40px 20px" }}>
                  <div style={{ width: 64, height: 64, margin: "0 auto 14px", borderRadius: 16, display: "grid", placeItems: "center", background: `${accent}12`, border: "1px solid var(--studio-border)" }}>
                    {railTab === "likes" ? <Heart size={26} style={{ color: accent }} /> : railTab === "uploads" ? <Upload size={26} style={{ color: accent }} /> : <Library size={26} style={{ color: accent }} />}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-primary)", marginBottom: 4 }}>
                    {railTab === "likes" ? "No liked tracks yet" : railTab === "uploads" ? "No uploads yet" : "Nothing here yet"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {railTab === "likes" ? "Tap the heart on a track to save it here." : railTab === "uploads" ? "Upload audio to bring it into your studio." : "Generate tracks and they'll show up here."}
                  </div>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {libraryTracks.map((track) => (
                    <TrackCard
                      key={track.id}
                      track={track}
                      accent={accent}
                      queue={libraryTracks}
                      onRemix={handleRemix}
                      onExtend={handleExtend}
                      onEditLyrics={handleEditLyrics}
                      onRename={handleRename}
                      onDelete={handleDelete}
                      onDownload={handleDownload}
                      onShare={handleShare}
                      onDuplicate={handleDuplicate}
                      onUseAsStyle={handleUseAsStyle}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── RIGHT: LiTT PRODUCER ─────────────────────────────────── */}
      <aside
        style={{
          width: 300,
          minWidth: 300,
          borderLeft: "1px solid var(--studio-border)",
          background: "var(--studio-bg)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        className="music-producer-panel"
      >
        <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--studio-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${accent}, ${accent}88)`, display: "grid", placeItems: "center" }}>
              <Wand2 size={14} style={{ color: "#000" }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-primary)" }}>LiTT — Music Producer</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>AI co-producer</div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {producerMessages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "92%",
                padding: "8px 12px",
                borderRadius: 12,
                fontSize: 12,
                lineHeight: 1.5,
                background: m.role === "user" ? `${accent}18` : "var(--studio-surface)",
                border: m.role === "user" ? `1px solid ${accent}30` : "1px solid var(--studio-border)",
                color: "var(--text-primary)",
              }}
            >
              {m.text}
            </div>
          ))}
        </div>

        {/* Quick transforms */}
        <div style={{ padding: "8px 14px", display: "flex", gap: 5, flexWrap: "wrap", borderTop: "1px solid var(--studio-border)" }}>
          {([
            { id: "harder" as const, label: "Make Harder", icon: Flame },
            { id: "catchier" as const, label: "Make Catchier", icon: Zap },
            { id: "emotional" as const, label: "More Emotional", icon: Droplets },
            { id: "variation" as const, label: "Variation", icon: Wand2 },
          ]).map((b) => {
            const Icon = b.icon;
            return (
              <button key={b.id} onClick={() => applyProducerTransform(b.id)} disabled={isProducerLoading} style={{ ...chipBtn, fontSize: 10, padding: "5px 9px", opacity: isProducerLoading ? 0.6 : 1 }}>
                {isProducerLoading ? <Loader2 size={10} className="animate-spin" /> : <Icon size={10} />}
                {b.label}
              </button>
            );
          })}
        </div>

        {/* Input */}
        <div style={{ padding: 12, borderTop: "1px solid var(--studio-border)", display: "flex", gap: 8 }}>
          <input
            value={producerInput}
            onChange={(e) => setProducerInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleProducerSend(); }}
            placeholder="Make this beat catchier…"
            style={{ ...inputStyle, fontSize: 12 }}
          />
          <button onClick={handleProducerSend} disabled={isProducerLoading} style={{ background: `${accent}18`, border: `1px solid ${accent}30`, color: accent, borderRadius: 8, padding: "0 10px", cursor: "pointer", display: "grid", placeItems: "center", opacity: isProducerLoading ? 0.6 : 1 }} aria-label="Send to producer">
            {isProducerLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </aside>
    </div>
  );
}
