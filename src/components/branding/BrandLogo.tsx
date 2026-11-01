import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
  showText?: boolean;
  href?: string;
  size?: number;
  className?: string;
  variant?: "mark" | "full";
};

/**
 * Shared LiTTree identity: the approved orbit/tree LT direction.
 * "full" always renders a readable wordmark, including legacy callers
 * that previously relied on an image containing embedded text.
 *
 * Small avatar/agent uses can opt into the icon-only "mark" variant.
 */
export function BrandLogo({
  showText = true,
  href = "/",
  size = 30,
  className = "",
  variant = "mark",
}: BrandLogoProps) {
  const displayText = variant === "full" || showText;
  const iconSize = variant === "full" ? Math.max(40, size) : size;

  return (
    <Link
      href={href}
      aria-label="LiTTree LabStudios home"
      className={`inline-flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2.5 ${className}`}
    >
      <Image
        src="/branding/littree-orbit-tree.svg"
        alt=""
        aria-hidden="true"
        width={iconSize}
        height={iconSize}
        priority
        sizes={`${iconSize}px`}
        className="shrink-0 object-contain drop-shadow-[0_0_7px_rgba(139,92,246,0.55)]"
      />
      {displayText && (
        <span className="flex min-w-0 flex-col justify-center leading-none">
          <span className="whitespace-nowrap text-[17px] font-black tracking-[-0.045em] text-white sm:text-[22px]">
            LiT<span className="bg-linear-to-r from-violet-300 via-violet-200 to-cyan-300 bg-clip-text text-transparent">Tree</span>
          </span>
          <span className="mt-0.5 whitespace-nowrap text-[11px] font-semibold tracking-[-0.005em] text-violet-200 sm:text-[13px]">
            LabStudios
          </span>
        </span>
      )}
    </Link>
  );
}
