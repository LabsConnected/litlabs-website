/**
 * Business Profile — server-side persistence.
 *
 * Storage: the `settings` JSONB column on `studio_projects`, under the
 * namespaced key `businessProfile`. Rationale:
 * - The column already exists in production (migration
 *   20260720000000_studio_projects_github.sql), so this works with zero
 *   new migrations — no manual `apply-migrations.js` step before the
 *   feature is live.
 * - Reads/writes are ownership-scoped (id + user_id) exactly like the
 *   rest of the project repository.
 * - The project's list queries deliberately exclude the settings blob
 *   (see STUDIO_LIST_COLUMNS), so profiles never inflate the switcher;
 *   this module issues its own targeted selects.
 *
 * Per-user reads ("also readable per user") resolve the user's default
 * profile: the most recently updated project that has one. No separate
 * user-level store is needed — the profile always belongs to a project,
 * and the intake UI adopts a pending description into the first project
 * the user opens (see DescribeBusinessBox / guided-start adoption).
 */

import { supabaseAdmin } from "@/lib/supabase";
import {
  isBusinessProfile,
  validateBusinessProfile,
  type BusinessProfile,
} from "./business-profile";

const TABLE = "studio_projects";
const SETTINGS_KEY = "businessProfile";

type SettingsRow = {
  settings: Record<string, unknown> | null;
  updated_at?: string;
};

function readProfileFromSettings(settings: unknown): BusinessProfile | null {
  if (!settings || typeof settings !== "object") return null;
  const candidate = (settings as Record<string, unknown>)[SETTINGS_KEY];
  return isBusinessProfile(candidate) ? candidate : null;
}

/**
 * Get the business profile for a project. Returns null when the project
 * doesn't exist, isn't owned by the user, or has no profile yet.
 */
export async function getBusinessProfileForProject(
  projectId: string,
  userId: string,
): Promise<BusinessProfile | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("settings")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return readProfileFromSettings((data as SettingsRow).settings);
}

/**
 * Save (create or replace) the business profile for a project.
 * Validates + sanitizes first; merges into the existing settings blob so
 * other settings keys are preserved. Returns the stored profile, or null
 * when the project doesn't exist / isn't owned by the user.
 */
export async function saveBusinessProfileForProject(
  projectId: string,
  userId: string,
  input: unknown,
): Promise<{ profile: BusinessProfile; errors: string[] } | null> {
  const { profile, errors } = validateBusinessProfile(input);
  const now = new Date().toISOString();
  const stored: BusinessProfile = {
    ...profile,
    capturedAt: profile.capturedAt ?? now,
    updatedAt: now,
  };

  // Read current settings so we don't clobber unrelated keys.
  const { data: current, error: readError } = await supabaseAdmin
    .from(TABLE)
    .select("settings")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (readError || !current) return null;

  const settings: Record<string, unknown> =
    (current as SettingsRow).settings && typeof (current as SettingsRow).settings === "object"
      ? { ...((current as SettingsRow).settings as Record<string, unknown>) }
      : {};
  settings[SETTINGS_KEY] = stored;

  const { error: writeError, data: updated } = await supabaseAdmin
    .from(TABLE)
    .update({ settings, updated_at: now })
    .eq("id", projectId)
    .eq("user_id", userId)
    .select("settings")
    .maybeSingle();

  if (writeError || !updated) return null;
  const saved = readProfileFromSettings((updated as SettingsRow).settings);
  return { profile: saved ?? stored, errors };
}

/**
 * Resolve the user's default business profile: the profile on their most
 * recently updated project that has one. Returns null when the user has
 * no profile on any project.
 */
export async function getDefaultBusinessProfile(
  userId: string,
): Promise<BusinessProfile | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("settings, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error || !data) return null;
  for (const row of data as SettingsRow[]) {
    const profile = readProfileFromSettings(row.settings);
    if (profile) return profile;
  }
  return null;
}

/**
 * Server-side `getBusinessProfile()` for the downstream contract.
 * - With a projectId: that project's profile (ownership-checked).
 * - Without: the user's default profile across projects.
 */
export async function getBusinessProfile(args: {
  userId: string;
  projectId?: string;
}): Promise<BusinessProfile | null> {
  if (args.projectId) {
    return getBusinessProfileForProject(args.projectId, args.userId);
  }
  return getDefaultBusinessProfile(args.userId);
}
