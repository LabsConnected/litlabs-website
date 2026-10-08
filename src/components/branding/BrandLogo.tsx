import Image from "next/image";
import Link from "next/link";
import {
  BRAND_MARK_FRAME,
  BRAND_MARK_SRC,
  BRAND_WORDMARK_FRAME,
  BRAND_WORDMARK_SRC,
  brandFrameDisplaySize,
  type BrandFrame,
} from "@/components/branding/brand-assets";

type BrandLogoProps = {
  showText?: boolean;
  href?: string;
  size?: number;
  className?: string;
  variant?: "mark" | "full";
  /** Above-the-fold marks preload. Footer and repeated marks should pass false. */
  priority?: boolean;
  /**
   * Size the frame from the link's width (aspect locked to the artwork).
   * Used by the marketing header so one lockup fits a phone and a desktop.
   */
  fluid?: boolean;
};

function FramedMark({
  src,
  frame,
  size,
  priority,
  fluid,
}: {
  src: string;
  frame: BrandFrame;
  size: number;
  priority: boolean;
  fluid: boolean;
}) {
  const box = brandFrameDisplaySize(frame, size);
  const aspect = `${frame.content.width} / ${frame.content.height}`;
  return (
    <span
      className="relative block shrink-0 overflow-hidden"
      style={
        fluid
          ? { width: "100%", aspectRatio: aspect }
          : { width: box.displayW, height: box.displayH }
      }
    >
      <Image
        src={src}
        alt="LiTTree LabStudios Logo"
        width={frame.width}
        height={frame.height}
        priority={priority}
        sizes={fluid ? "(min-width: 640px) 176px, 152px" : `${Math.ceil(box.imgW)}px`}
        className="absolute max-w-none"
        style={{
          width: fluid ? `${(frame.width / frame.content.width) * 100}%` : box.imgW,
          height: fluid ? `${(frame.height / frame.content.height) * 100}%` : box.imgH,
          left: fluid ? `${(-frame.content.x / frame.content.width) * 100}%` : box.offsetX,
          top: fluid ? `${(-frame.content.y / frame.content.height) * 100}%` : box.offsetY,
          maxWidth: "none",
        }}
      />
    </span>
  );
}

export function BrandLogo({
  showText = true,
  href = "/",
  size = 30,
  className = "",
  variant = "mark",
  priority = true,
  fluid = false,
}: BrandLogoProps) {
  const framed =
    variant === "full" ? (
      <FramedMark src={BRAND_WORDMARK_SRC} frame={BRAND_WORDMARK_FRAME} size={size} priority={priority} fluid={fluid} />
    ) : (
      <FramedMark src={BRAND_MARK_SRC} frame={BRAND_MARK_FRAME} size={size} priority={priority} fluid={fluid} />
    );

  return (
    <Link
      href={href}
      aria-label="LiTTree LabStudios home"
      className={`inline-flex shrink-0 items-center gap-2.5 ${className}`}
    >
      <span className="[filter:drop-shadow(0_6px_14px_rgba(0,0,0,0.45))]">
        {framed}
      </span>

      {showText && (
        <span className="min-w-0 truncate text-sm font-black tracking-[-0.02em] text-white">
          <span>LiTTree</span>
          <span className="ml-1 text-zinc-300">LabStudios</span>
        </span>
      )}
    </Link>
  );
}
