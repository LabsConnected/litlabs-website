/**
 * Pure verdict → exit-code helper so the golden acceptance runner can be
 * unit-tested without pulling in the full Playwright browser harness.
 *
 * Only an exact "PASS" or a decorated "PASS: ..." string is treated as success.
 * "PASSED" or any other prefix must NOT accidentally pass.
 */
export function exitCodeForVerdict(verdict) {
  const v = verdict?.verdict;
  if (typeof v !== "string") return 1;
  if (v === "PASS" || v.startsWith("PASS:")) return 0;
  return 1;
}
