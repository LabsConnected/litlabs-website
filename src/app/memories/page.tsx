"use client";

import { useState, useCallback } from "react";

interface MemoryResult {
  id: string;
  memory?: string;
  chunk?: string;
  similarity: number;
  updatedAt: string;
}

export default function MemoriesPage() {
  const [memories, setMemories] = useState<MemoryResult[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const fetchMemories = useCallback(async (q = "") => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/memory/search?q=${encodeURIComponent(q)}&limit=30`
      );
      const data = await res.json();
      setMemories(data.results || []);
    } catch {
      setMemories([]);
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, []);

  if (!initialized && !loading) {
    fetchMemories();
  }

  const forgetMemory = async (id: string) => {
    try {
      await fetch("/api/memory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch {
      // ignore
    }
  };

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-orange-400">
            LiTTree LabStudios
          </p>
          <h1 className="text-4xl font-black">Memories</h1>
          <p className="text-zinc-400 mt-2">
            View and manage your persistent memories.
          </p>
        </div>

        <div className="flex gap-2">
          <input
            className="flex-1 rounded-xl bg-zinc-900 border border-white/10 p-3 text-white outline-none focus:border-orange-500"
            placeholder="Search memories..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchMemories(query)}
          />
          <button
            onClick={() => fetchMemories(query)}
            className="rounded-xl bg-orange-500 px-6 py-3 font-bold text-black"
          >
            Search
          </button>
        </div>

        {loading && <p className="text-zinc-500">Loading...</p>}

        {!loading && memories.length === 0 && (
          <p className="text-zinc-500 text-center py-12">
            {query ? "No memories match your search." : "No memories yet. Start chatting to create some."}
          </p>
        )}

        <div className="space-y-3">
          {memories.map((mem) => (
            <div
              key={mem.id}
              className="rounded-xl border border-white/10 bg-zinc-950/80 p-4 flex justify-between items-start gap-4"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-relaxed break-words">
                  {mem.memory || mem.chunk}
                </p>
                <div className="flex gap-4 mt-2 text-xs text-zinc-500">
                  <span>ID: {mem.id.slice(0, 12)}...</span>
                  <span>Score: {(mem.similarity * 100).toFixed(1)}%</span>
                  <span>
                    {mem.updatedAt
                      ? new Date(mem.updatedAt).toLocaleDateString()
                      : ""}
                  </span>
                </div>
              </div>
              <button
                onClick={() => forgetMemory(mem.id)}
                className="text-red-400 hover:text-red-300 text-xs shrink-0"
              >
                Forget
              </button>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
