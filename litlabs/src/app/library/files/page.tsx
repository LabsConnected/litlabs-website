"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import PageShell from "@/components/PageShell";
import { FileText, Download, Upload, Loader2, Image, Video, Music } from "lucide-react";

type MediaFile = {
  id: string;
  url: string;
  type: string;
  caption: string | null;
  created_at: string;
};

export default function LibraryFilesPage() {
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    let alive = true;
    fetch("/api/gallery?view=my-uploads")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => {
        if (alive) {
          const items = Array.isArray(data.items) ? data.items : [];
          setFiles(
            items.map((item: { id: string; imageUrl?: string; videoUrl?: string; mediaType?: string; title?: string; createdAt?: string }) => ({
              id: item.id,
              url: item.videoUrl || item.imageUrl || "",
              type: item.mediaType || "image",
              caption: item.title || null,
              created_at: item.createdAt || new Date().toISOString(),
            })),
          );
        }
      })
      .catch(() => {
        if (alive) setFiles([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isLoaded, isSignedIn]);

  const cardStyle = {
    backgroundColor: `${T.boxBg}60`,
    borderColor: T.borderColor + "30",
  };

  const typeIcon = (type: string) => {
    if (type === "video") return Video;
    if (type === "audio") return Music;
    return Image;
  };

  return (
    <PageShell
      title="Files"
      subtitle="Your uploads and generated media"
      icon={<FileText size={28} />}
    >
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/studio?tool=upload"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}
          >
            <Upload size={16} /> Upload
          </Link>
          <Link
            href="/gallery"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border"
            style={{ borderColor: T.borderColor + "40", color: T.textColor }}
          >
            <Image size={16} /> Gallery
          </Link>
        </div>

        {!isLoaded || loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin" size={28} style={{ color: T.accentColor }} />
          </div>
        ) : !isSignedIn ? (
          <div className="rounded-2xl border p-6 text-center" style={cardStyle}>
            <p className="opacity-70 mb-4">Sign in to view your files.</p>
            <Link href="/sign-in" className="text-sm font-bold" style={{ color: T.accentColor }}>
              Sign in
            </Link>
          </div>
        ) : files.length === 0 ? (
          <div className="rounded-2xl border p-8 text-center" style={cardStyle}>
            <FileText size={32} className="mx-auto mb-3 opacity-40" />
            <p className="opacity-70 mb-2">No files yet.</p>
            <p className="text-sm opacity-50">Generate in Studio or upload to see files here.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {files.map((file) => {
              const Icon = typeIcon(file.type);
              return (
                <div key={file.id} className="rounded-xl border p-4" style={cardStyle}>
                  <Icon size={18} style={{ color: T.accentColor }} className="mb-2" />
                  <p className="text-sm font-bold truncate" style={{ color: T.headerColor }}>
                    {file.caption || file.type}
                  </p>
                  <p className="text-xs opacity-50 mt-1">
                    {new Date(file.created_at).toLocaleDateString()}
                  </p>
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-3 text-xs font-bold"
                    style={{ color: T.accentColor }}
                  >
                    <Download size={12} /> Open
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
