"use client";

import { useState } from "react";
import { GameMeta } from "./types";
import "./game-cloud.css";

const GAMES: GameMeta[] = [
  {
    id: "solitaire",
    title: "Solitaire",
    description: "Classic Klondike solitaire. Stack cards by suit and rank.",
    category: "cards",
    players: "1P",
    color: "#4DFF62",
    icon: "♠",
  },
  {
    id: "wordsearch",
    title: "Word Search",
    description: "Find hidden words in a grid of letters.",
    category: "word",
    players: "1P",
    color: "#FFCC33",
    icon: "🔍",
  },
  {
    id: "sudoku",
    title: "Sudoku",
    description: "Fill the 9×9 grid so each row, column, and box contains 1–9.",
    category: "puzzle",
    players: "1P",
    color: "#9B4DFF",
    icon: "⊞",
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  all: "All",
  cards: "Cards",
  puzzle: "Puzzle",
  word: "Word",
};

export function GameCloud() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = GAMES.filter((g) => {
    const matchCat = filter === "all" || g.category === filter;
    const matchSearch =
      search === "" ||
      g.title.toLowerCase().includes(search.toLowerCase()) ||
      g.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const counts: Record<string, number> = { all: GAMES.length };
  GAMES.forEach((g) => {
    counts[g.category] = (counts[g.category] || 0) + 1;
  });

  return (
    <div className="gc-page">
      <div className="gc-hero">
        <div className="gc-hero-badge">✦ LiTT Game Cloud</div>
        <h1 className="gc-hero-title">Native Arcade</h1>
        <p className="gc-hero-sub">
          Self-contained browser games — no install, no ads, no external assets.
        </p>
      </div>

      <div className="gc-controls">
        <div className="gc-tabs">
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`gc-tab ${filter === key ? "active" : ""}`}
              onClick={() => setFilter(key)}
            >
              {label}
              <span className="gc-tab-count">{counts[key] || 0}</span>
            </button>
          ))}
        </div>
        <input
          className="gc-search"
          placeholder="Search games..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="gc-grid">
        {filtered.map((game) => (
          <a
            key={game.id}
            href={`/studio/games/${game.id}`}
            className="gc-card"
            style={{ "--game-color": game.color } as React.CSSProperties}
          >
            <div className="gc-card-glow" />
            <div className="gc-card-top">
              <span className="gc-card-icon">{game.icon}</span>
              <span className="gc-card-play">▶</span>
            </div>
            <h3 className="gc-card-title">{game.title}</h3>
            <p className="gc-card-desc">{game.description}</p>
            <div className="gc-card-meta">
              <span className="gc-card-tag">{game.category}</span>
              <span className="gc-card-dot" />
              <span className="gc-card-players">{game.players}</span>
            </div>
          </a>
        ))}
        {filtered.length === 0 && (
          <div className="gc-empty">
            <div className="gc-empty-icon">🌑</div>
            <p>No games match your search.</p>
          </div>
        )}
      </div>
    </div>
  );
}
