"use client";

import { useTheme } from "@/context/ThemeContext";

const FACEBOOK_PAGE_URL = process.env.NEXT_PUBLIC_FACEBOOK_PAGE_URL || "";

export function FacebookFeed() {
  const { resolvedColors: T } = useTheme();

  if (!FACEBOOK_PAGE_URL) {
    return null;
  }

  const encoded = encodeURIComponent(FACEBOOK_PAGE_URL);
  const src = `https://www.facebook.com/plugins/page.php?href=${encoded}&tabs=timeline&small_header=true&adapt_container_width=true&hide_cover=false&show_facepile=false&height=500`;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: `${T.boxBg}60`,
        border: `1px solid ${T.borderColor}20`,
      }}
    >
      <div
        className="p-3 border-b flex items-center gap-2"
        style={{ borderColor: `${T.borderColor}20` }}
      >
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            backgroundColor: "#1877f215",
            border: "1px solid #1877f230",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#1877f2">
            <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.897c0-3.017 1.792-4.681 4.533-4.681 1.313 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.875v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
          </svg>
        </div>
        <div className="text-xs font-bold" style={{ color: T.textColor }}>
          Facebook Feed
        </div>
      </div>
      <iframe
        src={src}
        width="100%"
        height="500"
        style={{ border: "none", overflow: "hidden" }}
        scrolling="no"
        frameBorder={0}
        allowFullScreen
        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
        title="Facebook Feed"
      />
    </div>
  );
}
