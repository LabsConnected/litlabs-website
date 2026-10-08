import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
  showText?: boolean;
  href?: string;
  size?: number;
  className?: string;
  variant?: "mark" | "full";
};

export function BrandLogo({
  showText = true,
  href = "/",
  size = 30,
  className = "",
  variant = "mark",
}: BrandLogoProps) {
  // Single LiTT mark everywhere: the old banner and crystal-mark
  // assets are retired. Both variants resolve to the same icon for one
  // consistent identity; `variant` is kept so call sites don't churn.
  const iconSrc = "/icon-192.png";

  return (
    <Link
      href={href}
      aria-label="LiTT home"
      className={`inline-flex min-w-0 items-center gap-2.5 ${className}`}
    >
      <Image
        src={iconSrc}
        alt="LiTT logo"
        width={size}
        height={size}
        priority
        sizes={`${size}px`}
        className="shrink-0 rounded-lg object-contain drop-shadow-[0_0_10px_rgba(139,92,246,0.55)]"
      />

      {showText && (
        <span className="truncate text-sm font-black tracking-[-0.02em] text-white">
          <span>LiTT</span>
        </span>
      )}
    </Link>
  );
}
