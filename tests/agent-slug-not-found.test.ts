/**
 * /agents/[slug] must 404 unknown and invalid slugs. Known slugs keep the
 * existing Studio redirect.
 */
import { describe, expect, it, vi } from "vitest";
import AgentSlugLayout from "@/app/(app)/agents/[slug]/layout";
import AgentPage, {
  generateMetadata,
  generateStaticParams,
} from "@/app/(app)/agents/[slug]/page";
import { AGENT_DEFINITIONS } from "@/lib/agent-registry";
import { BUILT_IN_AGENTS } from "@/lib/studio/agent-registry";
import { isKnownAgentSlug, KNOWN_AGENT_SLUGS } from "@/lib/agent-public-slug";
import { unknownAgentSlugRewrites } from "@/lib/known-agent-slug-list";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const pageProps = (slug: string) => ({
  params: Promise.resolve({ slug }),
});

describe("/agents/[slug]", () => {
  it("calls notFound for an unknown slug", async () => {
    await expect(AgentPage(pageProps("not-a-real-agent-xyz"))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("calls notFound for an invalid slug", async () => {
    await expect(AgentPage(pageProps("Not A Slug"))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    await expect(AgentPage(pageProps(""))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(AgentPage(pageProps("../litt"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("calls notFound from the layout for an unknown slug", async () => {
    await expect(
      AgentSlugLayout({ children: "agent", ...pageProps("not-a-real-agent-xyz") }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders a known slug by redirecting to Studio workflows", async () => {
    expect(isKnownAgentSlug("litt")).toBe(true);
    const view = await AgentSlugLayout({
      children: "known-agent",
      ...pageProps("litt"),
    });
    expect(view).toBe("known-agent");
    await expect(AgentPage(pageProps("litt"))).rejects.toThrow(
      "NEXT_REDIRECT:/studio?tool=workflows",
    );
  });

  it("generateMetadata calls notFound for an unknown slug", async () => {
    await expect(generateMetadata(pageProps("not-a-real-agent-xyz"))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("generateMetadata for a known slug does not claim the agent is missing", async () => {
    const metadata = await generateMetadata(pageProps("litt"));
    expect(JSON.stringify(metadata).toLowerCase()).not.toContain("not found");
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("only prebuilds known slugs so unknown params 404", () => {
    const slugs = generateStaticParams().map((entry) => entry.slug);
    expect(slugs).toEqual([...KNOWN_AGENT_SLUGS]);
    expect(slugs).toContain("litt");
    expect(slugs).not.toContain("not-a-real-agent-xyz");
  });

  it("lists every registry slug so the rewrite cannot drift", () => {
    const fromRegistry = new Set<string>();
    for (const agent of AGENT_DEFINITIONS) {
      fromRegistry.add(agent.slug);
      fromRegistry.add(agent.id);
    }
    for (const slug of Object.keys(BUILT_IN_AGENTS)) fromRegistry.add(slug);
    expect([...KNOWN_AGENT_SLUGS].sort()).toEqual([...fromRegistry].sort());
  });

  it("rewrites unknown slugs to a missing path and leaves known slugs alone", () => {
    const [rewrite] = unknownAgentSlugRewrites();
    expect(rewrite.destination).toBe("/__unknown-agent");
    expect(rewrite.source).toContain("(?!(?:");
    for (const slug of KNOWN_AGENT_SLUGS) {
      expect(rewrite.source).toContain(slug);
    }
    expect(rewrite.source).not.toContain("not-a-real-agent-xyz");
  });
});
