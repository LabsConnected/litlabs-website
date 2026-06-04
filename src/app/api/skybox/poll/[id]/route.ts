import { NextRequest, NextResponse } from "next/server";

const SKYBOX_API_KEY = process.env.SKYBOX_API_KEY;
const SKYBOX_STATUS_URL = "https://backend.blockadelabs.com/api/v1/imagine/requests";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!SKYBOX_API_KEY) {
      return NextResponse.json(
        { error: "SKYBOX_API_KEY not configured" },
        { status: 500 }
      );
    }

    const res = await fetch(`${SKYBOX_STATUS_URL}/${id}`, {
      headers: { "x-api-key": SKYBOX_API_KEY },
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      return NextResponse.json(
        { error: data.message || data.error || "Skybox API error" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      id: data.id,
      status: data.status,
      title: data.title,
      fileUrl: data.file_url,
      thumbUrl: data.thumb_url,
      obfuscatedId: data.obfuscated_id,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
