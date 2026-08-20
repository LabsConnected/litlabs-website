import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";

/**
 * POST /api/deploy/trigger
 *
 * Triggers a Railway deployment via the Railway GraphQL API.
 * Requires admin auth and RAILWAY_API_TOKEN + RAILWAY_SERVICE_ID env vars.
 *
 * Railway deployments are normally triggered by git push, but this endpoint
 * allows manual redeployment from the admin dashboard.
 *
 * Replaced the former Vercel deploy trigger (api.vercel.com/v13/deployments).
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const token = process.env.RAILWAY_API_TOKEN;
  const serviceId = process.env.RAILWAY_SERVICE_ID;

  if (!token || !serviceId) {
    return NextResponse.json(
      { error: "Railway deployment not configured. Set RAILWAY_API_TOKEN and RAILWAY_SERVICE_ID." },
      { status: 503 }
    );
  }

  try {
    // Railway GraphQL API — trigger a redeployment of the service.
    // This creates a new deployment from the latest connected branch.
    const res = await fetch("https://backboard.railway.app/graphql/v1", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          mutation DeployService($serviceId: String!) {
            deploymentCreate(input: { serviceId: $serviceId, status: QUEUED }) {
              id
              status
            }
          }
        `,
        variables: { serviceId },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      const message = data.errors?.[0]?.message || "Railway API error";
      return NextResponse.json({ error: message }, { status: res.status });
    }

    const deployment = data.data?.deploymentCreate;
    return NextResponse.json({
      ok: true,
      id: deployment?.id,
      status: deployment?.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Deploy failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
