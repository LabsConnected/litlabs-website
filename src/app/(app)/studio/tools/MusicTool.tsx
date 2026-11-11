"use client";

/**
 * MusicTool — the Music studio workspace.
 *
 * Two-column layout:
 *   LEFT  — Music rail (Create / Library / Playlists / Likes / Uploads)
 *   CENTER— Creation surface (Quick Create / Custom / Remix) +
 *           recent generations as rich TrackCards.
 *
 * ONE-PROMPT contract (ART-20261111-035): this pane carries NO chat and
 * NO prompt box. The old right-rail producer chat and the
 * center "Describe your song" textarea are gone. A generation request
 * arrives from the one LiTT chat (staged read-only via the P1-1
 * initialPrompt channel) or is composed from the pane's non-text
 * controls (genre presets, style/mood chips, sliders, toggles); the
 * staged prompt is displayed as text, never typed into here. The old
 * producer tricks survive as local controls (quick transforms) that
 * adjust the same parameters directly.
 *
 * Playback routes through MusicPlayerContext so audio persists across tool
 * switches; the PersistentMusicPlayer bar (mounted in CommandStudio) shows
 * the transport.
 */

import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from "react";
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

// Style is picked with chips (a control), never typed: the selected
// tokens join into the same comma-joined `styles` string the generation
// prompt has always consumed. Tokens staged from a track ("Use as
// style") that are not in this list still render as removable chips.
const STYLE_OPTIONS = [
  "R&B", "Neo-Soul", "Cinematic", "Trap", "House", "Lo-Fi", "Synthwave",
  "Orchestral", "Jazz", "Rock", "Ambient", "Techno", "EDM", "Hip Hop",
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
type CreateTab = "quick" | "custom" | "remix";

export default function MusicTool({ initialPrompt }: { initialPrompt?: string | null }) {
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
  // The generation prompt is STAGED, never typed in this pane: it comes
  // from the one chat (initialPrompt), a genre preset / surprise pick, a
  // track action, or the prompt enhancer — and is shown read-only.
  const [stagedPrompt, setStagedPrompt] = useState(initialPrompt ?? "");
  const lastInitialPromptRef = useRef(initialPrompt);
  useEffect(() => {
    if (initialPrompt && initialPrompt !== lastInitialPromptRef.current) {
      lastInitialPromptRef.current = initialPrompt;
      setStagedPrompt(initialPrompt);
    }
  }, [initialPrompt]);
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
  // One-line pane feedback for track actions / transforms (the old
  // producer chat's only remaining job) — a status line, not a chat.
  const [notice, setNotice] = useState<string | null>(null);

  const cost = duration === "concept"
    ? MUSIC_LBC_COST.concept
    : instrumental
      ? MUSIC_LBC_COST.instrumentalFull
      : MUSIC_LBC_COST.songFull;

  // Generate needs SOME direction: a staged prompt, a style, or a mood.
  // (The parameter chips/sliders always contribute BPM/key/etc., so they
  // don't count — direction is what the old prompt box used to provide.)
  const hasDirection = Boolean(stagedPrompt.trim() || styles.trim() || mood);

  // Style selection state for the chips (the `styles` string itself is
  // unchanged — tokens join with ", " exactly as the typed field did).
  const styleTokens = useMemo(
    () => styles.split(",").map((s) => s.trim()).filter(Boolean),
    [styles],
  );
  const toggleStyle = useCallback((token: string) => {
    setStyles((prev) => {
      const tokens = prev.split(",").map((s) => s.trim()).filter(Boolean);
      return (tokens.includes(token)
        ? tokens.filter((t) => t !== token)
        : [...tokens, token]
      ).join(", ");
    });
  }, []);

  const generationPrompt = useMemo(() => {
    const parts = [
      stagedPrompt.trim(),
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
  }, [stagedPrompt, mood, bpm, musicalKey, createTab, title, styles, negativeStyles, weirdness, styleInfluence, promptStrength, creativity, seed, remixSource]);

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
      setNotice(`Share link copied for "${track.title}".`);
    } catch {
      // ignore
    }
  }, []);

  const handleDuplicate = useCallback((track: VaultTrack) => {
    setStagedPrompt(`Inspired by "${track.title}"`);
    setRemixSource(track);
    setCreateTab("remix");
    setRailTab("create");
    setNotice(`Started a new variation from "${track.title}" — staged above. Adjust the controls and generate.`);
  }, []);

  const handleUseAsStyle = useCallback((track: VaultTrack) => {
    const genre = track.blueprint?.genre?.join(", ");
    if (genre) setStyles(genre);
    if (track.bpm) setBpm(track.bpm);
    if (track.musical_key) setMusicalKey(track.musical_key);
    setStagedPrompt(`Generate a new track inspired by the sound of "${track.title}"`);
    setCreateTab("custom");
    setRailTab("create");
    setNotice(`Borrowed the style from "${track.title}" — BPM ${track.bpm ?? "?"}, key ${track.musical_key ?? "?"}. Adjust and generate.`);
  }, []);

  const handleRemix = useCallback((track: VaultTrack) => {
    setRemixSource(track);
    setCreateTab("remix");
    setRailTab("create");
    setStagedPrompt(`Remix "${track.title}" — give it a fresh interpretation with a new groove`);
    setNotice(`Remixing "${track.title}" — the identity stays, the energy gets reshaped. Hit Generate when ready.`);
  }, []);

  const handleExtend = useCallback((track: VaultTrack) => {
    setRemixSource(track);
    setCreateTab("remix");
    setRailTab("create");
    setStagedPrompt(`Extend "${track.title}" — add an intro, verse, hook and outro`);
    setDuration("full");
    setNotice(`Extending "${track.title}" to a full-length track with intro → verse → hook → outro structure.`);
  }, []);

  const handleEditLyrics = useCallback((track: VaultTrack) => {
    setShowLyrics(true);
    setCreateTab("custom");
    setRailTab("create");
    setNotice(`Editing lyrics for "${track.title}" — write your new words in the lyrics editor, then regenerate.`);
  }, []);

  const [isEnhancing, setIsEnhancing] = useState(false);

  const handleImprovePrompt = useCallback(async () => {
    if (!stagedPrompt.trim()) {
      setStagedPrompt("A soulful late-night R&B track with warm keys, deep bass, intimate vocals and a huge final chorus at 92 BPM");
      return;
    }
    setIsEnhancing(true);
    try {
      const res = await fetch("/api/music/enhance-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt: stagedPrompt }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.enhanced) {
          setStagedPrompt(data.enhanced);
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
  }, [stagedPrompt]);

  const handleSurprise = useCallback(() => {
    const pick = SURPRISE_PROMPTS[Math.floor(Math.random() * SURPRISE_PROMPTS.length)];
    setStagedPrompt(pick);
  }, []);

  // Quick transforms — the old producer panel's one-tap tricks, now
  // plain local CONTROLS (one-prompt contract): each applies the exact
  // parameter change it names, immediately and observably, with no chat
  // round-trip. Anything conversational belongs in the one LiTT chat.
  const applyQuickTransform = useCallback((kind: "harder" | "catchier" | "emotional" | "variation") => {
    if (kind === "harder") {
      setEnergy((e) => Math.min(10, e + 2));
      setMood("Aggressive");
      setNotice("Staged harder: energy up, mood set to Aggressive. Generate to hear it.");
    } else if (kind === "catchier") {
      setEnergy((e) => Math.max(4, Math.min(8, e + 1)));
      setMood("Happy");
      setNotice("Staged catchier: energy nudged up, mood set to Happy. Generate to hear it.");
    } else if (kind === "emotional") {
      setEnergy((e) => Math.max(2, e - 2));
      setMood("Sad");
      setNotice("Staged more emotional: energy down, mood set to Sad. Generate to hear it.");
    } else {
      setWeirdness((w) => Math.min(100, w + 15));
      setNotice("Staged a variation: variation amount raised. Generate to hear it.");
    }
  }, []);

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
        <div style={{ maxWidth: 1040, margin: "0 auto" }}>
          {/* Header */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ ...labelStyle, color: accent, marginBottom: 6 }}>LiTTree Audio</div>
            <h1 style={{ margin: 0, fontSize: "clamp(22px, 3.5vw, 34px)", lineHeight: 1.05, letterSpacing: "-.04em", color: "var(--text-primary)" }}>
              {railTab === "create" ? "Make the track in your head." : railTab === "library" ? "Your library" : railTab === "playlists" ? "Playlists" : railTab === "likes" ? "Liked tracks" : "Your uploads"}
            </h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
              {railTab === "create"
                ? "Ask LiTT in the chat, or stage a track here with the preset, style, mood and production controls."
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

              {
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

                  {/* Staged prompt — READ-ONLY (one-prompt contract).
                      Requests arrive from the one chat or are composed
                      from the controls in this card; this pane never
                      takes typed prompt text. */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={labelStyle}>{createTab === "remix" ? "Remix / extension — staged prompt" : "Staged prompt"}</div>
                    {stagedPrompt.trim() && (
                      <button onClick={() => setStagedPrompt("")} disabled={isBusy} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700 }} aria-label="Clear staged prompt">
                        <X size={11} /> Clear
                      </button>
                    )}
                  </div>
                  <div
                    data-testid="music-staged-prompt"
                    style={{ ...inputStyle, minHeight: 74, fontSize: 14, lineHeight: 1.55, color: stagedPrompt.trim() ? "var(--text-primary)" : "var(--text-muted)", whiteSpace: "pre-wrap" }}
                  >
                    {stagedPrompt.trim()
                      ? stagedPrompt
                      : "Ask LiTT in the chat to make a track — or stage one here: pick a genre preset, style and mood below, then Generate."}
                  </div>

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

                  {/* Quick transforms — local parameter controls (the old
                      producer panel's tricks, minus the chat round-trip). */}
                  <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={labelStyle}>Quick transforms</span>
                    {([
                      { id: "harder" as const, label: "Make Harder", icon: Flame },
                      { id: "catchier" as const, label: "Make Catchier", icon: Zap },
                      { id: "emotional" as const, label: "More Emotional", icon: Droplets },
                      { id: "variation" as const, label: "Variation", icon: Wand2 },
                    ]).map((b) => {
                      const Icon = b.icon;
                      return (
                        <button key={b.id} onClick={() => applyQuickTransform(b.id)} disabled={isBusy} style={chipBtn}>
                          <Icon size={11} />
                          {b.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Pane feedback line (replaces the old producer chat's
                      status messages) — a notice, not a conversation. */}
                  {notice && (
                    <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                      <CheckCircle2 size={11} style={{ color: accent, flexShrink: 0 }} />
                      {notice}
                    </div>
                  )}

                  {/* Genre presets (quick mode) */}
                  {createTab === "quick" && (
                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      {GENRE_PRESETS.map((preset) => (
                        <button key={preset} onClick={() => setStagedPrompt(preset)} style={chipBtn} disabled={isBusy}>
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
                        <div>
                          <span style={{ ...labelStyle, display: "block", marginBottom: 6 }}>Style</span>
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            {[...STYLE_OPTIONS, ...styleTokens.filter((t) => !STYLE_OPTIONS.includes(t))].map((s) => {
                              const active = styleTokens.includes(s);
                              return (
                                <button
                                  key={s}
                                  onClick={() => toggleStyle(s)}
                                  disabled={isBusy}
                                  style={{
                                    ...chipBtn,
                                    background: active ? `${accent}15` : "transparent",
                                    borderColor: active ? accent : "var(--studio-border)",
                                    color: active ? accent : "var(--text-muted)",
                                  }}
                                >
                                  {s}
                                </button>
                              );
                            })}
                          </div>
                        </div>
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
                      disabled={isBusy || !hasDirection}
                      style={{
                        flex: 1,
                        background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                        color: "#000",
                        fontWeight: 800,
                        border: "none",
                        borderRadius: 12,
                        padding: "14px 24px",
                        cursor: isBusy || !hasDirection ? "not-allowed" : "pointer",
                        opacity: isBusy || !hasDirection ? 0.5 : 1,
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
                        {!isBusy && hasDirection && (
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
              }

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
                  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
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

    </div>
  );
}
