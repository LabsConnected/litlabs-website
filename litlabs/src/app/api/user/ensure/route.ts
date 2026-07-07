import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getOrCreateUser, getUserWallet, type SignupAttributionInput } from "@/lib/user-db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    // Fetch real Clerk user data
    let email = `${clerkId}@placeholder.local`;
    let name = "";
    let clerkMetadata: Record<string, unknown> = {};
    try {
      const clerk = await clerkClient();
      const clerkUser = await clerk.users.getUser(clerkId);
      email = clerkUser.emailAddresses[0]?.emailAddress ?? email;
      name =
        [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
        email.split("@")[0];
      clerkMetadata = {
        public: clerkUser.publicMetadata,
        unsafe: clerkUser.unsafeMetadata,
      };
    } catch {
      // Clerk API unavailable — proceed with placeholder
    }

    // getOrCreateUser uses admin client server-side (bypasses RLS)
    // and inserts wallet with 500 coins on first create
    const result = await getOrCreateUser(clerkId, email, name, {
      ...parseAttributionHeader(req),
      clerkMetadata,
    });

    if (!result.user) {
      const detail = result.error || "Unknown error (Supabase may not be configured in this environment)";
      return NextResponse.json(
        { error: "Failed to create user", detail },
        { status: 500 },
      );
    }

    // Also ensure wallet exists (idempotent — getUserWallet auto-creates if missing)
    const wallet = await getUserWallet(clerkId);

    return NextResponse.json({
      success: true,
      isNew: result.isNew,
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
      balance: wallet.balance,
    });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

function parseAttributionHeader(req: NextRequest): SignupAttributionInput {
  try {
    const raw = req.headers.get("x-lit-signup-attribution");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as {
      source?: string;
      referrer?: string;
      landingPath?: string;
      utm?: Record<string, string>;
    };
    return {
      source: parsed.source,
      referrer: parsed.referrer,
      landingPath: parsed.landingPath,
      utm: parsed.utm,
    };
  } catch {
    return {};
  }
}

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json(
      { exists: false, error: "Not authenticated" },
      { status: 401 },
    );
  }

  try {
    const wallet = await getUserWallet(clerkId);
    const exists = wallet.id !== "fallback";
    return NextResponse.json({ exists, balance: wallet.balance });
  } catch {
    return NextResponse.json({ exists: false, balance: 0 });
  }
}
