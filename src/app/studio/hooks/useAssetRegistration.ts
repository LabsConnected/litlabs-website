"use client";

/**
 * useAssetRegistration — client-side hook for registering creator
 * outputs as assets in the Asset Lake.
 *
 * This is the WRITE seam that creators call after a successful
 * generation. It posts to /api/assets and returns the canonical
 * StudioAsset.
 *
 * Usage:
 *   const { register, loading, error } = useAssetRegistration();
 *   const { asset } = await register({ kind: "image", url, provider, ... });
 */

import { useState, useCallback } from "react";
import { useStudioContext } from "@/app/studio/context/StudioContext";
import { notifyAssetsChanged } from "@/app/studio/hooks/useAssetsRefresh";
import type { AssetKind, StudioAsset } from "@/lib/assets/types";

export interface RegisterAssetParams {
  kind: AssetKind;
  url: string;
  thumbnailUrl?: string;
  mimeType?: string;
  provider?: string;
  model?: string;
  prompt?: string;
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
          ...(params.thumbnailUrl && { thumbnailUrl: params.thumbnailUrl }),
          ...(params.mimeType && { mimeType: params.mimeType }),
          ...(params.provider && { provider: params.provider }),
          ...(params.model && { model: params.model }),
          ...(params.prompt && { prompt: params.prompt }),
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
