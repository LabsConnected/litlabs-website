import { promises as fs } from "fs";
import path from "path";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_ROOTS = ["src", "tests", "scripts", "supabase", "terminal-server"];
const ROOT_FILES = new Set([
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "vitest.config.ts",
  "eslint.config.mjs",
  "README.md",
]);
const MAX_FILE_SIZE = 512 * 1024;

function isInside(parent: string, candidate: string) {
  const relativePath = path.relative(parent, candidate);
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requested = req.nextUrl.searchParams.get("path")?.replace(/^\/+/, "");
  if (!requested || requested.includes("\0")) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }

  const root = await fs.realpath(process.cwd());
  const candidate = path.resolve(root, requested);
  if (!isInside(root, candidate)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const normalized = path.relative(root, candidate).replace(/\\/g, "/");
  const allowed =
    ROOT_FILES.has(normalized) ||
    SOURCE_ROOTS.some((sourceRoot) =>
      normalized.startsWith(`${sourceRoot}/`),
    );
  if (!allowed || normalized.startsWith(".env")) {
    return NextResponse.json({ error: "Path is not readable" }, { status: 403 });
  }

  try {
    const realFile = await fs.realpath(candidate);
    if (!isInside(root, realFile)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
    const stat = await fs.stat(realFile);
    if (!stat.isFile() || stat.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File is unavailable or too large" },
        { status: 413 },
      );
    }
    const content = await fs.readFile(realFile, "utf8");
    return NextResponse.json(
      { path: `/${normalized}`, content, size: stat.size },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
