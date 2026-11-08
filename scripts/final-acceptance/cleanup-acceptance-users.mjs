/**
 * Delete disposable Clerk TEST-instance users created by the acceptance
 * harness — nothing else.
 *
 * Clerk development instances cap at 100 users; each acceptance iteration
 * permanently creates one (create-fresh-user.mjs), so a handful of
 * acceptance runs exhausts the instance and every following run fails at
 * user creation (HTTP 403 user_quota_exceeded — observed on staging
 * acceptance 42446254903).
 *
 * SAFETY CONTRACT — what this script may delete:
 *   ONLY users where public_metadata.littAcceptance === true. That flag
 *   is stamped by create-fresh-user.mjs and provision-golden-project.mjs;
 *   it is the single documented marker of a disposable acceptance
 *   identity. Every other user — owner test accounts, CLERK_TEST_USER_A/B,
 *   other agents' e2e identities, beta users — is left alone no matter
 *   how stale they look.
 *
 * Usage:
 *   CLERK_SECRET_KEY=sk_test_... node cleanup-acceptance-users.mjs [--dry]
 *   --dry   list what would be deleted; delete nothing.
 */

const CLERK_API = "https://api.clerk.com/v1";

/** The ONLY deletion predicate. Exported for tests — never widen it to
 *  heuristics (email patterns, age, inactivity). The tag is the contract. */
export function isDisposableAcceptanceUser(user) {
  return user?.public_metadata?.littAcceptance === true;
}

export async function listAllUsers(secretKey) {
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    "User-Agent": "LiTT-acceptance-cleanup/1.0",
  };
  const users = [];
  let offset = 0;
  for (;;) {
    const resp = await fetch(`${CLERK_API}/users?limit=100&offset=${offset}`, { headers });
    if (!resp.ok) {
      throw new Error(`Clerk user list failed: HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`);
    }
    const page = await resp.json();
    if (!Array.isArray(page) || page.length === 0) break;
    users.push(...page);
    offset += page.length;
    if (page.length < 100) break;
  }
  return { users, headers };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is required");
  const DRY = process.argv.includes("--dry");
  const { users, headers } = await listAllUsers(secretKey);
  const disposable = users.filter(isDisposableAcceptanceUser);
  console.log(`${users.length} user(s) total; ${disposable.length} tagged disposable acceptance user(s)`);
  let deleted = 0;
  for (const u of disposable) {
    const emails = (u.email_addresses ?? []).map((e) => e.email_address).join(",");
    if (DRY) {
      console.log(`[dry] would delete ${u.id} (${emails})`);
      continue;
    }
    const resp = await fetch(`${CLERK_API}/users/${u.id}`, { method: "DELETE", headers });
    if (!resp.ok) {
      console.error(`delete ${u.id}: HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`);
      continue;
    }
    deleted += 1;
    console.log(`deleted ${u.id} (${emails})`);
  }
  console.log(DRY ? `[dry] ${disposable.length} deletion(s) previewed` : `${deleted} disposable acceptance user(s) deleted`);
  if (!DRY && deleted < disposable.length) process.exitCode = 1;
}
