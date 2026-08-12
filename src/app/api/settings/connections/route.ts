import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  getUserConnections,
  getUserCapabilities,
  revokeUserConnection,
  upsertCapability,
} from "@/lib/connectors/connector-repository";
import {
  USER_CONNECTION_PROVIDERS,
  CAPABILITY_DEFINITIONS,
  INCREMENTAL_SCOPES,
  type CapabilityId,
  type UserConnectionProvider,
} from "@/lib/connectors/provider-registry";

// GET /api/settings/connections — list user connections + capabilities
async function getHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth(req);
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [connections, capabilities] = await Promise.all([
      getUserConnections(clerkId),
      getUserCapabilities(clerkId),
    ]);

    // Build provider status map
    const providers: Array<{
      provider: UserConnectionProvider;
      label: string;
      description: string;
      connected: boolean;
      status: string;
      accountEmail: string | null;
      capabilities: Array<{
        id: CapabilityId;
        label: string;
        description: string;
        permission: string;
        mutation: boolean;
        status: string;
        scopes: string[];
      }>;
    }> = [];

    for (const [providerId, def] of Object.entries(USER_CONNECTION_PROVIDERS)) {
      const connection = connections.find(
        (c) => c.provider === providerId && c.status !== "disconnected",
      );
      const providerCaps = def.capabilities;

      const capsWithStatus = providerCaps.map((capId) => {
        const capDef = CAPABILITY_DEFINITIONS[capId];
        const capRow = capabilities.find((c) => c.capability_id === capId);
        return {
          id: capId,
          label: capDef?.label ?? capId,
          description: capDef?.description ?? "",
          permission: capDef?.permission ?? "none",
          mutation: capDef?.mutation ?? false,
          status: capRow?.status ?? "needs_connection",
          scopes: INCREMENTAL_SCOPES[capId] ?? [],
        };
      });

      providers.push({
        provider: providerId as UserConnectionProvider,
        label: def.label,
        description: def.description,
        connected: Boolean(connection),
        status: connection?.status ?? "disconnected",
        accountEmail: connection?.provider_account_email ?? null,
        capabilities: capsWithStatus,
      });
    }

    return NextResponse.json({ providers });
  } catch (err) {
    console.error("[connections] GET error:", err);
    return NextResponse.json({ error: "Failed to load connections" }, { status: 500 });
  }
}

// DELETE /api/settings/connections?provider=google — disconnect/revoke
async function deleteHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth(req);
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const provider = url.searchParams.get("provider") as UserConnectionProvider | null;
    if (!provider || !USER_CONNECTION_PROVIDERS[provider]) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

    const connections = await getUserConnections(clerkId);
    const connection = connections.find(
      (c) => c.provider === provider && c.status !== "disconnected",
    );
    if (!connection) {
      return NextResponse.json({ error: "No active connection for this provider" }, { status: 404 });
    }

    // Revoke the connection
    const ok = await revokeUserConnection(clerkId, connection.id);
    if (!ok) {
      return NextResponse.json({ error: "Failed to revoke connection" }, { status: 500 });
    }

    // Mark all capabilities for this provider as disabled
    const providerDef = USER_CONNECTION_PROVIDERS[provider];
    await Promise.all(
      providerDef.capabilities.map((capId) =>
        upsertCapability(clerkId, capId, provider, "disabled", connection.id),
      ),
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[connections] DELETE error:", err);
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}

export const GET = withRateLimit(getHandler);
export const DELETE = withRateLimit(deleteHandler);
