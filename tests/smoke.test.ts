import { describe, it, expect } from "vitest";

describe("repository smoke checks", () => {
  it("deep scan critical schema and auth items are addressed", async () => {
    const fs = await import("fs");
    const path = await import("path");

    const root = process.cwd();
    const settings = fs.readFileSync(path.join(root, "src/app/settings/page.tsx"), "utf8");
    const conversations = fs.readFileSync(path.join(root, "src/app/api/conversations/route.ts"), "utf8");
    const userAgents = fs.readFileSync(path.join(root, "src/app/api/user-agents/route.ts"), "utf8");
    const marketplace = fs.readFileSync(path.join(root, "src/app/marketplace/page.tsx"), "utf8");
    const tsconfig = fs.readFileSync(path.join(root, "tsconfig.json"), "utf8");
    const schema = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
    const preferencesRoute = fs.readFileSync(path.join(root, "src/app/api/settings/preferences/route.ts"), "utf8");
    const agentsPage = fs.readFileSync(path.join(root, "src/app/agents/page.tsx"), "utf8");
    const showcasePage = fs.readFileSync(path.join(root, "src/app/showcase/page.tsx"), "utf8");

    expect(settings).toContain("/api/settings/preferences");
    expect(settings).toContain('notify_discord: discordWebhook');
    expect(settings).toContain("workspace_autosave: autoSaveDrafts");

    expect(conversations).toContain(".from(\"users\")");
    expect(conversations).toContain('.eq(\"clerk_id\", clerkId)');
    expect(conversations).toContain("user_id\", dbUserId");

    expect(userAgents).toContain(".from(\"users\")");
    expect(userAgents).toContain('.eq(\"clerk_id\", clerkId)');
    expect(userAgents).toContain("user_id\", dbUserId");

    expect(marketplace).toContain("price_1TogVaJ53kgx4fp5pclmzUZv");
    expect(marketplace).toContain("price_1TogZdJ53kgx4fp56g6bewkx");
    expect(marketplace).toContain("price_1TogWpJ53kgx4fp5D5qi1ld8");

    expect(tsconfig).toContain('"strict": true');
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS public.rate_limit_store");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS public.orchestration_jobs");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS public.active_tasks");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS public.agents");
    expect(schema).toContain("is_core");
    expect(schema).toContain("is_public");
    expect(schema).toContain("owner_id");
    expect(schema).toContain('notify_discord text');
    expect(schema).toContain("workspace_autosave boolean default true");

    expect(preferencesRoute).toContain("updates");
    expect(preferencesRoute).toContain("workspace_autosave");

    expect(agentsPage).toContain("redirect(\"/sign-in");
    // Showcase is a "use client" component, so its auth guard uses the
    // client-side router.push to the sign-in page rather than the
    // server-only redirect() helper.
    expect(showcasePage).toContain("/sign-in?redirect_url=/showcase");
  });
});
