"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Images, RefreshCw } from "lucide-react";
import { MarketingFrame } from "@/components/ProductPageFrame";
import "@/app/public-pages-tlc.css";

type GalleryItem = {
  id: string;
  title: string;
  artist: string;
  category: string;
  imageUrl: string;
  likes: number;
  mediaType?: string;
  videoUrl?: string;
};

type GalleryResponse = {
  items?: GalleryItem[];
  error?: string;
};

type GalleryState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: GalleryItem[] };

export default function GalleryClient() {
  const [state, setState] = useState<GalleryState>({ status: "loading" });

  const loadGallery = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/gallery?view=community", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Gallery request failed with ${response.status}`);
      const data = (await response.json()) as GalleryResponse;
      if (data.error) throw new Error(data.error);
      setState({ status: "ready", items: Array.isArray(data.items) ? data.items : [] });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void loadGallery();
  }, [loadGallery]);

  return (
    <div className="litt-public-light min-h-screen bg-white pt-[68px] text-[#0e1510] selection:bg-[#8fd14f]/60">
      <section className="px-5 pb-12 pt-16 lg:px-10">
        <MarketingFrame>
          <div className="max-w-3xl">
            <div className="litt-eyebrow">Gallery</div>
            <h1 className="mt-5 text-4xl font-black leading-[0.95] tracking-[-0.045em] sm:text-5xl lg:text-6xl">
              Public creations from <span className="litt-gradient-text">LiTT users.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-[#37463a] sm:text-lg sm:leading-8">
              This gallery shows media that users have explicitly made public.
              For guided product walkthroughs, use the Showcase instead.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/showcase"
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-black text-on-accent transition hover:bg-accent-strong"
              >
                Browse demos <ArrowRight size={15} />
              </Link>
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 rounded-xl border border-[#0c5a26]/25 px-5 py-3 text-sm font-bold text-[#0c5a26] transition hover:bg-[#f2f7ea]"
              >
                Start creating
              </Link>
            </div>
          </div>
        </MarketingFrame>
      </section>

      <section className="px-5 py-14 lg:px-10">
        <MarketingFrame>
          {state.status === "loading" ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading gallery">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="overflow-hidden rounded-2xl border border-[#cfdec4] bg-white">
                  <div className="aspect-[4/3] animate-pulse bg-[#edf3e4]" />
                  <div className="space-y-2 p-5">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-[#edf3e4]" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-[#edf3e4]" />
                  </div>
                </div>
              ))}
            </div>
          ) : state.status === "error" ? (
            <div className="rounded-2xl border border-[#cfdec4] bg-[#f2f7ea] p-8 text-center">
              <Images className="mx-auto text-[#0c5a26]" size={28} />
              <h2 className="mt-4 text-xl font-black">Gallery is temporarily unavailable</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#0e1510]/60">
                The public gallery could not be loaded right now. You can still browse the guided Showcase demos.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => void loadGallery()}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#0c5a26]/25 px-4 py-2.5 text-sm font-bold text-[#0c5a26] transition hover:bg-white"
                >
                  <RefreshCw size={14} /> Try again
                </button>
                <Link
                  href="/showcase"
                  className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-black text-on-accent transition hover:bg-accent-strong"
                >
                  Open Showcase <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          ) : state.items.length === 0 ? (
            <div className="rounded-2xl border border-[#cfdec4] bg-[#f2f7ea] p-8 text-center">
              <Images className="mx-auto text-[#0c5a26]" size={28} />
              <h2 className="mt-4 text-xl font-black">No public creations yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#0e1510]/60">
                When users share work publicly it will appear here. In the meantime, the Showcase has guided product demos.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link
                  href="/showcase"
                  className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-black text-on-accent transition hover:bg-accent-strong"
                >
                  Browse demos <ArrowRight size={14} />
                </Link>
                <Link
                  href="/sign-up"
                  className="inline-flex items-center gap-2 rounded-xl border border-[#0c5a26]/25 px-4 py-2.5 text-sm font-bold text-[#0c5a26] transition hover:bg-white"
                >
                  Start creating
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {state.items.map((item) => (
                <article
                  key={item.id}
                  className="overflow-hidden rounded-2xl border border-[#cfdec4] bg-white shadow-[0_20px_54px_rgba(14,60,26,0.08)]"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-[#edf3e4]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- gallery URLs are user-supplied and not all are in next/image remotePatterns */}
                    <img
                      src={item.imageUrl}
                      alt={item.title}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    {item.mediaType === "video" ? (
                      <span className="absolute left-3 top-3 rounded-full bg-[#0b120d]/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white">
                        Video
                      </span>
                    ) : null}
                  </div>
                  <div className="p-5">
                    <h2 className="truncate text-base font-black text-[#0e1510]">{item.title}</h2>
                    <p className="mt-1 truncate text-sm text-[#0e1510]/55">
                      {item.artist} · {item.category}
                    </p>
                    <p className="mt-3 text-xs font-bold uppercase tracking-[0.14em] text-[#63745f]">
                      {item.likes} likes
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </MarketingFrame>
      </section>
    </div>
  );
}
