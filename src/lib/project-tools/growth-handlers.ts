/**
 * Growth Engine tool handlers — the six growth.* tools.
 *
 * Each handler follows the same ToolHandler type as the core project tools:
 *   (userId, args) => Promise<ToolResult>
 *
 * These are imported by registry.ts and registered in PROJECT_TOOLS, so
 * both /api/vapi/tools and the LiTT Voice Runtime dispatch through them.
 *
 * Phase 1a: all providers in manual mode. No paid API calls.
 */

import "server-only";

import { ok, fail } from "@/lib/vapi-tools";
import { type ToolHandler } from "@/lib/project-tools/registry";
import {
  isGrowthProviderId,
  type GrowthProviderId,
} from "@/lib/growth/types";
import { getProvider } from "@/lib/growth/provider-registry";
import {
  generateContent,
  isDuplicate,
} from "@/lib/growth/content-engine";
import {
  createCampaign,
  getCampaign,
  createContent,
  getContent,
  listDrafts,
  approveContent,
  rewriteContent,
  ensureManualAccount,
  createPublication,
  markPublished,
  getRules,
  newIdempotencyKey,
} from "@/lib/growth/growth-repository";
import { enforcePrePublishRules } from "@/lib/growth/policy-engine";
import { auditGrowthAction } from "@/lib/growth/audit";
import { buildUtmUrl, defaultUtmParams, campaignSlug } from "@/lib/growth/utm";

// ─── String helpers ─────────────────────────────────────────────

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function parseProviders(raw: unknown): GrowthProviderId[] | null {
  if (!Array.isArray(raw)) return null;
  const result: GrowthProviderId[] = [];
  for (const item of raw) {
    if (typeof item === "string" && isGrowthProviderId(item)) {
      result.push(item);
    }
  }
  return result.length > 0 ? result : null;
}

// ─── growth_create_campaign ─────────────────────────────────────

export const toolGrowthCreateCampaign: ToolHandler = async (userId, args) => {
  const name = str(args.name);
  if (!name) return fail("growth_create_campaign requires a name.");
  const eventSummary = str(args.event_summary);
  if (!eventSummary) return fail("growth_create_campaign requires an event_summary.");

  const objective = optStr(args.objective);
  const targetProviders = parseProviders(args.target_providers) ?? ["x"];

  const campaign = await createCampaign(userId, {
    name,
    objective,
    event_summary: eventSummary,
    target_providers: targetProviders,
  });

  if (!campaign) {
    return fail("Failed to create campaign. The database may be unavailable.");
  }

  await auditGrowthAction({
    userId,
    action: "create_campaign",
    campaignId: campaign.id,
    success: true,
    metadata: { name, objective: objective ?? null, targetProviders },
  });

  return ok(null, `Created campaign "${campaign.name}" targeting ${targetProviders.join(", ")}.`, {
    campaignId: campaign.id,
    name: campaign.name,
    objective: campaign.objective,
    targetProviders: campaign.target_providers,
    status: campaign.status,
  });
};

// ─── growth_generate_content ────────────────────────────────────

export const toolGrowthGenerateContent: ToolHandler = async (userId, args) => {
  const campaignId = str(args.campaign_id);
  if (!campaignId) return fail("growth_generate_content requires a campaign_id.");

  const providerRaw = str(args.provider);
  if (!providerRaw) return fail("growth_generate_content requires a provider.");
  if (!isGrowthProviderId(providerRaw)) {
    return fail(`Invalid provider "${providerRaw}". Valid: x, reddit, hackernews, producthunt.`);
  }
  const provider = providerRaw as GrowthProviderId;

  const campaign = await getCampaign(userId, campaignId);
  if (!campaign) return fail(`Campaign ${campaignId} not found.`);

  // Check for duplicate against existing approved content for this campaign+provider
  const existing = await listDrafts(userId, {
    campaignId,
    provider,
    status: "approved",
  });
  const existingTexts = existing.map((e) => e.content);

  let generated;
  try {
    generated = await generateContent(campaign, provider);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await auditGrowthAction({
      userId,
      action: "generate_content",
      campaignId,
      provider,
      success: false,
      error: msg,
    });
    return fail(`Content generation failed: ${msg.slice(0, 200)}`);
  }

  if (isDuplicate(generated.content, existingTexts)) {
    return fail(
      `Generated content for ${provider} is too similar to an already-approved draft. Rewrite or adjust the campaign event_summary.`,
    );
  }

  const row = await createContent(userId, {
    campaign_id: campaignId,
    provider,
    content: generated.content,
    content_type: generated.contentType,
  });

  if (!row) return fail("Failed to save generated content.");

  await auditGrowthAction({
    userId,
    action: "generate_content",
    campaignId,
    contentId: row.id,
    provider,
    success: true,
    metadata: { contentType: generated.contentType, length: generated.content.length },
  });

  return ok(null, `Generated ${provider} content for campaign "${campaign.name}".`, {
    contentId: row.id,
    provider,
    contentType: generated.contentType,
    preview: generated.content.slice(0, 200),
    length: generated.content.length,
    status: row.status,
  });
};

// ─── growth_list_drafts ─────────────────────────────────────────

export const toolGrowthListDrafts: ToolHandler = async (userId, args) => {
  const campaignId = optStr(args.campaign_id);
  const providerRaw = optStr(args.provider);
  const statusRaw = optStr(args.status) as "draft" | "approved" | "rejected" | "published" | "archived" | undefined;

  let provider: GrowthProviderId | undefined;
  if (providerRaw) {
    if (!isGrowthProviderId(providerRaw)) {
      return fail(`Invalid provider "${providerRaw}". Valid: x, reddit, hackernews, producthunt.`);
    }
    provider = providerRaw as GrowthProviderId;
  }

  const drafts = await listDrafts(userId, {
    campaignId,
    provider,
    status: statusRaw,
    limit: 20,
  });

  return ok(null, `Found ${drafts.length} draft(s).`, {
    count: drafts.length,
    drafts: drafts.map((d) => ({
      contentId: d.id,
      campaignId: d.campaign_id,
      provider: d.provider,
      status: d.status,
      version: d.version,
      preview: d.content.slice(0, 150),
      length: d.content.length,
      createdAt: d.created_at,
    })),
  });
};

// ─── growth_rewrite_post ────────────────────────────────────────

export const toolGrowthRewritePost: ToolHandler = async (userId, args) => {
  const contentId = str(args.content_id);
  if (!contentId) return fail("growth_rewrite_post requires a content_id.");
  const instructions = str(args.instructions);
  if (!instructions) return fail("growth_rewrite_post requires instructions.");

  const existing = await getContent(userId, contentId);
  if (!existing) return fail(`Content ${contentId} not found.`);

  // Use the LLM to rewrite based on instructions
  const { complete } = await import("@/lib/llm-completion");
  const result = await complete({
    provider: "openrouter",
    model: "google/gemini-2.5-flash",
    prompt: `Rewrite this ${existing.provider} post based on the instructions. Output ONLY the new post text, no preamble.

ORIGINAL POST:
${existing.content}

INSTRUCTIONS:
${instructions}`,
    maxTokens: 800,
    temperature: 0.7,
  }).catch((err) => {
    throw new Error(err instanceof Error ? err.message : "LLM call failed");
  });

  const newContent = result.text.trim();
  if (!newContent) return fail("Rewrite produced empty content.");

  const row = await rewriteContent(userId, contentId, newContent);
  if (!row) return fail("Failed to save rewritten content.");

  await auditGrowthAction({
    userId,
    action: "rewrite_post",
    contentId: row.id,
    provider: existing.provider,
    success: true,
    metadata: { fromContentId: contentId, version: row.version },
  });

  return ok(null, `Rewrote ${existing.provider} post (version ${row.version}).`, {
    contentId: row.id,
    provider: row.provider,
    version: row.version,
    preview: newContent.slice(0, 200),
    length: newContent.length,
    status: row.status,
  });
};

// ─── growth_approve_post ────────────────────────────────────────

export const toolGrowthApprovePost: ToolHandler = async (userId, args) => {
  const contentId = str(args.content_id);
  if (!contentId) return fail("growth_approve_post requires a content_id.");

  const row = await approveContent(userId, contentId);
  if (!row) {
    const existing = await getContent(userId, contentId);
    if (!existing) return fail(`Content ${contentId} not found.`);
    return fail(`Cannot approve content in status "${existing.status}". Only draft or rejected content can be approved.`);
  }

  await auditGrowthAction({
    userId,
    action: "approve_post",
    contentId: row.id,
    provider: row.provider,
    success: true,
  });

  return ok(null, `Approved ${row.provider} post.`, {
    contentId: row.id,
    provider: row.provider,
    status: row.status,
    approvedAt: row.approved_at,
  });
};

// ─── growth_mark_published ──────────────────────────────────────

export const toolGrowthMarkPublished: ToolHandler = async (userId, args) => {
  const contentId = str(args.content_id);
  if (!contentId) return fail("growth_mark_published requires a content_id.");
  const externalUrl = str(args.external_url);
  if (!externalUrl) return fail("growth_mark_published requires an external_url (the URL of the post you published).");

  // Validate URL
  try {
    const parsed = new URL(externalUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return fail("external_url must use http or https.");
    }
  } catch {
    return fail("external_url is not a valid URL.");
  }

  const content = await getContent(userId, contentId);
  if (!content) return fail(`Content ${contentId} not found.`);
  if (content.status !== "approved") {
    return fail(`Cannot publish content in status "${content.status}". Approve it first with growth_approve_post.`);
  }

  const campaign = content.campaign_id ? await getCampaign(userId, content.campaign_id) : null;

  // Enforce policy guardrails
  const policy = await enforcePrePublishRules(userId, content.provider);
  if (!policy.allowed) {
    return fail(policy.reason ?? "Policy check failed.", {
      dailyCount: policy.dailyCount,
      minutesSinceLastPost: policy.minutesSinceLastPost,
    });
  }

  // Ensure a manual-mode account exists
  const account = await ensureManualAccount(userId, content.provider);
  if (!account) return fail("Failed to resolve growth account. The database may be unavailable.");

  // Build UTM params
  const utm = campaign
    ? defaultUtmParams(campaign.name, content.provider)
    : { campaign: campaignSlug(content.provider), source: content.provider, medium: "social" };

  // Prepare the post via the provider (generates compose URL — useful even
  // after manual posting, for the audit trail)
  const providerInstance = getProvider(content.provider);
  if (!providerInstance) return fail(`Provider ${content.provider} not found in registry.`);

  let prepared;
  try {
    prepared = await providerInstance.prepare({
      content: content.content,
      contentType: content.content_type,
      mediaUrls: content.media_urls ?? undefined,
      campaignName: campaign?.name,
      utmUrl: buildUtmUrl("https://litlabs.net", utm),
      metadata: (await getRules(userId, content.provider))?.metadata as Record<string, unknown> | undefined,
    });
  } catch (err) {
    return fail(`Provider prepare failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Create the publication record (idempotent)
  const idempotencyKey = newIdempotencyKey();
  const { row: publication, created } = await createPublication(userId, {
    campaign_id: content.campaign_id,
    content_id: content.id,
    provider: content.provider,
    provider_account_id: account.provider_account_id,
    idempotency_key: idempotencyKey,
    mode: "manual",
    utm_campaign: utm.campaign,
    utm_source: utm.source,
    utm_medium: utm.medium,
  });

  if (!publication) return fail("Failed to create publication record.");

  // If this idempotency key already existed (shouldn't, since we just generated it),
  // don't mark published again.
  if (!created) {
    return ok(null, `Publication already recorded.`, {
      publicationId: publication.id,
      status: publication.status,
      externalUrl: publication.external_url,
    });
  }

  // Mark as published with the user-supplied URL
  const externalId = optStr(args.external_id) ?? null;
  const updated = await markPublished(userId, publication.id, externalUrl, externalId);
  if (!updated) return fail("Failed to mark publication as published.");

  await auditGrowthAction({
    userId,
    action: "mark_published",
    campaignId: content.campaign_id,
    contentId: content.id,
    publicationId: publication.id,
    provider: content.provider,
    success: true,
    metadata: {
      externalUrl,
      utmCampaign: utm.campaign,
      composeUrl: prepared.composeUrl,
    },
  });

  return ok(null, `Recorded ${content.provider} publication.`, {
    publicationId: updated.id,
    provider: updated.provider,
    status: updated.status,
    externalUrl: updated.external_url,
    publishedAt: updated.published_at,
    utm: { campaign: utm.campaign, source: utm.source, medium: utm.medium },
    composeUrl: prepared.composeUrl,
    platformLabel: prepared.platformLabel,
  });
};
