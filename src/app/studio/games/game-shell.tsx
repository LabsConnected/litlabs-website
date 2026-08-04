"use client";

import { ReactNode, useState } from "react";
import "./game-shell.css";

export function GameShell({ gameId, children, title, onReset }: { gameId: string; children: ReactNode; title: string; onReset: () => void }) {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="gshell">
      <header className="gshell-header">
        <div className="gshell-left">
          <a href="/studio/games" className="gshell-back">← Arcade</a>
          <div className="gshell-divider" />
          <span className="gshell-title">{title}</span>
        </div>
        <div className="gshell-actions">
          <button type="button" className="gshell-btn" onClick={onReset} title="New Game">↻ New</button>
          <button type="button" className="gshell-btn" onClick={() => setShowHelp(true)} title="How to Play">? Help</button>
        </div>
      </header>

      <main className="gshell-surface">{children}</main>

      {showHelp && (
        <div className="gshell-modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="gshell-modal" onClick={(e) => e.stopPropagation()}>
            <h3>How to Play — {title}</h3>
            <div className="gshell-modal-body">
              {gameId === "solitaire" && (
                <>
                  <p>Move cards to the four foundation piles (top right), building up by suit from Ace to King.</p>
                  <p>On the tableau, stack cards in descending order alternating colors.</p>
                  <p>Click the stock pile to draw more cards. Empty tableau slots can hold Kings.</p>
                </>
              )}
              {gameId === "wordsearch" && (
                <>
                  <p>Find all hidden words in the letter grid.</p>
                  <p>Click and drag to select a word. Words can run horizontally, vertically, or diagonally.</p>
                  <p>Find every word to win.</p>
                </>
              )}
              {gameId === "sudoku" && (
                <>
                  <p>Fill the 9×9 grid so every row, column, and 3×3 box contains digits 1–9 exactly once.</p>
                  <p>Click a cell, then press 1–9 to place a number.</p>
                  <p>Use notes mode to pencil in candidates. Toggle with the &quot;Notes&quot; button.</p>
                </>
              )}
            </div>
            <button type="button" className="gshell-modal-close" onClick={() => setShowHelp(false)}>Got it</button>
          </div>
        </div>
      )}
    </div>
  );
}
