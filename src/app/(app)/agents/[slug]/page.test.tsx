import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

import AgentPage, { generateMetadata, generateStaticParams } from "./page";
import AgentSlugLayout, { generateMetadata as layoutMetadata } from "./layout";
import { knownAgentSlugs } from "@/lib/agent-slug";

const unknown = { params: Promise.resolve({ slug: "not-a-real-agent" }) };
const invalid = { params: Promise.resolve({ slug: "constructor" }) };
const known = { params: Promise.resolve({ slug: "litt" }) };
const legacy = { params: Promise.resolve({ slug: "littcode" }) };

describe("/agents/[slug]", () => {
  it("calls notFound for an unknown slug, including metadata", async () => {
    await expect(AgentPage(unknown)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(generateMetadata(unknown)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(
      AgentSlugLayout({ children: createElement("div", null, "agent"), ...unknown }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(layoutMetadata(unknown)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("calls notFound for an invalid slug", async () => {
    await expect(AgentPage(invalid)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(generateMetadata(invalid)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("redirects a known slug and does not publish a not-found title", async () => {
    await expect(AgentPage(known)).rejects.toThrow(
      "NEXT_REDIRECT:/studio?tool=workflows",
    );
    const meta = await generateMetadata(known);
    expect(meta.title).toBeUndefined();
    expect(JSON.stringify(meta)).not.toMatch(/not found/i);
    expect(meta.robots).toEqual({ index: false, follow: false });

    const layoutResult = await AgentSlugLayout({
      children: createElement("div", null, "known-agent"),
      ...known,
    });
    expect(layoutResult).toBeTruthy();
  });

  it("keeps legacy agent aliases on the same redirect", async () => {
    await expect(AgentPage(legacy)).rejects.toThrow(
      "NEXT_REDIRECT:/studio?tool=workflows",
    );
  });

  it("only prebuilds known slugs", () => {
    expect(generateStaticParams().map((entry) => entry.slug)).toEqual(knownAgentSlugs());
    expect(knownAgentSlugs()).toContain("litt");
    expect(knownAgentSlugs()).not.toContain("not-a-real-agent");
  });
});
