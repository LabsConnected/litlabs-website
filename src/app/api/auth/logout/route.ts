import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

/**
 * Sign out the current user.
 *
 * Accepts both GET and POST so a plain <Link> or <a> can log a user out, and
 * clears the JWT cookie (`auth-token`) plus all known Clerk session cookies.
 *
 * After clearing cookies we redirect to the public landing page so the user
 * is dropped out of any authenticated route immediately.
 */
async function handleLogout(req: NextRequest) {
  const cookieStore = await cookies();
  // JWT (custom) session
  cookieStore.delete("auth-token");
  // Clerk session cookies — name varies by environment/region, so we cover
  // the most common ones used by Clerk.
  cookieStore.delete("__session");
  cookieStore.delete("__client_uat");
  cookieStore.delete("__clerk_db_jwt");
  cookieStore.delete("__client");
  return NextResponse.redirect(new URL("/", req.url));
}

export const GET = handleLogout;
export const POST = handleLogout;
