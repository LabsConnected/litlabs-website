#!/usr/bin/env tsx
/**
 * pnpm test:ghl-payload
 *
 * Simulates a Vapi end-of-call-report event with a realistic transcript,
 * then shows the exact GHL payload that would be generated.
 *
 * Usage:
 *   npx tsx scripts/test-ghl-payload.ts
 *   npx tsx scripts/test-ghl-payload.ts --send   # also sends to GHL_WEBHOOK_URL
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";

function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(__dirname, "..");
}

const root = findProjectRoot();
const envLocal = path.join(root, ".env.local");
if (fs.existsSync(envLocal)) dotenv.config({ path: envLocal });
else dotenv.config();

const BASE_URL = process.env.VAPI_BRIDGE_BASE_URL ?? "https://litlabs.net";
const TOKEN = process.env.LITTLABS_VAPI_TOOL_TOKEN;
const DO_SEND = process.argv.includes("--send");

const TEST_TRANSCRIPTS = [
  {
    label: "Hot lead — website",
    transcript: `User: Hi, I'm calling because I need a new website for my business. I have a budget of $5000 and I want to start ASAP. Can you help me build a landing page with SEO?
LiTT: Absolutely! We can help you build a professional landing page with SEO optimization. We have experience building fast, modern websites. Would you like to get started today?
User: Yes, let's do it. How soon can we start?`,
  },
  {
    label: "Warm lead — AI agent",
    transcript: `User: Hi, I'm interested in getting an AI agent for my customer support. I've been thinking about automating our chatbot. Can you tell me more about your AI services?
LiTT: We specialize in AI agents and chatbots. We can build a custom AI assistant that handles customer support 24/7. Would you like to learn more about pricing?
User: Yes, I'd like a quote. I'm considering this for next quarter.`,
  },
  {
    label: "Cold — music production",
    transcript: `User: Hi, I'm just curious about your music production services. I might want to make a song someday but I'm not sure yet.
LiTT: We'd love to help when you're ready! We offer full music production services including mixing and mastering. Feel free to reach out whenever you're ready.
User: OK, thanks. I'll think about it.`,
  },
  {
    label: "Support — existing user",
    transcript: `User: Hey, I'm having an issue with my project. The deployment is broken and I need help fixing it.
LiTT: I can see you're working on the litlabs-website project. Let me help you troubleshoot the deployment issue. Can you tell me what error you're seeing?
User: It's a build error, something about a missing module.`,
  },
];

async function main() {
  if (!TOKEN) {
    console.error("Missing LITTLABS_VAPI_TOOL_TOKEN in env");
    process.exit(1);
  }

  for (const test of TEST_TRANSCRIPTS) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Test: ${test.label}`);
    console.log(`${"=".repeat(60)}\n`);

    const body = {
      type: "end-of-call-report",
      call: {
        id: `ghl_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        status: "ended",
        startedAt: new Date(Date.now() - 120000).toISOString(),
        endedAt: new Date().toISOString(),
        customer: { number: "+12314285411" },
      },
      artifact: {
        durationMs: 120000,
        transcript: test.transcript,
        messages: test.transcript.split("\n").map((line) => {
          const [role, ...rest] = line.split(": ");
          return { role: role.toLowerCase(), content: rest.join(": ") };
        }),
      },
    };

    const url = DO_SEND
      ? `${BASE_URL}/api/vapi/events`
      : `${BASE_URL}/api/ghl/test`;

    console.log(`POST ${url}`);
    console.log(`Transcript preview: ${test.transcript.slice(0, 80)}...\n`);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      console.log(`Status: ${res.status}`);
      try {
        const json = JSON.parse(text);
        console.log(`Response: ${JSON.stringify(json, null, 2)}`);
      } catch {
        console.log(`Response: ${text}`);
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Wait between tests
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("Done! Check the Vercel function logs for [GHL] entries.");
  console.log("If GHL_WEBHOOK_URL is set, payloads were sent to GHL.");
  console.log(`${"=".repeat(60)}\n`);
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
