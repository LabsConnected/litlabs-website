"use client";

import { ExternalLink } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import type { LinkDTO } from "./types";

/**
 * Bordered external-link preview card. Renders only what the backend's
 * link-preview provided — no fabricated metadata.
 */
export function LinkCard({ link }: { link: LinkDTO }) {
  const { tokens } = useTheme();
  let domain = "";
  try {
    domain = new URL(link.url).hostname.replace(/^www\./, "");
  } catch {
    domain = link.url;
  }

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-xl border min-w-0"
      style={{ backgroundColor: tokens.background, borderColor: tokens.border }}
      onClick={(e) => e.stopPropagation()}
    >
      {link.imageUrl && (
        // Plain <img>: og images live on arbitrary hosts and may be data URLs.
        <img
          src={link.imageUrl}
          alt=""
          className="aspect-[1.91/1] w-full object-cover"
          loading="lazy"
        />
      )}
      <div className="p-3">
        <div className="flex items-start gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <div
              className="text-sm font-semibold break-words line-clamp-2"
              style={{ color: tokens.text }}
            >
              {link.title || domain}
            </div>
            {link.description && (
              <div
                className="mt-1 text-xs break-words line-clamp-2"
                style={{ color: tokens.textMuted }}
              >
                {link.description}
              </div>
            )}
            <div
              className="mt-1.5 flex items-center gap-1 text-xs"
              style={{ color: tokens.textMuted }}
            >
              <span className="truncate">{domain}</span>
              <ExternalLink size={12} className="shrink-0" />
            </div>
          </div>
        </div>
      </div>
    </a>
  );
}
