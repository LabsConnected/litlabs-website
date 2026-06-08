import bcrypt from "bcryptjs";

// Strictly hardcoded credentials to bypass incorrect Vercel env vars
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "laidbacknostress4life@gmail.com";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "$2b$12$OYaH8Wsqshll3Lx8NOk9Ze9hePqP6KH1a0NGwYH.XzxUFEu2/OtOm";
const ADMIN_NAME = process.env.ADMIN_NAME || "Larry — CEO";

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
