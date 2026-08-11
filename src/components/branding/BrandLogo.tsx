import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
  showText?: boolean;
  href?: string;
  size?: number;
  className?: string;
};

export function BrandLogo({
  showText = true,
  href = "/",
  size = 30,
  className = "",
}: BrandLogoProps) {
  return (
    <Link
      href={href}
      aria-label="LiTTree LabStudios home"
      className={`inline-flex min-w-0 items-center gap-2 ${className}`}
    >
      <Image
        src="/branding/littree-labstudios-litlabs-net.png"
        alt=""
        width={size}
        height={size}
        priority
        sizes={`${size}px`}
        className="shrink-0 rounded-md object-contain drop-shadow-[0_0_7px_rgba(139,92,246,0.42)]"
      />

      {showText && (
        <span className="truncate text-sm font-semibold tracking-[-0.02em] text-white">
          <span>LiTTree</span>
          <span className="ml-1 text-zinc-300">Lab Studios</span>
        </span>
      )}
    </Link>
  );
}
