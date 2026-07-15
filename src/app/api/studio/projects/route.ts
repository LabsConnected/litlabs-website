import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { StudioProject } from "@/lib/studio-projects";

export async function GET(_req: NextRequest) {
  void _req;
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ projects: [], synced: false });

    const { data, error } = await supabase
      .from("studio_projects")
      .select("id, name, files, active_file, created_at, updated_at")
      .eq("clerk_id", userId)
      .order("updated_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const projects: StudioProject[] = (data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      files: r.files ?? [],
      activeFile: r.active_file ?? "",
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: new Date(r.updated_at).getTime(),
    }));

    return NextResponse.json({ projects, synced: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    const project: StudioProject = body.project;
    if (!project?.id || !project?.name) {
      return NextResponse.json({ error: "invalid project" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ synced: false, reason: "supabase-not-configured" });

    const upsert = {
      id: project.id,
      clerk_id: userId,
      name: project.name,
      files: project.files,
      active_file: project.activeFile,
      updated_at: new Date(project.updatedAt).toISOString(),
    };

    const { error } = await supabase.from("studio_projects").upsert(upsert, { onConflict: "id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ synced: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ deleted: false });

    const { error } = await supabase
      .from("studio_projects")
      .delete()
      .eq("id", id)
      .eq("clerk_id", userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
