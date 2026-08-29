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
  /** All AUTHORED files attributed to the mission (added + removed). */
  changed: string[];
  /** Build output/caches the mission produced — never counted as edits. */
  generated: string[];
}

/**
 * Build output and caches are PRODUCED by verification, not authored by
 * the mission. A mission that merely ran a typecheck or a build leaves
 * tsconfig.tsbuildinfo and dist/** dirty; reporting those as "files
 * changed by this mission" tells the user LiTT edited their source when
 * it did not.
 *
 * Matched on canonical forward-slash porcelain paths.
 */
const GENERATED_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)dist\//,
  /(^|\/)\.next\//,
  /(^|\/)node_modules\//,
  /(^|\/)coverage\//,
  /(^|\/)[^/]*\.tsbuildinfo$/,
  /(^|\/)\.turbo\//,
  /(^|\/)test-results\//,
  /(^|\/)playwright-report\//,
];

/** Is this path a build artifact / cache rather than authored source? */
export function isGeneratedArtifact(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  return GENERATED_PATH_PATTERNS.some((re) => re.test(p));
}

/**
 * Compare baseline vs current dirty file sets — the mission's delta.
 *
 * `changed` carries only authored source, which is what "N files changed
 * by this mission" must mean. Generated artifacts the mission produced
 * are reported separately in `generated` so they stay visible without
 * being misattributed as edits.
 */
export function computeMissionDelta(
  baselineFiles: string[],
  currentFiles: string[],
): MissionDelta {
  const baseline = new Set(baselineFiles);
  const current = new Set(currentFiles);
  const addedAll = [...current].filter((f) => !baseline.has(f)).sort();
  const removedAll = [...baseline].filter((f) => !current.has(f)).sort();

  const added = addedAll.filter((f) => !isGeneratedArtifact(f));
  const removed = removedAll.filter((f) => !isGeneratedArtifact(f));
  const generated = [...addedAll, ...removedAll].filter(isGeneratedArtifact).sort();

  return { added, removed, changed: [...added, ...removed], generated };
}
