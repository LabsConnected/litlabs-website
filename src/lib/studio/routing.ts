/**
 * Studio Routing — URL param helpers for the "No Page Bounce" strategy.
 *
 * The Studio uses URL search params (not Next.js routes) to represent
 * workspace state. This allows deep-linking and state restoration without
 * full-page navigation.
 *
 * Example URL:
 *   /studio?mode=canvas&leftRail=files&bottomDock=terminal&node=hero
 */

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";

export type StudioUrlParams = {
  mode?: string;
  leftRail?: string;
  rightPanel?: string;
  bottomDock?: string;
  node?: string;
  project?: string;
};

export function useStudioUrlParams() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const params: StudioUrlParams = useMemo(() => ({
    mode: searchParams.get("mode") ?? undefined,
    leftRail: searchParams.get("leftRail") ?? undefined,
    rightPanel: searchParams.get("rightPanel") ?? undefined,
    bottomDock: searchParams.get("bottomDock") ?? undefined,
    node: searchParams.get("node") ?? undefined,
    project: searchParams.get("project") ?? undefined,
  }), [searchParams]);

  const updateParams = useCallback(
    (updates: Partial<StudioUrlParams>) => {
      const current = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === undefined || value === null) {
          current.delete(key);
        } else {
          current.set(key, value);
        }
      });
      const queryString = current.toString();
      router.replace(`${pathname}${queryString ? `?${queryString}` : ""}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  return { params, updateParams };
}
