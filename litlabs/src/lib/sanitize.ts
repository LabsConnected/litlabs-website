/**
 * Helpers for safely embedding user-controlled values into Supabase/PostgREST
 * filter strings such as `.or("col.eq.<value>,...")`.
 *
 * PostgREST parses these strings with its own grammar, so characters like
 * `,` `.` `(` `)` `"` and `:` are structurally significant. Interpolating raw
 * user input allows an attacker to inject additional filter conditions
 * (a PostgREST/"SQL" injection). Strip those characters before interpolation.
 */

/** Characters that are structurally significant inside a PostgREST filter. */
const POSTGREST_RESERVED = /[(),.:*"'\\%]/g;

/**
 * Sanitize a value for use inside a PostgREST filter expression
 * (e.g. the argument to `.or()` / `.filter()`).
 */
export function sanitizeFilterValue(value: string, maxLength = 100): string {
  return value.replace(POSTGREST_RESERVED, "").trim().slice(0, maxLength);
}

/**
 * Sanitize an identifier (uuid or Clerk id) for use inside a PostgREST filter.
 * Clerk ids look like `user_xxx`; uuids contain hyphens.
 */
export function sanitizeIdentifier(value: string, maxLength = 128): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, maxLength);
}
