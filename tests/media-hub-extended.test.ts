import { describe, it, expect } from "vitest";
import {
  parseMediaUrl,
  isMediaUrl,
  extractYouTubeVideoId,
  extractYouTubePlaylistId,
  urlToSpotifyUri,
  extractSoundCloudTrackUrl,
  extractAppleMusicId,
  isDirectAudioUrl,
  directAudioTitle,
} from "@/components/media/parse-media-url";
import {
  ALL_PROVIDER_IDS,
  PROVIDER_LABELS,
  PROVIDER_COLORS,
  type MediaProviderId,
} from "@/components/media/media-types";

describe("Media Hub — Extended Provider Support", () => {
  describe("parseMediaUrl — YouTube", () => {
    it("parses YouTube watch URLs", () => {
      const item = parseMediaUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(item.provider).toBe("youtube");
      expect(item.sourceUrl).toContain("youtube.com");
    });

    it("parses youtu.be URLs", () => {
      const item = parseMediaUrl("https://youtu.be/dQw4w9WgXcQ");
      expect(item.provider).toBe("youtube");
    });

    it("parses YouTube Music URLs", () => {
      const item = parseMediaUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(item.provider).toBe("youtube");
    });

    it("enriches with thumbnail", () => {
      const item = parseMediaUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(item.artworkUrl).toContain("i.ytimg.com");
    });
  });

  describe("parseMediaUrl — Spotify", () => {
    it("parses Spotify track URLs", () => {
      const item = parseMediaUrl("https://open.spotify.com/track/abc123");
      expect(item.provider).toBe("spotify");
    });

    it("parses Spotify playlist URLs", () => {
      const item = parseMediaUrl("https://open.spotify.com/playlist/abc123");
      expect(item.provider).toBe("spotify");
    });
  });

  describe("parseMediaUrl — SoundCloud", () => {
    it("parses SoundCloud track URLs", () => {
      const item = parseMediaUrl("https://soundcloud.com/artist/track-name");
      expect(item.provider).toBe("soundcloud");
    });
  });

  describe("parseMediaUrl — Apple Music", () => {
    it("parses Apple Music album URLs", () => {
      const item = parseMediaUrl("https://music.apple.com/us/album/song-name/1234567890");
      expect(item.provider).toBe("apple-music");
    });

    it("parses Apple Music song URLs with track index", () => {
      const item = parseMediaUrl("https://music.apple.com/us/album/song-name/1234567890?i=987654321");
      expect(item.provider).toBe("apple-music");
    });
  });

  describe("parseMediaUrl — Direct Audio", () => {
    it("parses MP3 URLs", () => {
      const item = parseMediaUrl("https://example.com/audio/song.mp3");
      expect(item.provider).toBe("direct");
    });

    it("parses WAV URLs", () => {
      const item = parseMediaUrl("https://example.com/audio/song.wav");
      expect(item.provider).toBe("direct");
    });

    it("parses OGG URLs", () => {
      const item = parseMediaUrl("https://example.com/audio/song.ogg");
      expect(item.provider).toBe("direct");
    });

    it("parses FLAC URLs", () => {
      const item = parseMediaUrl("https://example.com/audio/song.flac");
      expect(item.provider).toBe("direct");
    });
  });

  describe("parseMediaUrl — LiTT Assets", () => {
    it("parses R2 CDN URLs", () => {
      const item = parseMediaUrl("https://r2.littree.ai/audio/generated-track.mp3");
      expect(item.provider).toBe("litt");
    });

    it("parses assets.littree.ai URLs", () => {
      const item = parseMediaUrl("https://assets.littree.ai/music/track.wav");
      expect(item.provider).toBe("litt");
    });
  });

  describe("parseMediaUrl — invalid input", () => {
    it("throws on non-URL input", () => {
      expect(() => parseMediaUrl("not a url")).toThrow();
    });

    it("throws on unsupported host", () => {
      expect(() => parseMediaUrl("https://example.com/page")).toThrow();
    });
  });

  describe("isMediaUrl", () => {
    it("returns true for supported URLs", () => {
      expect(isMediaUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
      expect(isMediaUrl("https://open.spotify.com/track/abc")).toBe(true);
      expect(isMediaUrl("https://soundcloud.com/artist/track")).toBe(true);
      expect(isMediaUrl("https://music.apple.com/us/album/name/123")).toBe(true);
      expect(isMediaUrl("https://example.com/song.mp3")).toBe(true);
      expect(isMediaUrl("https://r2.littree.ai/audio/track.mp3")).toBe(true);
    });

    it("returns false for unsupported URLs", () => {
      expect(isMediaUrl("https://example.com/page")).toBe(false);
      expect(isMediaUrl("not a url")).toBe(false);
    });
  });

  describe("extractAppleMusicId", () => {
    it("extracts album ID", () => {
      const result = extractAppleMusicId("https://music.apple.com/us/album/song-name/1234567890");
      expect(result).toEqual({ type: "album", id: "1234567890" });
    });

    it("extracts song ID from album with ?i=", () => {
      const result = extractAppleMusicId("https://music.apple.com/us/album/song-name/1234567890?i=987654321");
      expect(result).toEqual({ type: "song", id: "987654321" });
    });

    it("returns null for invalid URL", () => {
      expect(extractAppleMusicId("not a url")).toBeNull();
    });
  });

  describe("urlToSpotifyUri", () => {
    it("converts track URL to URI", () => {
      expect(urlToSpotifyUri("https://open.spotify.com/track/abc123")).toBe("spotify:track:abc123");
    });

    it("converts album URL to URI", () => {
      expect(urlToSpotifyUri("https://open.spotify.com/album/abc123")).toBe("spotify:album:abc123");
    });
  });

  describe("isDirectAudioUrl", () => {
    it("detects audio file URLs", () => {
      expect(isDirectAudioUrl("https://example.com/song.mp3")).toBe(true);
      expect(isDirectAudioUrl("https://example.com/song.wav")).toBe(true);
      expect(isDirectAudioUrl("https://example.com/page")).toBe(false);
    });
  });

  describe("directAudioTitle", () => {
    it("derives title from filename", () => {
      expect(directAudioTitle("https://example.com/audio/my-cool-song.mp3")).toBe("my cool song");
    });

    it("handles encoded filenames", () => {
      expect(directAudioTitle("https://example.com/audio/My%20Song.wav")).toBe("My Song");
    });
  });
});

describe("Media Hub — Type System", () => {
  describe("ALL_PROVIDER_IDS", () => {
    it("includes all six providers", () => {
      expect(ALL_PROVIDER_IDS).toHaveLength(6);
      expect(ALL_PROVIDER_IDS).toContain("youtube");
      expect(ALL_PROVIDER_IDS).toContain("spotify");
      expect(ALL_PROVIDER_IDS).toContain("soundcloud");
      expect(ALL_PROVIDER_IDS).toContain("apple-music");
      expect(ALL_PROVIDER_IDS).toContain("direct");
      expect(ALL_PROVIDER_IDS).toContain("litt");
    });
  });

  describe("PROVIDER_LABELS", () => {
    it("has a label for every provider", () => {
      for (const id of ALL_PROVIDER_IDS) {
        expect(PROVIDER_LABELS[id]).toBeDefined();
        expect(PROVIDER_LABELS[id].length).toBeGreaterThan(0);
      }
    });
  });

  describe("PROVIDER_COLORS", () => {
    it("has a color for every provider", () => {
      for (const id of ALL_PROVIDER_IDS) {
        expect(PROVIDER_COLORS[id]).toBeDefined();
        expect(PROVIDER_COLORS[id]).toMatch(/^#/);
      }
    });
  });
});

describe("Media Hub — Adapter Architecture", () => {
  // Verify adapters can be imported and have correct IDs
  it("DirectAudioAdapter has id 'direct'", async () => {
    const { DirectAudioAdapter } = await import("@/components/media/providers/DirectAudioAdapter");
    const adapter = new DirectAudioAdapter();
    expect(adapter.id).toBe("direct");
    expect(adapter.capabilities.seek).toBe(true);
    expect(adapter.capabilities.volume).toBe(true);
  });

  it("LittAssetAdapter has id 'litt'", async () => {
    const { LittAssetAdapter } = await import("@/components/media/providers/LittAssetAdapter");
    const adapter = new LittAssetAdapter();
    expect(adapter.id).toBe("litt");
    expect(adapter.capabilities.seek).toBe(true);
  });

  it("SoundCloudMediaAdapter has id 'soundcloud'", async () => {
    const { SoundCloudMediaAdapter } = await import("@/components/media/providers/SoundCloudMediaAdapter");
    const adapter = new SoundCloudMediaAdapter();
    expect(adapter.id).toBe("soundcloud");
    expect(adapter.capabilities.seek).toBe(true);
  });

  it("AppleMusicMediaAdapter has id 'apple-music'", async () => {
    const { AppleMusicMediaAdapter } = await import("@/components/media/providers/AppleMusicMediaAdapter");
    const adapter = new AppleMusicMediaAdapter();
    expect(adapter.id).toBe("apple-music");
    expect(adapter.capabilities.seek).toBe(true);
  });

  it("all adapters implement subscribe()", async () => {
    const { DirectAudioAdapter } = await import("@/components/media/providers/DirectAudioAdapter");
    const { LittAssetAdapter } = await import("@/components/media/providers/LittAssetAdapter");
    const { SoundCloudMediaAdapter } = await import("@/components/media/providers/SoundCloudMediaAdapter");
    const { AppleMusicMediaAdapter } = await import("@/components/media/providers/AppleMusicMediaAdapter");

    for (const AdapterClass of [DirectAudioAdapter, LittAssetAdapter, SoundCloudMediaAdapter, AppleMusicMediaAdapter]) {
      const adapter = new AdapterClass();
      expect(typeof adapter.subscribe).toBe("function");
      const unsub = adapter.subscribe(() => {});
      expect(typeof unsub).toBe("function");
      unsub();
    }
  });
});
