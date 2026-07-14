import { execFileSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FileSummary {
  path: string;
  type: string;
  size: number;
  lineCount: number;
}

const REQUIRED_ENV_VARS = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

async function readFileSafe(filePath: string, maxLines = 250) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content.split(/\r?\n/).slice(0, maxLines).join("\n");
  } catch {
    return null;
  }
}

async function summarizeFile(root: string, filePath: string): Promise<FileSummary> {
  const [content, stat] = await Promise.all([
    fs.readFile(filePath, "utf8"),
    fs.stat(filePath),
  ]);
  return {
    path: `/${path.relative(root, filePath).replace(/\\/g, "/")}`,
    type: path.extname(filePath),
    size: stat.size,
    lineCount: content.split(/\r?\n/).length,
  };
}

async function scanDirectory(
  root: string,
  dir: string,
  fileNamePattern: RegExp,
  maxDepth: number,
): Promise<FileSummary[]> {
  const results: FileSummary[] = [];
  const stack = [{ dir, depth: 0 }];

  while (stack.length) {
    const current = stack.pop()!;
    if (current.depth > maxDepth) continue;

    let entries;
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (
          !entry.name.startsWith(".") &&
          !["node_modules", ".next", "out", "coverage"].includes(entry.name)
        ) {
          stack.push({ dir: fullPath, depth: current.depth + 1 });
        }
      } else if (fileNamePattern.test(entry.name)) {
        try {
          results.push(await summarizeFile(root, fullPath));
        } catch {
          // A file may disappear while a development scan is running.
        }
      }
    }
  }

  return results;
}

function uniqueFiles(groups: FileSummary[][]): FileSummary[] {
  const files = new Map<string, FileSummary>();
  for (const file of groups.flat()) files.set(file.path, file);
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function pageRoute(filePath: string): string {
  let route = filePath
    .replace(/^\/src\/app\//, "")
    .replace(/\/page\.tsx$/, "")
    .replace(/^page\.tsx$/, "")
    .replace(/(^|\/)\([^/]+\)(?=\/|$)/g, "")
    .replace(/\[\[\.\.\.([^\]]+)\]\]/g, ":$1*")
    .replace(/\[\.\.\.([^\]]+)\]/g, ":$1*")
    .replace(/\[([^\]]+)\]/g, ":$1")
    .replace(/\/{2,}/g, "/");
  route = `/${route}`.replace(/\/{2,}/g, "/");
  return route === "/" ? route : route.replace(/\/$/, "");
}

function apiRoute(filePath: string): string {
  return filePath
    .replace(/^\/src\/app\/api/, "/api")
    .replace(/\/route\.tsx?$/, "")
    .replace(/\[\.\.\.([^\]]+)\]/g, ":$1*")
    .replace(/\[([^\]]+)\]/g, ":$1");
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const root = process.cwd();
  const [pageFiles, apiFiles, componentFiles, libFiles, toolFiles] =
    await Promise.all([
      scanDirectory(root, path.join(root, "src/app"), /^page\.tsx$/, 10),
      scanDirectory(root, path.join(root, "src/app/api"), /^route\.tsx?$/, 12),
      scanDirectory(root, path.join(root, "src/components"), /\.tsx$/, 8),
      scanDirectory(root, path.join(root, "src/lib"), /\.ts$/, 4),
      scanDirectory(root, path.join(root, "src/app/studio/tools"), /\.tsx$/, 2),
    ]);

  const files = uniqueFiles([
    pageFiles,
    apiFiles,
    componentFiles,
    libFiles,
    toolFiles,
  ]);
  const envVarsMissing = REQUIRED_ENV_VARS.filter(
    (key) => !process.env[key]?.trim(),
  );
  const envVarsConfigured = REQUIRED_ENV_VARS.length - envVarsMissing.length;

  let recentChanges: string[] = [];
  try {
    recentChanges = execFileSync("git", ["log", "--oneline", "-5"], {
      cwd: root,
      encoding: "utf8",
      timeout: 5_000,
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    // Git is optional in packaged deployments.
  }

  const techStack = new Set(["Next.js", "React", "TypeScript", "Tailwind CSS"]);
  const packageJson = await readFileSafe(path.join(root, "package.json"), 500);
  if (packageJson) {
    if (packageJson.includes("@clerk/")) techStack.add("Clerk");
    if (packageJson.includes("@supabase/")) techStack.add("Supabase");
    if (packageJson.includes('"stripe"')) techStack.add("Stripe");
    if (packageJson.includes("@google/genai")) techStack.add("Gemini AI");
  }

  const agentsFile = await readFileSafe(path.join(root, "src/lib/agents.ts"));
  const agents = agentsFile
    ? [...agentsFile.matchAll(/name:\s*["']([^"']+)["']/g)].map(
        (match) => match[1],
      )
    : [];

  return NextResponse.json(
    {
      projectName: "LiTTree-LabStudios",
      totalFiles: files.length,
      totalLines: files.reduce((sum, file) => sum + file.lineCount, 0),
      techStack: [...techStack],
      keyFeatures: [
        `${pageFiles.length} pages`,
        `${apiFiles.length} API routes`,
        `${componentFiles.length} components`,
        `${toolFiles.length} studio tools`,
        `${new Set(agents).size} AI agents`,
      ],
      routes: [...new Set(pageFiles.map((file) => pageRoute(file.path)))].sort(),
      apiEndpoints: [
        ...new Set(apiFiles.map((file) => apiRoute(file.path))),
      ].sort(),
      agents: [...new Set(agents)].slice(0, 25),
      recentChanges,
      health: {
        envVarsConfigured,
        envVarsMissing,
        buildStatus: "Not run — use the Build action for a real result",
        checksEndpoint: "/api/litt/command",
      },
      files,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
