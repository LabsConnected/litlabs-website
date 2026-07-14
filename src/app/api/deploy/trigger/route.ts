import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/roles";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const projectName = process.env.VERCEL_PROJECT_NAME || "litlabs";

  if (!token || !projectId) {
    return NextResponse.json(
      { error: "Vercel deployment not configured. Set VERCEL_TOKEN and VERCEL_PROJECT_ID." },
      { status: 503 }
    );
  }

  try {
    const res = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName,
        project: projectId,
        target: "production",
        gitSource: {
          type: "github",
          ref: "main",
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: data.error?.message || "Vercel API error" }, { status: res.status });
    }

    return NextResponse.json({
      ok: true,
      url: data.url,
      id: data.id,
      state: data.state,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Deploy failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
