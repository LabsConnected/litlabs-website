"use client";

/**
 * StudioSecretsPanel — per-project secrets editor for Studio.
 *
 * Lets the project owner paste Clerk keys (and any future integration
 * keys), see which keys are set (masked fingerprints only — values never
 * leave the server), and delete them. After a save the panel reports
 * whether the running preview picked the keys up on its own or needs a
 * manual restart.
 *
 * Mobile-first: full-width inputs, 44px touch targets, no hover-only UI.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Trash2, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

interface SecretSummary {
  secretId: string;
  name: string;
  updatedAt: string;
  /** Masked fingerprint like "••••a1b2c3d4" — never the value. */
  fingerprint: string | null;
}

interface ClerkField {
  name: string;
  label: string;
  placeholder: string;
  help: string;
}

const CLERK_FIELDS: ClerkField[] = [
  {
    name: "CLERK_SECRET_KEY",
    label: "Clerk secret key",
    placeholder: "sk_live_…",
    help: "Clerk dashboard → API keys → Secret key",
  },
  {
    name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    label: "Clerk publishable key",
    placeholder: "pk_live_…",
    help: "Clerk dashboard → API keys → Publishable key",
  },
];

export interface StudioSecretsPanelProps {
  projectId: string;
  getToken?: () => Promise<string | null>;
  /** Fired after a save/delete so the host panel can refresh preview state. */
  onKeysChanged?: (info: { restarted: boolean }) => void;
}

export function StudioSecretsPanel({ projectId, getToken, onKeysChanged }: StudioSecretsPanelProps) {
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getToken?.();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getToken]);

  const base = `/api/studio-projects/${encodeURIComponent(projectId)}/secrets`;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(base, {
        credentials: "include",
        headers: await authHeaders(),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Secrets load failed (${res.status})`);
      const payload = (await res.json()) as { secrets?: SecretSummary[] };
      if (mountedRef.current) setSecrets(payload.secrets ?? []);
    } catch (err) {
      if (mountedRef.current) {
        setLoadError(err instanceof Error ? err.message : "Could not load secrets.");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [base, authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const byName = useCallback(
    (name: string) => secrets.find((s) => s.name === name),
    [secrets],
  );

  const save = useCallback(
    async (name: string) => {
      const value = (drafts[name] ?? "").trim();
      if (!value || saving) return;
      setSaving(name);
      setNotice(null);
      try {
        const res = await fetch(base, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({ name, value }),
        });
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
          secret?: SecretSummary & { fingerprint?: string };
          previewRestarted?: boolean;
        } | null;
        if (!res.ok) {
          throw new Error(
            typeof payload?.error === "string" ? payload.error : `Save failed (${res.status})`,
          );
        }
        const saved = payload?.secret;
        if (saved) {
          setSecrets((prev) => {
            const rest = prev.filter((s) => s.name !== name);
            return [
              ...rest,
              {
                secretId: saved.secretId,
                name: saved.name,
                updatedAt: saved.updatedAt,
                fingerprint: saved.fingerprint ?? null,
              },
            ];
          });
        } else {
          await load();
        }
        setDrafts((prev) => ({ ...prev, [name]: "" }));
        const restarted = payload?.previewRestarted === true;
        setNotice({
          kind: "ok",
          text: restarted
            ? `${name} saved — the preview restarted with the new key.`
            : `${name} saved. Restart the preview to pick it up.`,
        });
        onKeysChanged?.({ restarted });
      } catch (err) {
        setNotice({
          kind: "err",
          text: err instanceof Error ? err.message : "Could not save the secret.",
        });
      } finally {
        if (mountedRef.current) setSaving(null);
      }
    },
    [base, authHeaders, drafts, saving, load, onKeysChanged],
  );

  const remove = useCallback(
    async (secret: SecretSummary) => {
      if (deleting) return;
      setDeleting(secret.secretId);
      setNotice(null);
      try {
        const res = await fetch(`${base}/${encodeURIComponent(secret.secretId)}`, {
          method: "DELETE",
          credentials: "include",
          headers: await authHeaders(),
        });
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
          previewRestarted?: boolean;
        } | null;
        if (!res.ok) {
          throw new Error(
            typeof payload?.error === "string" ? payload.error : `Delete failed (${res.status})`,
          );
        }
        setSecrets((prev) => prev.filter((s) => s.secretId !== secret.secretId));
        const restarted = payload?.previewRestarted === true;
        setNotice({
          kind: "ok",
          text: restarted
            ? `${secret.name} deleted — the preview restarted without it.`
            : `${secret.name} deleted. Restart the preview to apply.`,
        });
        onKeysChanged?.({ restarted });
      } catch (err) {
        setNotice({
          kind: "err",
          text: err instanceof Error ? err.message : "Could not delete the secret.",
        });
      } finally {
        if (mountedRef.current) setDeleting(null);
      }
    },
    [base, authHeaders, deleting, onKeysChanged],
  );

  const otherSecrets = secrets.filter((s) => !CLERK_FIELDS.some((f) => f.name === s.name));

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="studio-secrets-panel">
      <div className="flex items-center gap-2">
        <KeyRound size={14} style={{ color: "var(--litt-primary)" }} aria-hidden />
        <span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
          Project secrets
        </span>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          encrypted · never shown again after saving
        </span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={13} className="animate-spin" aria-hidden /> Loading secrets…
        </div>
      )}

      {loadError && (
        <div
          className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px]"
          style={{ borderColor: "rgba(239,68,68,0.25)", color: "#f87171" }}
          role="alert"
        >
          <AlertTriangle size={13} aria-hidden /> {loadError}
        </div>
      )}

      {!loading && !loadError && (
        <>
          {CLERK_FIELDS.map((field) => {
            const existing = byName(field.name);
            const draft = drafts[field.name] ?? "";
            const busy = saving === field.name;
            return (
              <div
                key={field.name}
                className="rounded-xl border p-2.5"
                style={{ borderColor: "var(--studio-border)", backgroundColor: "rgba(255,255,255,0.02)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={`secret-${field.name}`}
                    className="text-[11px] font-bold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {field.label}
                  </label>
                  {existing ? (
                    <span className="flex items-center gap-1.5">
                      <span
                        className="font-mono text-[10px]"
                        style={{ color: "var(--litt-primary)" }}
                        title={existing.updatedAt ? `Updated ${existing.updatedAt}` : "Set"}
                      >
                        Set{existing.fingerprint ? ` ${existing.fingerprint}` : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() => void remove(existing)}
                        disabled={deleting === existing.secretId}
                        className="grid min-h-9 min-w-9 place-items-center rounded-lg transition hover:bg-white/8 disabled:opacity-40"
                        aria-label={`Delete ${field.label}`}
                        title={`Delete ${field.label}`}
                        data-testid={`secret-delete-${field.name}`}
                      >
                        {deleting === existing.secretId ? (
                          <Loader2 size={13} className="animate-spin" aria-hidden />
                        ) : (
                          <Trash2 size={13} aria-hidden style={{ color: "#f87171" }} />
                        )}
                      </button>
                    </span>
                  ) : (
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      Not set
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <input
                    id={`secret-${field.name}`}
                    type={revealed[field.name] ? "text" : "password"}
                    value={draft}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [field.name]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void save(field.name);
                    }}
                    placeholder={existing ? "Paste a new value to replace…" : field.placeholder}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="min-h-11 min-w-0 flex-1 rounded-lg border bg-black/30 px-2.5 font-mono text-[12px] placeholder:text-white/20 focus:outline-none"
                    style={{ borderColor: "var(--studio-border)", color: "var(--text-primary)" }}
                    data-testid={`secret-input-${field.name}`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setRevealed((prev) => ({ ...prev, [field.name]: !prev[field.name] }))
                    }
                    className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg border transition hover:bg-white/8"
                    style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}
                    aria-label={revealed[field.name] ? "Hide value" : "Show value"}
                    title={revealed[field.name] ? "Hide value" : "Show value"}
                  >
                    <span className="text-[10px] font-bold">{revealed[field.name] ? "Hide" : "Show"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void save(field.name)}
                    disabled={!draft.trim() || busy}
                    className="min-h-11 shrink-0 rounded-lg px-4 text-[12px] font-bold transition disabled:opacity-40"
                    style={{ backgroundColor: "var(--litt-primary)", color: "#000" }}
                    data-testid={`secret-save-${field.name}`}
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : "Save"}
                  </button>
                </div>
                <div className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {field.help}
                </div>
              </div>
            );
          })}

          {otherSecrets.length > 0 && (
            <div className="rounded-xl border p-2.5" style={{ borderColor: "var(--studio-border)" }}>
              <div className="text-[11px] font-bold" style={{ color: "var(--text-primary)" }}>
                Other secrets
              </div>
              <div className="mt-1.5 space-y-1.5">
                {otherSecrets.map((s) => (
                  <div key={s.secretId} className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      {s.name}
                      {s.fingerprint && (
                        <span style={{ color: "var(--text-muted)" }}> {s.fingerprint}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => void remove(s)}
                      disabled={deleting === s.secretId}
                      className="grid min-h-9 min-w-9 shrink-0 place-items-center rounded-lg transition hover:bg-white/8 disabled:opacity-40"
                      aria-label={`Delete ${s.name}`}
                      data-testid={`secret-delete-${s.name}`}
                    >
                      {deleting === s.secretId ? (
                        <Loader2 size={13} className="animate-spin" aria-hidden />
                      ) : (
                        <Trash2 size={13} aria-hidden style={{ color: "#f87171" }} />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-[10px] leading-4" style={{ color: "var(--text-muted)" }}>
            Keys are encrypted on this device&apos;s server and only ever injected into your
            project&apos;s preview — they&apos;re never shown again after saving. Find both keys in
            your Clerk dashboard under API keys.
          </div>
        </>
      )}

      {notice && (
        <div
          className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-4"
          style={{
            borderColor: notice.kind === "ok" ? "rgba(114,242,56,0.25)" : "rgba(239,68,68,0.25)",
            color: notice.kind === "ok" ? "var(--litt-primary)" : "#f87171",
          }}
          role="status"
          data-testid="secrets-notice"
        >
          {notice.kind === "ok" ? (
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" aria-hidden />
          ) : (
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
          )}
          <span>{notice.text}</span>
        </div>
      )}
    </div>
  );
}
