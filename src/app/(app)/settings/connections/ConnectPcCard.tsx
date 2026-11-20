"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";

type Device = { id: string; name: string; fingerprint: string; revokedAt: string | null };
type Claim = { name: string; fingerprint: string };

export default function ConnectPcCard() {
  const T = useTheme().resolvedColors;
  const [devices, setDevices] = useState<Device[]>([]);
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [claim, setClaim] = useState<Claim | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const loadDevices = useCallback(async () => {
    const response = await fetch("/api/local-devices", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load paired PCs");
    setDevices((await response.json()).devices);
  }, []);

  useEffect(() => { void loadDevices().catch((e) => setError(e.message)); }, [loadDevices]);
  useEffect(() => {
    if (!code || Date.now() >= Date.parse(expiresAt)) return;
    const poll = async () => {
      try {
        const response = await fetch(`/api/local-devices/pairing/claim?code=${encodeURIComponent(code)}`, { cache: "no-store" });
        if (response.ok) setClaim((await response.json()).claim);
      } catch { /* The next poll retries. */ }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2500);
    return () => window.clearInterval(timer);
  }, [code, expiresAt]);

  async function start() {
    setBusy(true); setError(""); setClaim(null);
    try {
      const response = await fetch("/api/local-devices/pairing", { method: "POST" });
      if (!response.ok) throw new Error("Could not create a pairing code");
      const data = await response.json();
      setCode(data.code); setExpiresAt(data.expiresAt);
    } catch (e) { setError(e instanceof Error ? e.message : "Pairing failed"); }
    finally { setBusy(false); }
  }

  async function confirm() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/local-devices/pairing/claim", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
      });
      if (!response.ok) throw new Error("Claim expired. Generate a fresh code.");
      setCode(""); setClaim(null);
      await loadDevices();
    } catch (e) { setError(e instanceof Error ? e.message : "Pairing failed"); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/local-devices/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not revoke PC");
      await loadDevices();
    } catch (e) { setError(e instanceof Error ? e.message : "Revocation failed"); }
    finally { setBusy(false); }
  }

  return <section className="rounded-xl border p-4" style={{ background: T.boxBg, borderColor: `${T.borderColor}30` }}>
    <h2 className="text-sm font-bold" style={{ color: T.headerColor }}>Connect PC</h2>
    <p className="mt-1 text-xs opacity-70">Pair a PC to your account. Confirm its name and fingerprint before trusting it.</p>
    <button type="button" disabled={busy} onClick={() => void start()}
      className="mt-3 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50"
      style={{ background: T.accentColor, color: T.bgColor }}>
      {code ? "Generate new code" : "Connect PC"}
    </button>
    {code && <div className="mt-3 text-xs">
      <p><a className="underline" href="/bridge-agent/pair.mjs" download="litt-pair.mjs">Download pairing helper</a> on the PC, then run <code>node litt-pair.mjs {origin}</code> and enter this code:</p>
      <p className="mt-1 opacity-70">Re-pairing an existing PC? Add <code>--key-root &lt;folder with your .litt-device-key.json&gt;</code> to reuse its identity.</p>
      <p className="my-2 font-mono text-xl tracking-widest">{code}</p>
      <p>Expires {new Date(expiresAt).toLocaleTimeString()}.</p>
      {claim ? <div className="mt-3 rounded-lg border p-3" style={{ borderColor: T.borderColor }}>
        <p>Claim from <strong>{claim.name}</strong></p>
        <p className="break-all font-mono">Fingerprint: {claim.fingerprint}</p>
        <button type="button" disabled={busy} onClick={() => void confirm()}
          className="mt-2 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50"
          style={{ background: T.accentColor, color: T.bgColor }}>Confirm this PC</button>
      </div> : <p className="mt-2">Waiting for the PC claim…</p>}
    </div>}
    {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
    <div className="mt-4 space-y-2">
      {devices.map((device) => <div key={device.id} className="rounded-lg border p-3 text-xs" style={{ borderColor: T.borderColor }}>
        <div className="flex items-center justify-between gap-3">
          <strong>{device.name} {device.revokedAt ? "(revoked)" : ""}</strong>
          {!device.revokedAt && <button type="button" disabled={busy} onClick={() => void revoke(device.id)}
            className="underline disabled:opacity-50">Revoke</button>}
        </div>
        <p className="mt-1 break-all font-mono opacity-60">{device.fingerprint}</p>
      </div>)}
    </div>
  </section>;
}
