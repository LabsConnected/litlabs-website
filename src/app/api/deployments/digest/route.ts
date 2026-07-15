// Daily deploy digest endpoint — can be triggered by cron or manually
import { NextRequest, NextResponse } from "next/server";
import { buildDeployDigest } from "@/lib/deployments";
import { sendDiscordMessage } from "@/lib/discord";
import { sanitizeProviderError } from "@/lib/provider-error";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hours = Math.min(
      Math.max(Number(searchParams.get("hours") || "24"), 1),
      168,
    );

    const digest = await buildDeployDigest(hours);

    const statusLines = Object.entries(digest.byStatus)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => `• ${status}: ${count}`)
      .join("\n");

    const envLines = Object.entries(digest.byEnvironment)
      .filter(([, count]) => count > 0)
      .map(([env, count]) => `• ${env}: ${count}`)
      .join("\n");

    const failedSection = digest.failed.length
      ? `**Failed deploys (${digest.failed.length}):**\n${digest.failed
        .map(
          (d) =>
            `• ${d.branch} → ${d.environment} at ${new Date(
              d.updated_at,
            ).toLocaleString()}`,
        )
        .join("\n")}`
      : "";

    const pendingSection = digest.pending.length
      ? `**Pending deploys (${digest.pending.length}):**\n${digest.pending
        .map((d) => `• ${d.branch} → ${d.environment} (${d.status})`)
        .join("\n")}`
      : "";

    const summary =
      `**Daily Deploy Digest — last ${hours}h**\n\n` +
      `**Total:** ${digest.total}\n\n` +
      `**By status:**\n${statusLines || "• No deploys"}\n\n` +
      `**By environment:**\n${envLines || "• No deploys"}\n\n` +
      (failedSection ? failedSection + "\n\n" : "") +
      (pendingSection ? pendingSection + "\n\n" : "");

    const sent = await sendDiscordMessage("agents", {
      username: "LiTBiT Daily Digest",
      embeds: [
        {
          title: "📋 Daily Deploy Digest",
          description: summary,
          color: digest.failed.length ? 0xff0040 : 0x00f0ff,
          timestamp: new Date().toISOString(),
        },
      ],
    });

    if (!sent) {
      return NextResponse.json(
        { digest, warning: "Discord webhook not configured" },
        { status: 200 },
      );
    }

    return NextResponse.json({ success: true, digest }, { status: 200 });
  } catch (error) {
    console.error("[api/deployments/digest] POST error:", error);
    const { status, error: message } = sanitizeProviderError(error);
    return NextResponse.json(
      { error: "Failed to build digest", message },
      { status },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hours = Math.min(
      Math.max(Number(searchParams.get("hours") || "24"), 1),
      168,
    );
    const digest = await buildDeployDigest(hours);
    return NextResponse.json(digest);
  } catch (error) {
    console.error("[api/deployments/digest] GET error:", error);
    const { status, error: message } = sanitizeProviderError(error);
    return NextResponse.json(
      { error: "Failed to build digest", message },
      { status },
    );
  }
}
