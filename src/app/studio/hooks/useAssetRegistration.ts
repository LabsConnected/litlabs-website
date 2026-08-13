"use client";

/**
 * useAssetRegistration — client-side hook for registering creator
 * outputs as assets in the Asset Lake.
 *
 * This is the WRITE seam that creators call after a successful
 * PERSISTENT generation with a durable URL. It posts to /api/assets
 * and returns the canonical StudioAsset.
 *
 * Truthfulness rules (Phase E.1):
 * - provider, model, and prompt are REQUIRED — no fabricated provenance.
 * - url must be a durable HTTP(S) URL — blob: and data: are rejected.
 * - Only registerable kinds (image, video, music, audio) are accepted.
 * - Do NOT call this for browser-only temporary previews.
 *
 * Usage:
 *   const { register, loading, error } = useAssetRegistration();
 *   const { asset } = await register({
 *     kind: "image",
 *     url: durableUrl,
 *     provider: "fal",
 *     model: "flux-1-schnell",
 *     prompt: "A neon city skyline at dusk",
 *   });
 */

import { useState, useCallback } from "react";
import { useStudioContext } from "@/app/studio/context/StudioContext";
import { notifyAssetsChanged } from "@/app/studio/hooks/useAssetsRefresh";
import type { StudioAsset } from "@/lib/assets/types";
import type { RegisterableAssetKind } from "@/lib/assets/registration";

export interface RegisterAssetParams {
  kind: RegisterableAssetKind;
  /** Durable HTTP(S) URL — blob: and data: are rejected. */
  url: string;
  /** Real provider name — REQUIRED, no fabrication. */
  provider: string;
  /** Real model name — REQUIRED, no fabrication. */
  model: string;
  /** Real generation prompt — REQUIRED, no fabrication. */
  prompt: string;
  thumbnailUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  costCredits?: number;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

export interface UseAssetRegistrationResult {
  register: (params: RegisterAssetParams) => Promise<{ asset: StudioAsset | null; error: string | null; replayed: boolean }>;
  loading: boolean;
  error: string | null;
}

export function useAssetRegistration(): UseAssetRegistrationResult {
  const { projectId, setActiveAssetId } = useStudioContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const register = useCallback(
    async (params: RegisterAssetParams): Promise<{
      asset: StudioAsset | null;
      error: string | null;
      replayed: boolean;
    }> => {
      setLoading(true);
      setError(null);
      try {
        const body: Record<string, unknown> = {
          kind: params.kind,
          url: params.url,
          provider: params.provider,
          model: params.model,
          prompt: params.prompt,
          ...(params.thumbnailUrl && { thumbnailUrl: params.thumbnailUrl }),
          ...(params.mimeType && { mimeType: params.mimeType }),
          ...(params.width && { width: params.width }),
          ...(params.height && { height: params.height }),
          ...(params.durationSeconds && { durationSeconds: params.durationSeconds }),
          ...(params.costCredits && { costCredits: params.costCredits }),
          ...(projectId && { projectId }),
          ...(params.requestId && { requestId: params.requestId }),
          ...(params.metadata && { metadata: params.metadata }),
        };

        const res = await fetch("/api/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await res.json();
        if (!res.ok) {
          const msg = data.error || `HTTP ${res.status}`;
          setError(msg);
          return { asset: null, error: msg, replayed: false };
        }

        const asset = data.asset as StudioAsset;
        // Auto-select the newly registered asset.
        if (asset?.id) {
          setActiveAssetId(asset.id);
        }

        // Notify the Assets panel to refresh.
        notifyAssetsChanged();

        return { asset, error: null, replayed: data.replayed ?? false };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Registration failed.";
        setError(msg);
        return { asset: null, error: msg, replayed: false };
      } finally {
        setLoading(false);
      }
    },
    [projectId, setActiveAssetId],
  );

  return { register, loading, error };
}
