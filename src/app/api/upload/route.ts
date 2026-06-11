// Media Upload API — Supabase Storage with localStorage fallback
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // If Supabase configured, upload to Storage
    if (isAdminSupabaseConfigured()) {
      const sb = getAdminSupabase();
      const path = `${userId}/${Date.now()}_${file.name}`;
      const { data, error } = await sb.storage
        .from("media")
        .upload(path, buffer, { contentType: file.type, upsert: false });
      if (error) throw error;
      const { data: publicUrl } = sb.storage.from("media").getPublicUrl(data.path);
      return NextResponse.json({ url: publicUrl.publicUrl, path: data.path });
    }

    // Fallback: return base64 data URL for local preview
    const base64 = buffer.toString("base64");
    const mime = file.type || "image/png";
    const dataUrl = `data:${mime};base64,${base64}`;
    return NextResponse.json({ url: dataUrl, fallback: true });
  } catch (err) {
    // Upload error:
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
