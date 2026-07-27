import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getProject } from "@/lib/projects/project-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!project.workspaceRoot) return NextResponse.json({ error: "Workspace root missing" }, { status: 404 });

  const previewFile = join(project.workspaceRoot, "index.html");
  if (!existsSync(previewFile)) {
    return NextResponse.json({ error: "Preview file not found" }, { status: 404 });
  }

  const html = readFileSync(previewFile, "utf8");
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
