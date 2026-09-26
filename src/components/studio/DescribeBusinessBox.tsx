"use client";

/**
 * DescribeBusinessBox — the "describe once" intake.
 *
 * One prominent input, no prerequisite category decision. The user
 * describes their business in free text; LiTT transparently infers the
 * business type + recommended template (keyword map, shown with its
 * matched keywords) and asks for a one-tap confirm ("looks right /
 * change") before persisting the Business Profile.
 *
 * - With a projectId: PUTs the profile to
 *   /api/studio-projects/[projectId]/business-profile.
 * - Without one (dashboard): stashes a pending intake in localStorage;
 *   the Studio greeter adopts it into the active project on first render.
 *
 * Existing entry points (tiles, category grid, quick builds) are left
 * untouched — this box sits above/alongside them.
 */

import { useEffect, useRef, useState } from "react";
import { Sparkles, Check, ArrowRight, Pencil } from "lucide-react";
import {
  BUSINESS_TYPES,
  buildIntakeProfile,
  type BusinessProfile,
  type BusinessTypeId,
  type BusinessTypeInference,
} from "@/lib/business-profile";
import {
  clearPendingIntake,
  getBusinessProfile,
  readPendingIntake,
  saveBusinessProfile,
  savePendingIntake,
} from "@/lib/business-profile-client";

export interface DescribeBusinessBoxProps {
  /** Project to persist to. Omit on project-less surfaces (dashboard). */
  projectId?: string | null;
  /**
   * Visual variant. "studio" matches the greeter panel styling but uses the
   * canonical LIME accent (Studio surfaces must not drift to purple).
   */
  variant: "dashboard" | "greeter" | "studio";
  className?: string;
  /** Called after the profile is persisted/stashed. */
  onConfirmed?: (result: {
    profile: BusinessProfile;
    inference: BusinessTypeInference;
  }) => void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "confirming"; description: string; inference: BusinessTypeInference; profile: BusinessProfile }
  | { kind: "changing"; description: string; inference: BusinessTypeInference; profile: BusinessProfile }
  | { kind: "saving"; description: string; inference: BusinessTypeInference; profile: BusinessProfile }
  | { kind: "saved"; inference: BusinessTypeInference; profile: BusinessProfile }
  | { kind: "error"; message: string; description: string };

const MIN_DESCRIPTION = 12;

const TYPE_OPTIONS = (Object.keys(BUSINESS_TYPES) as BusinessTypeId[]).map(
  (id) => BUSINESS_TYPES[id],
);

function panelStyle(variant: "dashboard" | "greeter" | "studio"): React.CSSProperties {
  if (variant === "dashboard") {
    return {
      background: "rgba(18,18,21,0.7)",
      border: "1px solid rgba(255,255,255,0.08)",
      backdropFilter: "blur(12px)",
    };
  }
  return {
    border: "1px solid var(--glass-border)",
    backgroundColor: "rgba(10,11,16,0.9)",
    backdropFilter: "blur(12px)",
  };
}

export function DescribeBusinessBox({
  projectId,
  variant,
  className,
  onConfirmed,
}: DescribeBusinessBoxProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [adopted, setAdopted] = useState(false);
  const adoptedRef = useRef(false);

  // Adopt a pending intake (captured on the dashboard) into this project.
  useEffect(() => {
    if (!projectId || adoptedRef.current) return;
    adoptedRef.current = true;
    const pending = readPendingIntake();
    if (!pending) return;
    (async () => {
      try {
        const existing = await getBusinessProfile(projectId);
        if (existing) {
          clearPendingIntake();
          return;
        }
        const saved = await saveBusinessProfile(projectId, {
          ...pending.profile,
          updatedAt: new Date().toISOString(),
        });
        if (saved) {
          clearPendingIntake();
          setAdopted(true);
        }
      } catch {
        // Best-effort adoption; the intake stays pending for a later visit.
        adoptedRef.current = false;
      }
    })();
  }, [projectId]);

  const startConfirm = () => {
    const description = draft.trim();
    if (description.length < MIN_DESCRIPTION) {
      setHint("Give LiTT a little more — what do you do, and where?");
      return;
    }
    setHint(null);
    const { profile, inference } = buildIntakeProfile(description);
    setPhase({ kind: "confirming", description, inference, profile });
  };

  const applyTypeChange = (typeId: BusinessTypeId) => {
    if (phase.kind !== "changing") return;
    const info = BUSINESS_TYPES[typeId];
    const inference: BusinessTypeInference = {
      businessType: typeId,
      info,
      confidence: "high", // user-corrected
      matchedKeywords: phase.inference.matchedKeywords,
    };
    const profile: BusinessProfile = {
      ...phase.profile,
      businessType: typeId,
      recommendedTemplateId: info.templateId,
      typeConfirmed: true,
    };
    setPhase({ kind: "confirming", description: phase.description, inference, profile });
  };

  const confirm = async () => {
    if (phase.kind !== "confirming") return;
    const profile: BusinessProfile = {
      ...phase.profile,
      typeConfirmed: true,
      updatedAt: new Date().toISOString(),
    };
    const inference = phase.inference;
    setPhase({ kind: "saving", description: phase.description, inference, profile });

    try {
      if (projectId) {
        const saved = await saveBusinessProfile(projectId, profile);
        if (!saved) throw new Error("save-failed");
        setPhase({ kind: "saved", inference, profile: saved.profile });
      } else {
        savePendingIntake({
          description: phase.description,
          inference,
          profile,
          source: variant,
        });
        setPhase({ kind: "saved", inference, profile });
      }
      onConfirmed?.({ profile, inference });
    } catch {
      setPhase({
        kind: "error",
        message: "Couldn't save that just now — try again.",
        description: phase.description,
      });
    }
  };

  const reset = () => {
    setDraft("");
    setPhase({ kind: "idle" });
  };

  const isGreeter = variant === "greeter" || variant === "studio";
  const textPrimary = isGreeter ? "var(--text-primary)" : "#fafafa";
  const textMuted = isGreeter ? "var(--text-muted)" : "#a1a1aa";
  const accent =
    variant === "studio" ? "var(--litt-primary)" : isGreeter ? "var(--glass-purple)" : "#a78bfa";

  return (
    <div className={className} style={{ ...panelStyle(variant), borderRadius: 16, padding: 20 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
        <Sparkles size={16} style={{ color: accent }} />
        <h3 className="text-sm font-bold" style={{ color: textPrimary }}>
          Describe your business once
        </h3>
      </div>
      <p className="text-xs" style={{ color: textMuted, marginBottom: 12 }}>
        One description. LiTT figures out what kind of business it is and what
        to build — no categories to pick first.
      </p>

      {adopted && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
          style={{ background: "rgba(52,211,153,0.1)", color: "#34d399", marginBottom: 12 }}
        >
          <Check size={14} />
          Picked up the description you wrote earlier — profile saved to this project.
        </div>
      )}

      {phase.kind === "idle" && (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="e.g. I run a dog-grooming salon in Muskegon — baths, haircuts, nail trims. Call (231) 555-0147."
            aria-label="Describe your business"
            className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
            style={{
              background: "rgba(255,255,255,0.03)",
              borderColor: "rgba(255,255,255,0.1)",
              color: textPrimary,
              resize: "vertical",
            }}
          />
          {hint && (
            <p className="text-xs" style={{ color: "#f59e0b", marginTop: 6 }}>{hint}</p>
          )}
          <button
            type="button"
            onClick={startConfirm}
            className="mt-3 flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition hover:opacity-85"
            style={{ background: accent, color: "#0b0b10" }}
          >
            Continue <ArrowRight size={14} />
          </button>
        </>
      )}

      {(phase.kind === "confirming" || phase.kind === "changing") && (
        <div>
          <div
            className="rounded-xl border px-3 py-2.5 text-xs"
            style={{
              background: "rgba(255,255,255,0.03)",
              borderColor: "rgba(255,255,255,0.08)",
              color: textMuted,
              marginBottom: 12,
            }}
          >
            &ldquo;{phase.description.length > 220 ? phase.description.slice(0, 220) + "…" : phase.description}&rdquo;
          </div>

          <div className="text-sm font-bold" style={{ color: textPrimary, marginBottom: 4 }}>
            LiTT thinks: {phase.inference.info.label}
            <span style={{ color: textMuted, fontWeight: 500 }}>
              {" "}→ {phase.inference.info.templateId === "business-site" ? "Business Site" : phase.inference.info.category} template
            </span>
          </div>
          {phase.inference.matchedKeywords.length > 0 && (
            <p className="text-[11px]" style={{ color: textMuted, marginBottom: 4 }}>
              Because you mentioned: {phase.inference.matchedKeywords.slice(0, 5).join(", ")}
            </p>
          )}
          {phase.inference.confidence === "low" && phase.inference.businessType === "other" && (
            <p className="text-[11px]" style={{ color: "#f59e0b", marginBottom: 4 }}>
              Not sure yet from that description — pick the closest type or tell LiTT more.
            </p>
          )}

          {phase.kind === "changing" ? (
            <div style={{ marginTop: 10, marginBottom: 4 }}>
              <label className="text-xs font-bold" style={{ color: textMuted }} htmlFor="guided-start-type">
                Choose the type
              </label>
              <select
                id="guided-start-type"
                value={phase.inference.businessType}
                onChange={(e) => applyTypeChange(e.target.value as BusinessTypeId)}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  borderColor: "rgba(255,255,255,0.1)",
                  color: textPrimary,
                }}
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id} style={{ color: "#0b0b10" }}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={confirm}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition hover:opacity-85"
                style={{ background: accent, color: "#0b0b10" }}
              >
                <Check size={14} /> Looks right
              </button>
              <button
                type="button"
                onClick={() =>
                  setPhase({ kind: "changing", description: phase.description, inference: phase.inference, profile: phase.profile })
                }
                className="flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-medium transition hover:opacity-80"
                style={{ borderColor: "rgba(255,255,255,0.12)", color: textPrimary }}
              >
                <Pencil size={13} /> Change
              </button>
              <button
                type="button"
                onClick={reset}
                className="text-xs font-medium transition hover:opacity-70"
                style={{ color: textMuted }}
              >
                Start over
              </button>
            </div>
          )}
        </div>
      )}

      {phase.kind === "saving" && (
        <p className="text-sm" style={{ color: textMuted }}>Saving your business profile…</p>
      )}

      {phase.kind === "error" && (
        <div>
          <p className="text-sm" style={{ color: "#f87171", marginBottom: 8 }}>{phase.message}</p>
          <button
            type="button"
            onClick={() => {
              setDraft(phase.description);
              setPhase({ kind: "idle" });
            }}
            className="text-xs font-bold transition hover:opacity-70"
            style={{ color: accent }}
          >
            Try again →
          </button>
        </div>
      )}

      {phase.kind === "saved" && (
        <div>
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"
            style={{ background: "rgba(52,211,153,0.1)", color: "#34d399", marginBottom: 12 }}
          >
            <Check size={14} />
            {projectId
              ? "Business profile saved to this project — LiTT won't ask again."
              : "Saved — your description will carry into Studio."}
          </div>
          {!projectId ? (
            <a
              href={`${phase.inference.info.studioHref}&guidedStart=1`}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition hover:opacity-85"
              style={{ background: accent, color: "#0b0b10", textDecoration: "none" }}
            >
              Start building in Studio <ArrowRight size={14} />
            </a>
          ) : (
            <button
              type="button"
              onClick={() => onConfirmed?.({ profile: phase.profile, inference: phase.inference })}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition hover:opacity-85"
              style={{ background: accent, color: "#0b0b10" }}
            >
              Continue <ArrowRight size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
