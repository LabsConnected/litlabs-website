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
  const iconSrc =
    variant === "full"
      ? "/branding/littree-labstudios-logo.png"
      : "/branding/littree-crystal-mark.png";

  return (
    <Link
      href={href}
      aria-label="LiTTree LabStudios home"
      className={`inline-flex min-w-0 items-center gap-2.5 ${className}`}
    >
      <Image
        src={iconSrc}
        alt="LiTTree LabStudios Logo"
        width={variant === "full" ? size * 3 : size}
        height={size}
        priority
        sizes={variant === "full" ? `${size * 3}px` : `${size}px`}
        className="shrink-0 rounded-lg object-contain drop-shadow-[0_0_10px_rgba(139,92,246,0.55)]"
      />

      {showText && (
        <span className="truncate text-sm font-black tracking-[-0.02em] text-white">
          <span>LiTTree</span>
          <span className="ml-1 text-zinc-300">LabStudios</span>
        </span>
      )}
    </Link>
  );
}
