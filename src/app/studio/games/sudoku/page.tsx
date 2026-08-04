"use client";

import { useState, useCallback, useEffect } from "react";
import { GameShell } from "../game-shell";
import "./sudoku.css";

const EMPTY = 0;

function generateBoard(): { puzzle: number[][]; solution: number[][] } {
  const board: number[][] = Array.from({length: 9}, () => Array(9).fill(EMPTY));
  function isValid(b: number[][], r: number, c: number, num: number) {
    for (let i = 0; i < 9; i++) if (b[r][i] === num || b[i][c] === num) return false;
    const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (b[br + i][bc + j] === num) return false;
    return true;
  }
  function solve(b: number[][]): boolean {
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (b[r][c] === EMPTY) {
      const nums = [1,2,3,4,5,6,7,8,9].sort(() => Math.random() - 0.5);
      for (const num of nums) if (isValid(b, r, c, num)) {
        b[r][c] = num;
        if (solve(b)) return true;
        b[r][c] = EMPTY;
      }
      return false;
    }
    return true;
  }
  solve(board);
  const solution = board.map(row => [...row]);
  let removed = 0;
  while (removed < 45) {
    const r = Math.floor(Math.random() * 9);
    const c = Math.floor(Math.random() * 9);
    if (board[r][c] !== EMPTY) { board[r][c] = EMPTY; removed++; }
  }
  return { puzzle: board, solution };
}

export default function SudokuPage() {
  const [puzzle, setPuzzle] = useState<number[][]>([]);
  const [solution, setSolution] = useState<number[][]>([]);
  const [user, setUser] = useState<number[][]>([]);
  const [notes, setNotes] = useState<Set<string>>(new Set());
  const [notesMode, setNotesMode] = useState(false);
  const [selected, setSelected] = useState<{r:number;c:number}|null>(null);
  const [conflicts, setConflicts] = useState<Set<string>>(new Set());
  const [time, setTime] = useState(0);
  const [won, setWon] = useState(false);

  const init = useCallback(() => {
    const { puzzle: p, solution: s } = generateBoard();
    setPuzzle(p);
    setSolution(s);
    setUser(p.map(row => [...row]));
    setNotes(new Set());
    setNotesMode(false);
    setSelected(null);
    setConflicts(new Set());
    setTime(0);
    setWon(false);
  }, []);

  useEffect(() => { init(); }, [init]);
  useEffect(() => { if (won) return; const t = setInterval(() => setTime(v => v + 1), 1000); return () => clearInterval(t); }, [won]);

  useEffect(() => {
    if (puzzle.length === 0) return;
    const full = user.every((row, r) => row.every((v, c) => v !== EMPTY && v === solution[r][c]));
    if (full) setWon(true);
  }, [user, solution, puzzle]);

  function getConflicts(board: number[][]): Set<string> {
    const bad = new Set<string>();
    for (let r = 0; r < 9; r++) {
      const seen = new Map<number, {r:number;c:number}[]>();
      for (let c = 0; c < 9; c++) if (board[r][c] !== EMPTY) {
        const arr = seen.get(board[r][c]) || [];
        arr.push({r, c});
        seen.set(board[r][c], arr);
      }
      for (const [, cells] of seen) if (cells.length > 1) cells.forEach(({r, c}) => bad.add(`${r}-${c}`));
    }
    for (let c = 0; c < 9; c++) {
      const seen = new Map<number, {r:number;c:number}[]>();
      for (let r = 0; r < 9; r++) if (board[r][c] !== EMPTY) {
        const arr = seen.get(board[r][c]) || [];
        arr.push({r, c});
        seen.set(board[r][c], arr);
      }
      for (const [, cells] of seen) if (cells.length > 1) cells.forEach(({r, c}) => bad.add(`${r}-${c}`));
    }
    for (let br = 0; br < 3; br++) for (let bc = 0; bc < 3; bc++) {
      const seen = new Map<number, {r:number;c:number}[]>();
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const r = br * 3 + i, c = bc * 3 + j;
        if (board[r][c] !== EMPTY) { const arr = seen.get(board[r][c]) || []; arr.push({r, c}); seen.set(board[r][c], arr); }
      }
      for (const [, cells] of seen) if (cells.length > 1) cells.forEach(({r, c}) => bad.add(`${r}-${c}`));
    }
    return bad;
  }

  function handleCellClick(r: number, c: number) {
    if (puzzle[r][c] !== EMPTY) return;
    setSelected({r, c});
  }

  function handleKey(num: number) {
    if (!selected || puzzle[selected.r][selected.c] !== EMPTY) return;
    const { r, c } = selected;
    if (notesMode) {
      const key = `${r}-${c}-${num}`;
      setNotes(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
      return;
    }
    const next = user.map(row => [...row]);
    next[r][c] = num;
    setUser(next);
    setNotes(prev => { const n = new Set(prev); for (let i = 1; i <= 9; i++) n.delete(`${r}-${c}-${i}`); return n; });
    setConflicts(getConflicts(next));
  }

  function handleDelete() {
    if (!selected || puzzle[selected.r][selected.c] !== EMPTY) return;
    const next = user.map(row => [...row]);
    next[selected.r][selected.c] = EMPTY;
    setUser(next);
    setConflicts(getConflicts(next));
  }

  const fmtTime = `${Math.floor(time / 60)}:${String(time % 60).padStart(2, "0")}`;

  return (
    <GameShell gameId="sudoku" title="Sudoku" onReset={init}>
      <div className="sud-wrap">
        <div className="sud-hud">
          <div className="sud-stat">Time: <b>{fmtTime}</b></div>
          <button type="button" className={`sud-notes-btn ${notesMode ? "active" : ""}`} onClick={() => setNotesMode(v => !v)}>Notes</button>
          {won && <div className="sud-won">🎉 Solved!</div>}
        </div>

        <div className="sud-board">
          {user.map((row, r) => row.map((val, c) => {
            const isGiven = puzzle[r][c] !== EMPTY;
            const isSelected = selected?.r === r && selected?.c === c;
            const isConflict = conflicts.has(`${r}-${c}`);
            const boxNotes: number[] = [];
            for (let n = 1; n <= 9; n++) if (notes.has(`${r}-${c}-${n}`)) boxNotes.push(n);
            return (
              <div key={`${r}-${c}`}
                className={`sud-cell ${isGiven ? "given" : ""} ${isSelected ? "selected" : ""} ${isConflict ? "conflict" : ""} ${(Math.floor(r/3)+Math.floor(c/3))%2===1 ? "alt-box" : ""}`}
                onClick={() => handleCellClick(r, c)}>
                {val !== EMPTY ? val : (
                  boxNotes.length > 0 ? <div className="sud-notes-grid">{boxNotes.map(n => <span key={n} className="sud-note">{n}</span>)}</div> : null
                )}
              </div>
            );
          }))}
        </div>

        <div className="sud-numpad">
          {[1,2,3,4,5,6,7,8,9].map(n => (
            <button key={n} type="button" className="sud-num" onClick={() => handleKey(n)}>{n}</button>
          ))}
          <button type="button" className="sud-num sud-del" onClick={handleDelete}>⌫</button>
        </div>
      </div>
    </GameShell>
  );
}
