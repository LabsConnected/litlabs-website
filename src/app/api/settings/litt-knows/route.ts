import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getUserPreferences } from "@/lib/connectors/connector-repository";
import { getUserFacts } from "@/lib/connectors/user-facts";
import { getUserConnections, getUserCapabilities } from "@/lib/connectors/connector-repository";
import {
  USER_CONNECTION_PROVIDERS,
  type UserConnectionProvider,
} from "@/lib/connectors/provider-registry";
import { getUserByClerkId } from "@/lib/user-db";

// GET /api/settings/litt-knows — aggregate "What LiTT Knows" data
async function getHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth(req);
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [user, prefs, facts, connections, capabilities] = await Promise.all([
      getUserByClerkId(clerkId),
      getUserPreferences(clerkId),
      getUserFacts(clerkId),
      getUserConnections(clerkId),
      getUserCapabilities(clerkId),
    ]);

    // Profile section
    const profile = {
      displayName: user?.name ?? null,
      email: user?.email ?? null,
      timezone: prefs?.timezone ?? null,
      locale: prefs?.locale ?? null,
      temperatureUnit: prefs?.temperature_unit ?? "fahrenheit",
      distanceUnit: prefs?.distance_unit ?? "imperial",
      location: {
        city: prefs?.saved_city ?? null,
        region: prefs?.saved_region ?? null,
        country: prefs?.country_code ?? null,
        mode: prefs?.location_mode ?? "none",
      },
      newsInterests: prefs?.news_interests ?? [],
      dailyBriefingEnabled: prefs?.daily_briefing_enabled ?? false,
      dailyBriefingTime: prefs?.daily_briefing_time ?? null,
    };

    // Facts section (memory)
    const memory = facts.map((f) => ({
      id: f.id,
      key: f.key,
      value: f.value,
      source: f.source,
      confidence: f.confidence,
      confirmed: f.confirmed,
      updatedAt: f.updatedAt,
    }));

    // Connections section
    const connectionProviders: Array<{
      provider: UserConnectionProvider;
      label: string;
      description: string;
      connected: boolean;
      status: string;
      accountEmail: string | null;
      grantedCapabilities: string[];
    }> = [];

    for (const [providerId, def] of Object.entries(USER_CONNECTION_PROVIDERS)) {
      const connection = connections.find(
        (c) => c.provider === providerId && c.status !== "disconnected",
      );
      const grantedCaps = def.capabilities.filter((capId) => {
        const capRow = capabilities.find((c) => c.capability_id === capId);
        return capRow?.status === "ready";
      });

      connectionProviders.push({
        provider: providerId as UserConnectionProvider,
        label: def.label,
        description: def.description,
        connected: Boolean(connection),
        status: connection?.status ?? "disconnected",
        accountEmail: connection?.provider_account_email ?? null,
        grantedCapabilities: grantedCaps,
      });
    }

    return NextResponse.json({
      profile,
      memory,
      connections: connectionProviders,
    });
  } catch (err) {
    console.error("[litt-knows] GET error:", err);
    return NextResponse.json({ error: "Failed to load data" }, { status: 500 });
  }
}

export const GET = withRateLimit(getHandler);
