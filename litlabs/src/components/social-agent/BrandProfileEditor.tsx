"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { ScanLine, Save, Loader2, X, Plus } from "lucide-react";

export type BrandProfile = {
  id: string;
  name: string;
  website_url: string;
  voice: string;
  target_audience: string;
  main_offers: string[];
};

interface BrandProfileEditorProps {
  profile: BrandProfile | null;
  onSave: (data: Partial<BrandProfile>) => void;
  onScan: (url: string) => void;
  scanning?: boolean;
}

export default function BrandProfileEditor({
  profile,
  onSave,
  onScan,
  scanning,
}: BrandProfileEditorProps) {
  const { resolvedColors: T } = useTheme();
  const [form, setForm] = useState<Partial<BrandProfile>>({
    name: "",
    website_url: "",
    voice: "",
    target_audience: "",
    main_offers: [],
  });
  const [offerInput, setOfferInput] = useState("");
  const lastProfileIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (profile && profile.id !== lastProfileIdRef.current) {
      lastProfileIdRef.current = profile.id;
      setForm({
        name: profile.name,
        website_url: profile.website_url,
        voice: profile.voice,
        target_audience: profile.target_audience,
        main_offers: [...profile.main_offers],
      });
    }
  }, [profile]);

  const update = (key: keyof BrandProfile, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const addOffer = () => {
    const trimmed = offerInput.trim();
    if (!trimmed || form.main_offers?.includes(trimmed)) return;
    setForm((prev) => ({
      ...prev,
      main_offers: [...(prev.main_offers || []), trimmed],
    }));
    setOfferInput("");
  };

  const removeOffer = (offer: string) => {
    setForm((prev) => ({
      ...prev,
      main_offers: prev.main_offers?.filter((o) => o !== offer) || [],
    }));
  };

  const inputStyle = {
    backgroundColor: T.bgColor,
    color: T.textColor,
    border: `1px solid ${T.borderColor}40`,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-black" style={{ color: T.textColor }}>
          Brand Profile
        </h2>
        <button
          onClick={() => onSave(form)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-opacity hover:opacity-90"
          style={{ backgroundColor: T.accentColor, color: T.bgColor }}
        >
          <Save size={14} /> Save
        </button>
      </div>

      <div
        className="glass-card rounded-xl p-4 space-y-4"
        style={{ borderColor: T.borderColor + "30" }}
      >
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <label
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{ color: T.textMuted }}
            >
              Website URL
            </label>
            <input
              type="url"
              value={form.website_url || ""}
              onChange={(e) => update("website_url", e.target.value)}
              placeholder="https://yourbrand.com"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-1"
              style={inputStyle}
            />
          </div>
          <button
            onClick={() => onScan(form.website_url || "")}
            disabled={scanning || !form.website_url}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{
              backgroundColor: T.accentColor + "20",
              color: T.accentColor,
            }}
          >
            {scanning ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <ScanLine size={14} />
            )}
            Scan
          </button>
        </div>

        <div className="space-y-1.5">
          <label
            className="text-[11px] font-bold uppercase tracking-wider"
            style={{ color: T.textMuted }}
          >
            Brand Name
          </label>
          <input
            type="text"
            value={form.name || ""}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Brand name"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-1"
            style={inputStyle}
          />
        </div>

        <div className="space-y-1.5">
          <label
            className="text-[11px] font-bold uppercase tracking-wider"
            style={{ color: T.textMuted }}
          >
            Voice & Tone
          </label>
          <textarea
            value={form.voice || ""}
            onChange={(e) => update("voice", e.target.value)}
            placeholder="Describe how your brand speaks..."
            rows={3}
            className="w-full rounded-lg px-3 py-2 text-sm resize-none outline-none focus:ring-1"
            style={inputStyle}
          />
        </div>

        <div className="space-y-1.5">
          <label
            className="text-[11px] font-bold uppercase tracking-wider"
            style={{ color: T.textMuted }}
          >
            Target Audience
          </label>
          <input
            type="text"
            value={form.target_audience || ""}
            onChange={(e) => update("target_audience", e.target.value)}
            placeholder="e.g. indie developers, AI enthusiasts"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-1"
            style={inputStyle}
          />
        </div>

        <div className="space-y-1.5">
          <label
            className="text-[11px] font-bold uppercase tracking-wider"
            style={{ color: T.textMuted }}
          >
            Main Offers
          </label>
          <div className="flex flex-wrap gap-2">
            {form.main_offers?.map((offer) => (
              <span
                key={offer}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium"
                style={{
                  backgroundColor: T.accentColor + "15",
                  color: T.accentColor,
                }}
              >
                {offer}
                <button
                  onClick={() => removeOffer(offer)}
                  className="rounded-full hover:bg-white/10"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={offerInput}
                onChange={(e) => setOfferInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addOffer();
                  }
                }}
                placeholder="Add offer"
                className="w-28 rounded-lg px-2 py-1 text-xs outline-none focus:ring-1"
                style={inputStyle}
              />
              <button
                onClick={addOffer}
                className="p-1 rounded-md transition-colors hover:bg-white/5"
                style={{ color: T.textMuted }}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
