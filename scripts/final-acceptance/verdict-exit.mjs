/**
 * Pure verdict → exit-code helper so the golden acceptance runner can be
 * unit-tested without pulling in the full Playwright browser harness.
 */
export function exitCodeForVerdict(verdict) {
  return verdict?.verdict?.startsWith("PASS") ? 0 : 1;
}
