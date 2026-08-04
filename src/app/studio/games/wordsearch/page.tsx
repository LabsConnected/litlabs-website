"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { GameShell } from "../game-shell";
import "./wordsearch.css";

const WORD_LIST = ["REACT", "TYPESCRIPT", "TAILWIND", "NEXTJS", "NODE", "SERVER", "CLIENT", "COMPONENT", "STATE", "PROPS"];
const GRID_SIZE = 12;

function buildGrid(words: string[]): { grid: string[][]; placed: {word:string;cells:{r:number;c:number}[]}[] } {
  const grid: string[][] = Array.from({length: GRID_SIZE}, () => Array(GRID_SIZE).fill(""));
  const placed: {word:string;cells:{r:number;c:number}[]}[] = [];
  const dirs = [[0,1],[1,0],[1,1],[1,-1],[0,-1],[-1,0],[-1,-1],[-1,1]];
  for (const word of words) {
    let attempts = 0;
    while (attempts < 200) {
      attempts++;
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      const r = Math.floor(Math.random() * GRID_SIZE);
      const c = Math.floor(Math.random() * GRID_SIZE);
      const endR = r + dir[0] * (word.length - 1);
      const endC = c + dir[1] * (word.length - 1);
      if (endR < 0 || endR >= GRID_SIZE || endC < 0 || endC >= GRID_SIZE) continue;
      let ok = true;
      const cells: {r:number;c:number}[] = [];
      for (let i = 0; i < word.length; i++) {
        const rr = r + dir[0] * i, cc = c + dir[1] * i;
        if (grid[rr][cc] !== "" && grid[rr][cc] !== word[i]) { ok = false; break; }
        cells.push({r: rr, c: cc});
      }
      if (!ok) continue;
      for (let i = 0; i < word.length; i++) grid[cells[i].r][cells[i].c] = word[i];
      placed.push({word, cells});
      break;
    }
  }
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let r = 0; r < GRID_SIZE; r++) for (let c = 0; c < GRID_SIZE; c++) if (grid[r][c] === "") grid[r][c] = letters[Math.floor(Math.random() * letters.length)];
  return { grid, placed };
}

export default function WordSearchPage() {
  const [grid, setGrid] = useState<string[][]>([]);
  const [placed, setPlaced] = useState<{word:string;cells:{r:number;c:number}[]}[]>([]);
  const [found, setFound] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState<{r:number;c:number}|null>(null);
  const [selEnd, setSelEnd] = useState<{r:number;c:number}|null>(null);
  const [time, setTime] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const init = useCallback(() => {
    const { grid: g, placed: p } = buildGrid(WORD_LIST);
    setGrid(g);
    setPlaced(p);
    setFound([]);
    setSelecting(false);
    setSelStart(null);
    setSelEnd(null);
    setTime(0);
  }, []);

  useEffect(() => { init(); }, [init]);
  useEffect(() => { if (found.length === WORD_LIST.length) return; const t = setInterval(() => setTime(s => s + 1), 1000); return () => clearInterval(t); }, [found.length]);

  function getCellFromEvent(e: React.MouseEvent | React.TouchEvent) {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const cellW = rect.width / GRID_SIZE;
    const cellH = rect.height / GRID_SIZE;
    const c = Math.floor(x / cellW);
    const r = Math.floor(y / cellH);
    if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return null;
    return { r, c };
  }

  function isInSelection(r: number, c: number) {
    if (!selStart || !selEnd) return false;
    const dr = Math.sign(selEnd.r - selStart.r);
    const dc = Math.sign(selEnd.c - selStart.c);
    let curR = selStart.r, curC = selStart.c;
    while (true) {
      if (curR === r && curC === c) return true;
      if (curR === selEnd.r && curC === selEnd.c) break;
      curR += dr; curC += dc;
      if (curR < 0 || curR >= GRID_SIZE || curC < 0 || curC >= GRID_SIZE) break;
    }
    return false;
  }

  function isFoundCell(r: number, c: number) {
    return placed.some(p => found.includes(p.word) && p.cells.some(cell => cell.r === r && cell.c === c));
  }

  function checkWord() {
    if (!selStart || !selEnd) return;
    const cells: {r:number;c:number}[] = [];
    const dr = Math.sign(selEnd.r - selStart.r);
    const dc = Math.sign(selEnd.c - selStart.c);
    let curR = selStart.r, curC = selStart.c;
    while (true) { cells.push({r: curR, c: curC}); if (curR === selEnd.r && curC === selEnd.c) break; curR += dr; curC += dc; }
    const word = cells.map(({r, c}) => grid[r][c]).join("");
    const reverse = cells.map(({r, c}) => grid[r][c]).reverse().join("");
    const match = placed.find(p => (p.word === word || p.word === reverse) && p.cells.length === cells.length && !found.includes(p.word));
    if (match) setFound(prev => [...prev, match.word]);
  }

  const fmtTime = `${Math.floor(time / 60)}:${String(time % 60).padStart(2, "0")}`;

  return (
    <GameShell gameId="wordsearch" title="Word Search" onReset={init}>
      <div className="ws-wrap">
        <div className="ws-hud">
          <div className="ws-stat">Found: <b>{found.length}/{WORD_LIST.length}</b></div>
          <div className="ws-stat">Time: <b>{fmtTime}</b></div>
          {found.length === WORD_LIST.length && <div className="ws-won">🎉 Completed!</div>}
        </div>

        <div className="ws-board" ref={containerRef}
          onMouseDown={e => { const cell = getCellFromEvent(e); if (cell) { setSelecting(true); setSelStart(cell); setSelEnd(cell); } }}
          onMouseMove={e => { if (!selecting) return; const cell = getCellFromEvent(e); if (cell) setSelEnd(cell); }}
          onMouseUp={() => { if (selecting) { setSelecting(false); checkWord(); } }}
          onTouchStart={e => { const cell = getCellFromEvent(e); if (cell) { setSelecting(true); setSelStart(cell); setSelEnd(cell); } }}
          onTouchMove={e => { if (!selecting) return; const cell = getCellFromEvent(e); if (cell) setSelEnd(cell); }}
          onTouchEnd={() => { if (selecting) { setSelecting(false); checkWord(); } }}
        >
          {grid.map((row, r) => row.map((ch, c) => (
            <div key={`${r}-${c}`} className={`ws-cell ${isFoundCell(r, c) ? "found" : ""} ${isInSelection(r, c) ? "selecting" : ""}`}>
              {ch}
            </div>
          )))}
        </div>

        <div className="ws-words">
          {WORD_LIST.map(w => (
            <span key={w} className={`ws-word ${found.includes(w) ? "found" : ""}`}>{w}</span>
          ))}
        </div>
      </div>
    </GameShell>
  );
}
