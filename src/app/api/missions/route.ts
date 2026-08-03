import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listMissions, createMission } from "@/lib/missions/mission-repository";
import { getProject } from "@/lib/projects/project-repository";

/**
 * GET /api/missions?projectId=xxx
 * List missions for a project.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

  const missions = await listMissions(projectId, userId);
  return NextResponse.json({ missions });
}

/**
 * POST /api/missions
 * Create a new mission.
 * Body: { projectId, name, description?, graph? }
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { projectId?: string; name?: string; description?: string; graph?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.projectId || !body.name) {
    return NextResponse.json({ error: "Missing projectId or name" }, { status: 400 });
  }

  // Verify project ownership
  const project = await getProject(body.projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const mission = await createMission({
    projectId: body.projectId,
    userId,
    name: body.name,
    description: body.description,
    graph: body.graph,
  });

  return NextResponse.json({ mission }, { status: 201 });
}
