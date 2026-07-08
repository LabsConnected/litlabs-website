// LiTT CODE Codebase Scanner
// Reads key project files and returns a structured summary

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { promises as fs } from "fs";
import path from "path";

interface FileSummary {
  path: string;
  type: string;
  size: number;
  lineCount?: number;
  description?: string;
}

interface ScanResult {
  projectName: string;
  totalFiles: number;
  totalLines: number;
  techStack: string[];
  keyFeatures: string[];
  routes: string[];
  apiEndpoints: string[];
  agents: string[];
  recentChanges: string[];
  health: {
    envVarsConfigured: number;
    envVarsMissing: string[];
    buildStatus: string;
  };
}

async function readFileSafe(
  filePath: string,
  maxLines = 50,
): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.split("\n").slice(0, maxLines).join("\n");
  } catch {
    return null;
  }
}

async function countLines(filePath: string): Promise<number> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

async function scanDirectory(
  dir: string,
  pattern: string,
  maxDepth = 3,
): Promise<FileSummary[]> {
  const results: FileSummary[] = [];
  const stack: { dir: string; depth: number }[] = [{ dir, depth: 0 }];

  while (stack.length > 0) {
    const { dir: currentDir, depth } = stack.pop()!;
    if (depth > maxDepth) continue;

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (
            !entry.name.startsWith(".") &&
            entry.name !== "node_modules" &&
            entry.name !== ".next" &&
            entry.name !== "out"
          ) {
            stack.push({ dir: fullPath, depth: depth + 1 });
          }
        } else if (entry.name.match(pattern)) {
          const stat = await fs.stat(fullPath);
          const lines = await countLines(fullPath);
          results.push({
            path: fullPath.replace(process.cwd(), "").replace(/\\/g, "/"),
            type: path.extname(entry.name),
            size: stat.size,
            lineCount: lines,
          });
        }
      }
    } catch {
      // ignore unreadable dirs
    }
  }

  return results;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cwd = process.cwd();

  // Scan key directories
  const [pageFiles, apiFiles, componentFiles, libFiles, toolFiles] =
    await Promise.all([
      scanDirectory(path.join(cwd, "src/app"), "\\.tsx$", 3),
      scanDirectory(path.join(cwd, "src/app/api"), "\\.ts$", 3),
      scanDirectory(path.join(cwd, "src/components"), "\\.tsx$", 2),
      scanDirectory(path.join(cwd, "src/lib"), "\\.ts$", 1),
      scanDirectory(path.join(cwd, "src/app/studio/tools"), "\\.tsx$", 1),
    ]);

  const allFiles = [
    ...pageFiles,
    ...apiFiles,
    ...componentFiles,
    ...libFiles,
    ...toolFiles,
  ];
  const totalLines = allFiles.reduce((sum, f) => sum + (f.lineCount || 0), 0);

  // Extract routes from page files
  const routes = pageFiles
    .map((f) => {
      const relative = f.path
        .replace("/src/app/", "")
        .replace("/page.tsx", "")
        .replace("/page.tsx", "");
      if (relative === "page.tsx" || relative === "") return "/";
      return (
        "/" + relative.replace(/\(.*?\)\//g, "").replace(/\[.*?\]/g, ":param")
      );
    })
    .filter((r, i, arr) => arr.indexOf(r) === i)
    .sort();

  // Extract API endpoints
  const apiEndpoints = apiFiles
    .map((f) =>
      f.path
        .replace("/src/app/api/", "/api/")
        .replace("/route.ts", "")
        .replace("/route.ts", ""),
    )
    .filter((r, i, arr) => arr.indexOf(r) === i)
    .sort();

  // Read agents
  let agents: string[] = [];
  try {
    const agentsFile = await readFileSafe(
      path.join(cwd, "src/lib/agents.ts"),
      200,
    );
    if (agentsFile) {
      const agentMatches = agentsFile.matchAll(
        /id:\s*"([^"]+)".+?name:\s*"([^"]+)"/g,
      );
      agents = Array.from(new Set(Array.from(agentMatches).map((m) => m[2])));
    }
  } catch {
    /* ignore */
  }

  // Check env vars
  const envContent = await readFileSafe(path.join(cwd, ".env.local"), 100);
  const envVarsMissing: string[] = [];
  let envVarsConfigured = 0;
  if (envContent) {
    const required = [
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "CLERK_SECRET_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ];
    for (const key of required) {
      const match = envContent.match(new RegExp(`${key}=([^\n]+)`));
      if (!match || match[1].includes("REPLACE") || match[1].trim() === "") {
        envVarsMissing.push(key);
      } else {
        envVarsConfigured++;
      }
    }
  }

  // Recent git changes
  // Serverless-safe: Vercel deployments don't include a git binary or .git
  // directory, so we return a static fallback. For local admin visibility,
  // a service-role endpoint can shell to git if needed.
  const recentChanges = [
    "feat: unified command dock with tools menu + LiTTree OS branding",
    "feat: full LiTTree OS nav + connectors panel",
    "feat: agent feels alive — thoughts, files, motion",
    "feat: wider studio layout + live activity panel + better nav",
    "fix: CSP warnings and font preload warnings",
  ];

  // Detect tech stack from package.json
  const techStack: string[] = [
    "Next.js",
    "React",
    "TypeScript",
    "Tailwind CSS",
  ];
  try {
    const pkg = await readFileSafe(path.join(cwd, "package.json"), 50);
    if (pkg) {
      if (pkg.includes("clerk")) techStack.push("Clerk");
      if (pkg.includes("supabase")) techStack.push("Supabase");
      if (pkg.includes("stripe")) techStack.push("Stripe");
      if (pkg.includes("gemini")) techStack.push("Gemini AI");
    }
  } catch {
    /* ignore */
  }

  // Build status
  const buildStatus =
    envVarsMissing.length === 0
      ? "Ready to deploy"
      : `${envVarsMissing.length} env vars missing`;

  const result: ScanResult = {
    projectName: "LiTTree Lab Studios",
    totalFiles: allFiles.length,
    totalLines,
    techStack: Array.from(new Set(techStack)),
    keyFeatures: [
      `${pageFiles.length} pages`,
      `${apiFiles.length} API routes`,
      `${componentFiles.length} components`,
      `${toolFiles.length} studio tools`,
      `${agents.length} AI agents`,
    ],
    routes: routes.slice(0, 20),
    apiEndpoints: apiEndpoints.slice(0, 20),
    agents: agents.slice(0, 10),
    recentChanges,
    health: {
      envVarsConfigured,
      envVarsMissing,
      buildStatus,
    },
  };

  return NextResponse.json(result);
}
