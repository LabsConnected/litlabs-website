import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "..", "data", "auth.db");

function getDb() {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  return db;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials.email as string;
        const password = credentials.password as string;
        if (!email || !password) return null;

        const db = getDb();
        const user = db
          .prepare("SELECT * FROM users WHERE email = ?")
          .get(email) as any;
        db.close();

        if (!user) return null;
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = (user as any).id;
      return token;
    },
    async session({ session, token }) {
      (session as any).user.id = token.id;
      return session;
    },
  },
});

export async function createUser(email: string, password: string, name: string) {
  const db = getDb();
  const id = crypto.randomUUID();
  const hash = await bcrypt.hash(password, 12);
  try {
    db.prepare(
      "INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)"
    ).run(id, email, hash, name);
    db.close();
    return { id, email, name };
  } catch (e: any) {
    db.close();
    if (e.message.includes("UNIQUE")) throw new Error("Email already exists");
    throw e;
  }
}
