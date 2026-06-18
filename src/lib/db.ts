import bcrypt from "bcryptjs";

// Admin credentials are read from environment only. Auth is disabled if unset.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const ADMIN_NAME = process.env.ADMIN_NAME || "Admin";

export interface User {
  id: string;
  email: string;
  name: string | null;
}

export async function verifyPassword(
  email: string,
  password: string
): Promise<User | null> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD_HASH) return null;
  const identifier = email.trim().toLowerCase();
  const adminEmail = ADMIN_EMAIL.trim().toLowerCase();
  const adminUsername = ADMIN_EMAIL.split("@")[0].trim().toLowerCase();

  if (identifier !== adminEmail && identifier !== adminUsername) return null;

  const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  if (!valid) return null;
  return { id: "admin", email: ADMIN_EMAIL, name: ADMIN_NAME };
}

export async function findUserByEmail(email: string): Promise<User | null> {
  if (!ADMIN_EMAIL) return null;
  const identifier = email.trim().toLowerCase();
  const adminEmail = ADMIN_EMAIL.trim().toLowerCase();
  const adminUsername = ADMIN_EMAIL.split("@")[0].trim().toLowerCase();

  if (identifier === adminEmail || identifier === adminUsername) {
    return { id: "admin", email: ADMIN_EMAIL, name: ADMIN_NAME };
  }
  return null;
}
