import Image from "next/image";
import Link from "next/link";
import {
  BRAND_MARK_SIZE,
  BRAND_MARK_SRC,
  BRAND_WORDMARK_SIZE,
  BRAND_WORDMARK_SRC,
  brandDisplayWidth,
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
   * Fill the link's width and keep the artwork's aspect ratio.
   * The link must have an explicit width (the marketing header does).
   * The image stays in normal flow — never position it absolutely.
   */
  fluid?: boolean;
};

const SHADOW = "drop-shadow(0 1px 1px rgba(0,0,0,0.35))";

function LogoImage({
  src,
  intrinsic,
  size,
  priority,
  fluid,
}: {
  src: string;
  intrinsic: { width: number; height: number };
  size: number;
  priority: boolean;
  fluid: boolean;
}) {
  const displayW = brandDisplayWidth(intrinsic, size);
  return (
    <Image
      src={src}
      alt="LiTTree LabStudios Logo"
      width={intrinsic.width}
      height={intrinsic.height}
      priority={priority}
      sizes={fluid ? "(min-width: 1024px) 176px, (min-width: 640px) 152px, 108px" : `${displayW}px`}
      className={fluid ? "block h-auto w-full" : "block h-auto max-w-none"}
      style={
        fluid
          ? { filter: SHADOW }
          : { height: size, width: displayW, maxWidth: "none", filter: SHADOW }
      }
    />
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
  const image =
    variant === "full" ? (
      <LogoImage
        src={BRAND_WORDMARK_SRC}
        intrinsic={BRAND_WORDMARK_SIZE}
        size={size}
        priority={priority}
        fluid={fluid}
      />
    ) : (
      <LogoImage
        src={BRAND_MARK_SRC}
        intrinsic={BRAND_MARK_SIZE}
        size={size}
        priority={priority}
        fluid={fluid}
      />
    );

  return (
    <Link
      href={href}
      aria-label="LiTTree LabStudios home"
      className={`inline-flex shrink-0 items-center gap-2.5 ${className}`}
    >
      {fluid ? <span className="block w-full min-w-0">{image}</span> : image}

      {showText && (
        <span className="min-w-0 truncate text-sm font-black tracking-[-0.02em] text-white">
          <span>LiTTree</span>
          <span className="ml-1 text-zinc-300">LabStudios</span>
        </span>
      )}
    </Link>
  );
}
