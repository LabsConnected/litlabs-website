"use client";

import { useState, useCallback, useEffect } from "react";
import { GameShell } from "../game-shell";
import "./solitaire.css";

type Suit = "♠" | "♥" | "♦" | "♣";
type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

interface Card {
  suit: Suit;
  rank: Rank;
  faceUp: boolean;
  id: string;
}

const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
const RANKS: Rank[] = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const RANK_VAL: Record<Rank, number> = { A:1,"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,J:11,Q:12,K:13 };

function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ suit, rank, faceUp: false, id: `${suit}-${rank}-${Math.random().toString(36).slice(2,7)}` });
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}

function isRed(suit: Suit) { return suit === "♥" || suit === "♦"; }

function canPlaceTableau(top: Card | null, candidate: Card): boolean {
  if (!top) return candidate.rank === "K";
  return RANK_VAL[candidate.rank] === RANK_VAL[top.rank] - 1 && isRed(top.suit) !== isRed(candidate.suit);
}

function canPlaceFoundation(top: Card | null, candidate: Card): boolean {
  if (!top) return candidate.rank === "A";
  return candidate.suit === top.suit && RANK_VAL[candidate.rank] === RANK_VAL[top.rank] + 1;
}

export default function SolitairePage() {
  const [stock, setStock] = useState<Card[]>([]);
  const [waste, setWaste] = useState<Card[]>([]);
  const [foundations, setFoundations] = useState<Card[][]>([[],[],[],[]]);
  const [tableau, setTableau] = useState<Card[][]>([[],[],[],[],[],[],[]]);
  const [selected, setSelected] = useState<{source:string;index:number;cardIndex?:number}|null>(null);
  const [won, setWon] = useState(false);
  const [moves, setMoves] = useState(0);
  const [time, setTime] = useState(0);

  const init = useCallback(() => {
    const deck = createDeck();
    const t: Card[][] = [[],[],[],[],[],[],[]];
    let idx = 0;
    for (let col = 0; col < 7; col++) for (let row = 0; row <= col; row++) { const c = deck[idx++]; c.faceUp = row === col; t[col].push(c); }
    setTableau(t);
    setFoundations([[],[],[],[]]);
    setStock(deck.slice(idx));
    setWaste([]);
    setSelected(null);
    setWon(false);
    setMoves(0);
    setTime(0);
  }, []);

  useEffect(() => { init(); }, [init]);
  useEffect(() => { if (won) return; const t = setInterval(() => setTime(s => s + 1), 1000); return () => clearInterval(t); }, [won]);
  useEffect(() => { if (foundations.every(f => f.length === 13)) setWon(true); }, [foundations]);

  function drawStock() {
    if (stock.length === 0) { if (waste.length === 0) return; setStock(waste.map(c => ({...c, faceUp:false})).reverse()); setWaste([]); return; }
    const card = stock[stock.length - 1];
    setStock(stock.slice(0, -1));
    setWaste([...waste, {...card, faceUp:true}]);
  }

  function getCard(source: string, index: number, cardIndex?: number): Card | null {
    if (source === "waste") return waste[waste.length - 1] || null;
    if (source === "foundation") return foundations[index][foundations[index].length - 1] || null;
    if (source === "tableau") { const col = tableau[index]; if (cardIndex !== undefined) return col[cardIndex] || null; return col[col.length - 1] || null; }
    return null;
  }

  function handleSelect(source: string, index: number, cardIndex?: number) {
    if (selected) { attemptMove(selected, {source, index, cardIndex}); setSelected(null); return; }
    if (source === "stock") return;
    const card = getCard(source, index, cardIndex);
    if (!card || !card.faceUp) return;
    setSelected({source, index, cardIndex});
  }

  function attemptMove(from: {source:string;index:number;cardIndex?:number}, to: {source:string;index:number;cardIndex?:number}) {
    const srcCard = getCard(from.source, from.index, from.cardIndex);
    if (!srcCard) return;
    if (to.source === "foundation") {
      const fIdx = to.index;
      const top = foundations[fIdx][foundations[fIdx].length - 1] || null;
      if (canPlaceFoundation(top, srcCard)) {
        removeFromSource(from);
        setFoundations(prev => prev.map((f, i) => i === fIdx ? [...f, srcCard] : f));
        setMoves(m => m + 1);
        revealLast(from);
      }
      return;
    }
    if (to.source === "tableau") {
      const col = tableau[to.index];
      const top = col[col.length - 1] || null;
      if (canPlaceTableau(top, srcCard)) {
        let moving: Card[] = [];
        if (from.source === "tableau" && from.cardIndex !== undefined) moving = tableau[from.index].slice(from.cardIndex);
        else moving = [srcCard];
        removeFromSource(from);
        setTableau(prev => prev.map((c, i) => i === to.index ? [...c, ...moving] : c));
        setMoves(m => m + 1);
        revealLast(from);
      }
    }
  }

  function removeFromSource(loc: {source:string;index:number;cardIndex?:number}) {
    if (loc.source === "waste") setWaste(prev => prev.slice(0, -1));
    if (loc.source === "foundation") setFoundations(prev => prev.map((f, i) => i === loc.index ? f.slice(0, -1) : f));
    if (loc.source === "tableau") {
      if (loc.cardIndex !== undefined) setTableau(prev => prev.map((c, i) => i === loc.index ? c.slice(0, loc.cardIndex) : c));
      else setTableau(prev => prev.map((c, i) => i === loc.index ? c.slice(0, -1) : c));
    }
  }

  function revealLast(loc: {source:string;index:number}) {
    if (loc.source === "tableau") {
      setTableau(prev => prev.map((c, i) => {
        if (i !== loc.index || c.length === 0) return c;
        const last = c[c.length - 1];
        if (!last.faceUp) return [...c.slice(0, -1), {...last, faceUp: true}];
        return c;
      }));
    }
  }

  const fmtTime = `${Math.floor(time / 60)}:${String(time % 60).padStart(2, "0")}`;

  return (
    <GameShell gameId="solitaire" title="Solitaire" onReset={init}>
      <div className="sol-wrap">
        <div className="sol-hud">
          <div className="sol-stat">Moves: <b>{moves}</b></div>
          <div className="sol-stat">Time: <b>{fmtTime}</b></div>
          {won && <div className="sol-won">🎉 You Won!</div>}
        </div>

        <div className="sol-top">
          <div className="sol-stock-waste">
            <div className="sol-pile sol-stock" onClick={drawStock} title="Draw">
              {stock.length > 0 ? <div className="sol-card back" /> : waste.length > 0 ? <div className="sol-card recycle">↻</div> : <div className="sol-card empty" />}
            </div>
            <div className={`sol-pile ${selected?.source === "waste" ? "selected" : ""}`} onClick={() => handleSelect("waste", 0)}>
              {waste.length > 0 ? <CardView card={waste[waste.length - 1]} /> : <div className="sol-card empty" />}
            </div>
          </div>
          <div className="sol-foundations">
            {foundations.map((f, i) => (
              <div key={i} className={`sol-pile ${selected?.source === "foundation" && selected.index === i ? "selected" : ""}`} onClick={() => handleSelect("foundation", i)}>
                {f.length > 0 ? <CardView card={f[f.length - 1]} /> : <div className="sol-card empty foundation-empty">{SUITS[i]}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="sol-tableau">
          {tableau.map((col, ci) => (
            <div key={ci} className="sol-column">
              {col.length === 0 ? (
                <div className={`sol-pile ${selected && selected.source !== "tableau" ? "droppable" : ""}`} onClick={() => handleSelect("tableau", ci)}>
                  <div className="sol-card empty" />
                </div>
              ) : col.map((card, ri) => (
                <div key={card.id} className={`sol-pile ${selected?.source === "tableau" && selected.index === ci && selected.cardIndex === ri ? "selected" : ""} ${!card.faceUp ? "face-down" : ""}`}
                  style={{marginTop: ri === 0 ? 0 : -60}} onClick={() => handleSelect("tableau", ci, ri)}>
                  {card.faceUp ? <CardView card={card} /> : <div className="sol-card back" />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </GameShell>
  );
}

function CardView({ card }: { card: Card }) {
  const red = isRed(card.suit);
  return (
    <div className={`sol-card front ${red ? "red" : "black"}`}>
      <span className="sol-card-rank">{card.rank}</span>
      <span className="sol-card-suit">{card.suit}</span>
    </div>
  );
}
