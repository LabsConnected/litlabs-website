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
};

function FramedMark({
  src,
  frame,
  size,
  priority,
}: {
  src: string;
  frame: BrandFrame;
  size: number;
  priority: boolean;
}) {
  const box = brandFrameDisplaySize(frame, size);
  return (
    <span
      className="relative block shrink-0 overflow-hidden"
      style={{ width: box.displayW, height: box.displayH }}
    >
      <Image
        src={src}
        alt="LiTTree LabStudios Logo"
        width={frame.width}
        height={frame.height}
        priority={priority}
        sizes={`${Math.ceil(box.imgW)}px`}
        className="absolute max-w-none"
        style={{
          width: box.imgW,
          height: box.imgH,
          left: box.offsetX,
          top: box.offsetY,
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
}: BrandLogoProps) {
  const framed =
    variant === "full" ? (
      <FramedMark src={BRAND_WORDMARK_SRC} frame={BRAND_WORDMARK_FRAME} size={size} priority={priority} />
    ) : (
      <FramedMark src={BRAND_MARK_SRC} frame={BRAND_MARK_FRAME} size={size} priority={priority} />
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
