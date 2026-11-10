"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * EggHunt — the approved mockup's five Easter eggs, translated to React.
 *
 * Every egg works by tap AND by keyboard, exactly like the mockup:
 *  1. gem    — tap the LiTT gem (closing-panel wordmark) five times
 *  2. pipe   — tap the hero pipeline steps in order, or the Konami code
 *  3. type   — type "litt" anywhere, or triple-tap the hero headline
 *  4. garden — water the seed at the foot of the page until it grows
 *  5. fly    — catch the firefly drifting in the closing panel
 *
 * Pure delight: no analytics, no storage, nothing leaves the page.
 */

export type EggId = "gem" | "pipe" | "type" | "garden" | "fly";

const EGG_TOTAL = 5;

interface EggHuntContextValue {
  foundCount: number;
  has: (id: EggId) => boolean;
  findEgg: (id: EggId, title: string, body: string) => void;
}

const EggHuntContext = createContext<EggHuntContextValue>({
  foundCount: 0,
  has: () => false,
  findEgg: () => {},
});

export function useEggHunt() {
  return useContext(EggHuntContext);
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface Leaf {
  id: number;
  glyph: string;
  left: string;
  duration: string;
  delay: string;
}

const LEAF_GLYPHS = ["🍃", "🌿", "✦", "🌱"];
let leafSeq = 0;

export function EggHuntProvider({ children }: { children: ReactNode }) {
  const [found, setFound] = useState<Partial<Record<EggId, boolean>>>({});
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const [leaves, setLeaves] = useState<Leaf[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const foundRef = useRef(found);
  useEffect(() => {
    foundRef.current = found;
  }, [found]);

  const burstLeaves = useCallback((count: number) => {
    if (prefersReducedMotion()) return;
    const batch: Leaf[] = Array.from({ length: count }, (_, i) => ({
      id: ++leafSeq,
      glyph: LEAF_GLYPHS[i % LEAF_GLYPHS.length],
      left: `${Math.random() * 96}vw`,
      duration: `${1.6 + Math.random() * 1.8}s`,
      delay: `${Math.random() * 0.5}s`,
    }));
    setLeaves((prev) => [...prev, ...batch]);
    setTimeout(() => {
      setLeaves((prev) => prev.filter((l) => !batch.includes(l)));
    }, 4600);
  }, []);

  const showToast = useCallback((title: string, body: string) => {
    setToast({ title, body });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const findEgg = useCallback(
    (id: EggId, title: string, body: string) => {
      const isNew = !foundRef.current[id];
      if (isNew) {
        const next = { ...foundRef.current, [id]: true };
        foundRef.current = next;
        setFound(next);
        if (Object.keys(next).length === EGG_TOTAL) {
          setTimeout(() => {
            showToast(
              "🏆 FULL CANOPY!",
              "You found all 5 surprises. That curiosity? That's exactly who LiTT is built for.",
            );
            burstLeaves(36);
          }, 4600);
        }
      }
      showToast(title, body);
      burstLeaves(16);
    },
    [burstLeaves, showToast],
  );

  /* Keyboard eggs: type "litt" (egg 3) or the Konami code (egg 2). */
  useEffect(() => {
    const konami = [
      "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
      "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a",
    ];
    let typed = "";
    let kPos = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key && e.key.length === 1) {
        typed = (typed + e.key.toLowerCase()).slice(-4);
        if (typed === "litt") {
          typed = "";
          findEgg(
            "type",
            "⌨️ Egg 3 — You Spelled It.",
            "L-I-T-T. Four letters, one whole forest of websites. Nice fingers.",
          );
        }
      }
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      kPos = k === konami[kPos] ? kPos + 1 : k === konami[0] ? 1 : 0;
      if (kPos === konami.length) {
        kPos = 0;
        findEgg(
          "pipe",
          "🕹️ Egg 2 — Full Run (Konami style).",
          "↑↑↓↓←→←→ B A — a classic, honored properly. Pipeline: shipped.",
        );
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [findEgg]);

  const foundCount = Object.keys(found).length;

  return (
    <EggHuntContext.Provider
      value={{ foundCount, has: (id) => !!found[id], findEgg }}
    >
      {children}
      <div
        role="status"
        aria-live="polite"
        className={`litt-egg-toast ${toast ? "show" : ""}`}
      >
        {toast ? (
          <>
            <strong>{toast.title}</strong>
            <br />
            {toast.body}
          </>
        ) : null}
      </div>
      {leaves.map((leaf) => (
        <span
          key={leaf.id}
          aria-hidden="true"
          className="litt-leaf"
          style={{
            left: leaf.left,
            animationDuration: leaf.duration,
            animationDelay: leaf.delay,
          }}
        >
          {leaf.glyph}
        </span>
      ))}
    </EggHuntContext.Provider>
  );
}
