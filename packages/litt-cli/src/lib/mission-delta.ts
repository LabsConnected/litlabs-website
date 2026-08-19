/**
 * Mission delta — separates REPOSITORY STATE from MISSION DELTA
 * (dogfood P0: "29 files changed" must never be attributed to a
 * read-only mission when the repo was already dirty before it).
 *
 *   - Capture a Git baseline (porcelain file paths) at mission start.
 *   - At completion, compare the current porcelain against the baseline.
 *   - Files dirty in BOTH are pre-existing — never attributed to the
 *     mission (even if the mission touched the same file further).
 *   - Files newly dirty → changed by the mission.
 *   - Files that were dirty at baseline and are now clean → reverted
 *     by the mission.
 */

/** Parse porcelain v1 lines into canonical file paths.
 *  Handles `XY path`, `?? untracked`, quoted paths ("a b.txt"), and
 *  rename entries (`R  old -> new` — the NEW path wins). */
export function porcelainPaths(porcelain: string): string[] {
  const paths: string[] = [];
  for (const raw of porcelain.split("\n")) {
    const line = raw.trimEnd();
    if (line.length < 4) continue;
    const body = line.slice(3); // skip "XY "
    const path = parsePorcelainPath(body);
    if (path) paths.push(path);
  }
  return paths;
}

/** Parse a single porcelain path body (after the XY/?? status columns). */
export function parsePorcelainPath(body: string): string | null {
  let p = body.trimStart();
  // Rename entries: "old -> new" — the new path is the meaningful one.
  const arrow = p.indexOf(" -> ");
  if (arrow !== -1) p = p.slice(arrow + 4);
  // Quoted paths (spaces/special chars): strip quotes + unescape.
  if (p.startsWith("\"")) {
    const end = p.indexOf("\"", 1);
    if (end === -1) return null;
    p = p.slice(1, end);
    try {
      p = JSON.parse(`"${p}"`);
    } catch {
      // keep the raw inner text
    }
  }
  return p.length > 0 ? p : null;
}

export interface MissionDelta {
  /** Files the mission made dirty (newly changed/untracked). */
  added: string[];
  /** Files the mission cleaned up (were dirty at baseline, now clean). */
  removed: string[];
  /** All files attributed to the mission (added + removed). */
  changed: string[];
}

/** Compare baseline vs current dirty file sets — the mission's delta. */
export function computeMissionDelta(
  baselineFiles: string[],
  currentFiles: string[],
): MissionDelta {
  const baseline = new Set(baselineFiles);
  const current = new Set(currentFiles);
  const added = [...current].filter((f) => !baseline.has(f)).sort();
  const removed = [...baseline].filter((f) => !current.has(f)).sort();
  return { added, removed, changed: [...added, ...removed] };
}
