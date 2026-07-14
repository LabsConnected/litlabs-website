#!/usr/bin/env node
// Daily deploy digest — cron-ready script
// Reads last 24h of deployments from Supabase and sends a Discord summary.
// Run via cron: 0 9 * * 1-5 /usr/bin/node /home/litbit/LiTTreeLabstudios/scripts/daily-deploy-digest.mjs
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const webhookUrl =
  process.env.DISCORD_ALERTS_WEBHOOK || process.env.DISCORD_SYSTEM_WEBHOOK;

if (!supabaseUrl || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const hours = Number(process.argv[2]) || 24;

async function main() {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from("deployments")
    .select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch deployments:", error.message);
    process.exit(1);
  }

  const items = rows || [];
  const byStatus = {
    queued: 0,
    building: 0,
    deploying: 0,
    live: 0,
    failed: 0,
    cancelled: 0,
  };
  const byEnvironment = {
    preview: 0,
    staging: 0,
    production: 0,
  };

  items.forEach((d) => {
    byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    byEnvironment[d.environment] = (byEnvironment[d.environment] ?? 0) + 1;
  });

  const failed = items.filter((d) => d.status === "failed");
  const pending = items.filter((d) =>
    ["queued", "building", "deploying"].includes(d.status),
  );

  const statusLines = Object.entries(byStatus)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `• ${status}: ${count}`)
    .join("\n");
  const envLines = Object.entries(byEnvironment)
    .filter(([, count]) => count > 0)
    .map(([env, count]) => `• ${env}: ${count}`)
    .join("\n");

  const failedSection = failed.length
    ? `**Failed deploys (${failed.length}):**\n${failed
        .map(
          (d) =>
            `• ${d.branch} → ${d.environment} at ${new Date(
              d.updated_at,
            ).toLocaleString()}`,
        )
        .join("\n")}`
    : "";

  const pendingSection = pending.length
    ? `**Pending deploys (${pending.length}):**\n${pending
        .map((d) => `• ${d.branch} → ${d.environment} (${d.status})`)
        .join("\n")}`
    : "";

  const summary =
    `**Daily Deploy Digest — last ${hours}h**\n\n` +
    `**Total:** ${items.length}\n\n` +
    `**By status:**\n${statusLines || "• No deploys"}\n\n` +
    `**By environment:**\n${envLines || "• No deploys"}\n\n` +
    (failedSection ? failedSection + "\n\n" : "") +
    (pendingSection ? pendingSection + "\n\n" : "");

  if (!webhookUrl) {
    console.log("No Discord webhook configured. Digest:\n");
    console.log(summary);
    process.exit(0);
  }

  const payload = {
    username: "LiTBiT Daily Digest",
    embeds: [
      {
        title: "📋 Daily Deploy Digest",
        description: summary,
        color: failed.length ? 0xff0040 : 0x00f0ff,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error("Discord webhook failed:", response.status);
    process.exit(1);
  }

  console.log("Digest sent successfully.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
