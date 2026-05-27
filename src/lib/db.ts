import bcrypt from "bcryptjs";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const ADMIN_NAME = process.env.ADMIN_NAME || "Admin";

export interface User {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Verify admin credentials from environment variables.
 * Returns the user object on success, null on failure.
 */
export async function verifyPassword(email: string, password: string): Promise<User | null> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD_HASH) return null;
  if (email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return null;

  const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  if (!valid) return null;

  return { id: "admin", email: ADMIN_EMAIL, name: ADMIN_NAME };
}

/**
 * Look up user by email. Currently only supports the admin user.
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    return { id: "admin", email: ADMIN_EMAIL, name: ADMIN_NAME };
  }
  return null;
}
