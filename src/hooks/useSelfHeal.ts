import { useCallback, useState } from "react";

export interface SelfHealResult {
  ok: boolean;
  reason?: string;
  remediation?: {
    action: string;
    autoFixable: boolean;
    fallbackProvider?: string;
    suggestedPrompt?: string;
  };
}

export interface UseSelfHealReturn {
  validate: (
    type: "image" | "text",
    payload: Record<string, unknown>,
    currentProvider?: string,
  ) => Promise<SelfHealResult>;
  validating: boolean;
  lastResult: SelfHealResult | null;
}

export function useSelfHeal(): UseSelfHealReturn {
  const [validating, setValidating] = useState(false);
  const [lastResult, setLastResult] = useState<SelfHealResult | null>(null);

  const validate = useCallback(
    async (
      type: "image" | "text",
      payload: Record<string, unknown>,
      currentProvider?: string,
    ): Promise<SelfHealResult> => {
      setValidating(true);
      try {
        const res = await fetch("/api/self-heal/validate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type, payload, currentProvider }),
        });
        const data: SelfHealResult = await res.json();
        setLastResult(data);
        return data;
      } catch (err) {
        const fallback: SelfHealResult = {
          ok: false,
          reason: err instanceof Error ? err.message : "Self-heal validation failed",
          remediation: { action: "Retry generation", autoFixable: true },
        };
        setLastResult(fallback);
        return fallback;
      } finally {
        setValidating(false);
      }
    },
    [],
  );

  return { validate, validating, lastResult };
}
