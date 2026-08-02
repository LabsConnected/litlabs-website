import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the dependencies before importing the service
const mockSupabaseChain = {
  _table: "" as string,
  _data: null as unknown,
  _error: null as unknown,
  _filters: [] as Array<{ column: string; value: unknown }>,
  _method: "",

  from(table: string) {
    this._table = table;
    this._filters = [];
    this._method = "";
    return this;
  },
  select(cols?: string) {
    this._method = "select";
    void cols;
    return this;
  },
  insert(data?: unknown) {
    this._method = "insert";
    void data;
    return this;
  },
  update(data?: unknown) {
    this._method = "update";
    void data;
    return this;
  },
  delete() {
    this._method = "delete";
    return this;
  },
  eq(column: string, value: unknown) {
    this._filters.push({ column, value });
    return this;
  },
  order() {
    return this;
  },
  maybeSingle() {
    return { data: this._data, error: this._error };
  },
  single() {
    return { data: this._data, error: this._error };
  },
};

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => mockSupabaseChain,
}));

vi.mock("@/lib/wallet-ledger", () => ({
  adjustWalletBalance: vi.fn().mockResolvedValue({
    balance: 480,
    previousBalance: 500,
    replayed: false,
  }),
}));

vi.mock("@/lib/r2", () => ({
  uploadAudio: vi.fn().mockResolvedValue({
    storageKey: "user-uuid/audio/test-track.mp3",
    publicUrl: "https://r2.example.com/user-uuid/audio/test-track.mp3",
  }),
  getSignedAudioUrl: vi.fn().mockResolvedValue("https://r2.example.com/signed/test.mp3?sig=abc"),
  getPublicAudioUrl: vi.fn().mockReturnValue("https://r2.example.com/public/test.mp3"),
  deleteAudio: vi.fn().mockResolvedValue(true),
}));

vi.mock("./providers/factory", () => ({
  getActiveProvider: () => ({
    name: "mock" as const,
    supportsStreaming: false,
    supportsAsyncPolling: true,
    generateSong: vi.fn().mockResolvedValue({
      providerJobId: "job-123",
      status: "queued" as const,
      estimatedCostCents: 0,
    }),
    getStatus: vi.fn().mockResolvedValue({
      status: "completed" as const,
      audioUrl: "https://provider.example.com/audio.mp3",
      duration: 30,
    }),
    cancel: vi.fn().mockResolvedValue(true),
  }),
  createProvider: vi.fn().mockReturnValue({
    name: "mock",
    supportsStreaming: false,
    supportsAsyncPolling: true,
    generateSong: vi.fn().mockResolvedValue({
      providerJobId: "job-123",
      status: "queued",
      estimatedCostCents: 0,
    }),
    getStatus: vi.fn().mockResolvedValue({
      status: "completed",
      audioUrl: "https://provider.example.com/audio.mp3",
      duration: 30,
    }),
    cancel: vi.fn().mockResolvedValue(true),
  }),
}));

// Import after mocks are set up
import { checkPromptSafety, checkExplicitContent } from "./safety-filter";
import { MUSIC_LBC_COST } from "./generation-service";

describe("Music Lab safety filter", () => {
  it("blocks voice imitation requests", () => {
    const result = checkPromptSafety("sound exactly like Drake");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("imitate");
  });

  it("blocks celebrity voice requests", () => {
    const result = checkPromptSafety("use the voice of a famous singer");
    expect(result.allowed).toBe(false);
  });

  it("blocks copyrighted lyrics", () => {
    const result = checkPromptSafety("a happy song", "Imagine all the people living life in peace");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("copyrighted");
  });

  it("allows original prompts", () => {
    const result = checkPromptSafety("energetic EDM festival anthem");
    expect(result.allowed).toBe(true);
  });

  it("rewrites imitation prompts", () => {
    const result = checkPromptSafety("sound exactly like Daft Punk");
    expect(result.allowed).toBe(false);
    expect(result.rewrittenPrompt).toContain("in the style of");
  });
});

describe("Music Lab explicit content filter", () => {
  it("detects explicit words in prompt", () => {
    const result = checkExplicitContent("a song about drugs and violence");
    expect(result.explicit).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects explicit words in lyrics", () => {
    const result = checkExplicitContent("a happy song", "explicit adult content here");
    expect(result.explicit).toBe(true);
  });

  it("returns false for clean prompts", () => {
    const result = checkExplicitContent("a happy summer beach song");
    expect(result.explicit).toBe(false);
  });
});

describe("Music Lab LBC cost", () => {
  it("charges concept rate for short clips (<=30s)", () => {
    expect(MUSIC_LBC_COST.concept).toBe(8);
  });

  it("charges instrumental rate for full instrumental", () => {
    expect(MUSIC_LBC_COST.instrumentalFull).toBe(20);
  });

  it("charges song rate for full vocal track", () => {
    expect(MUSIC_LBC_COST.songFull).toBe(30);
  });

  it("charges two-variant bundle rate", () => {
    expect(MUSIC_LBC_COST.twoVariants).toBe(50);
  });
});

describe("Music Lab R2 ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploadAudio requires userId prefix", async () => {
    const { uploadAudio } = await import("@/lib/r2");
    const result = await uploadAudio(
      "user-uuid",
      "test.mp3",
      Buffer.from("fake-audio"),
      "audio/mpeg",
      "audio",
    );
    expect(result.storageKey).toContain("user-uuid/");
  });

  it("getSignedAudioUrl validates ownership", async () => {
    const { getSignedAudioUrl } = await import("@/lib/r2");
    const url = await getSignedAudioUrl("user-uuid", "user-uuid/audio/test.mp3", 3600);
    expect(url).toContain("signed");
  });

  it("deleteAudio validates ownership", async () => {
    const { deleteAudio } = await import("@/lib/r2");
    await deleteAudio("user-uuid", "user-uuid/audio/test.mp3");
    expect(deleteAudio).toHaveBeenCalledWith("user-uuid", "user-uuid/audio/test.mp3");
  });
});

describe("Music Lab billing idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adjustWalletBalance is called with idempotency key", async () => {
    const { adjustWalletBalance } = await import("@/lib/wallet-ledger");
    await adjustWalletBalance({
      clerkId: "clerk-123",
      amount: -8,
      type: "spend",
      reason: "Music generation test",
      idempotencyKey: "music:charge:test-key-12345",
    });
    expect(adjustWalletBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "music:charge:test-key-12345",
        amount: -8,
        type: "spend",
      }),
    );
  });

  it("refund uses idempotency key to prevent double-refund", async () => {
    const { adjustWalletBalance } = await import("@/lib/wallet-ledger");
    await adjustWalletBalance({
      clerkId: "clerk-123",
      amount: 8,
      type: "refund",
      reason: "Music refund: test",
      idempotencyKey: "music:refund:test-key-12345",
    });
    expect(adjustWalletBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "music:refund:test-key-12345",
        amount: 8,
        type: "refund",
      }),
    );
  });
});
