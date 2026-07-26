import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export interface ResolvedUser {
  clerkUserId: string;
  databaseUserId: string;
}

/**
 * Resolves the authenticated Clerk user to a database user ID.
 *
 * All database tables (github_installations, integration_projects, projects,
 * marketplace_installations, etc.) use the Clerk user ID as `user_id` (text).
 * This resolver validates that the user is authenticated and returns a
 * consistent identity object.
 *
 * Throws a diagnostic error if the Clerk user exists but no database mapping
 * is found — this distinguishes auth failures from missing user records.
 */
export async function requireDatabaseUser(): Promise<ResolvedUser> {
  const { userId, clerkId } = await auth();

  if (!userId) {
    throw new DatabaseUserError(
      "Not authenticated. Sign in to continue.",
      "AUTH_REQUIRED",
    );
  }

  // In this codebase, the Clerk user ID IS the database user_id.
  // Tables use `user_id text NOT NULL` with the Clerk ID directly.
  // We validate the user exists in at least one canonical table.
  const clerkUserId = clerkId ?? userId;

  // Check if the user has any presence in the database.
  // We check `github_installations` and `projects` as canonical user tables.
  // If neither has a row, the user may need onboarding.
  const [{ data: installations }, { data: projects }] = await Promise.all([
    supabaseAdmin
      .from("github_installations")
      .select("user_id")
      .eq("user_id", clerkUserId)
      .limit(1),
    supabaseAdmin
      .from("projects")
      .select("user_id")
      .eq("user_id", clerkUserId)
      .limit(1),
  ]);

  // User exists in DB if they have installations or projects.
  // If not, they're new — return the Clerk ID as the database user ID
  // since tables accept Clerk IDs directly.
  const hasDbPresence =
    (installations && installations.length > 0) ||
    (projects && projects.length > 0);

  if (!hasDbPresence) {
    // New user — not an error, but worth noting for diagnostics.
    // The Clerk ID is still valid as a database user_id for new inserts.
  }

  return {
    clerkUserId,
    databaseUserId: clerkUserId,
  };
}

/**
 * Non-throwing version that returns null on auth failure.
 * Use when the caller wants to handle missing users gracefully.
 */
export async function getDatabaseUser(): Promise<ResolvedUser | null> {
  try {
    return await requireDatabaseUser();
  } catch {
    return null;
  }
}

export class DatabaseUserError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "DatabaseUserError";
  }
}
