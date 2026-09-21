/**
 * Preview Clerk env extraction (web app side).
 *
 * The web app resolves the project's configured secrets from its secret
 * store and passes only the Clerk subset to the terminal server, which
 * injects them into the preview process environment. Extracting here —
 * rather than shipping every project secret over the internal API —
 * keeps unrelated secrets out of the preview path entirely.
 *
 * Mirrors terminal-server/preview/PreviewManager.ts `extractClerkEnv`
 * (kept as a separate copy on purpose: the two services deploy
 * independently and must not share a module).
 */

function cleanEnvValue(value: string | undefined): string {
  if (!value) return "";
  let v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

/**
 * Pick CLERK_SECRET_KEY and the publishable key out of a decrypted
 * project-secrets map. Maps CLERK_PUBLISHABLE_KEY to
 * NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (the name @clerk/nextjs expects)
 * when the latter is absent. Drops empties and ignores everything else.
 */
export function extractClerkEnvFromSecrets(
  secrets: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const secret = cleanEnvValue(secrets.CLERK_SECRET_KEY);
  if (secret) out.CLERK_SECRET_KEY = secret;
  const publishable = cleanEnvValue(
    secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? secrets.CLERK_PUBLISHABLE_KEY,
  );
  if (publishable) out.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = publishable;
  return out;
}
