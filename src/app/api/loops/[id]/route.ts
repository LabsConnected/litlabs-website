/**
 * /api/loops/[id]
 *
 *   GET    — fetch a single loop
 *   DELETE — cancel + remove a loop
 */

import { NextResponse } from "next/server";
import { deleteLoop, getLoop } from "@/lib/project-loops/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const loop = await getLoop(id);
  if (!loop) {
    return NextResponse.json({ error: "Loop not found" }, { status: 404 });
  }
  return NextResponse.json({ loop });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = await deleteLoop(id);
  if (!ok) {
    return NextResponse.json(
      { error: "Failed to delete loop" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
