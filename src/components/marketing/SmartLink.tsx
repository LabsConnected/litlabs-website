"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";

type SmartLinkProps = {
  /** Destination for signed-in visitors (e.g. "/studio"). */
  href: string;
  /** Destination for signed-out visitors — and while auth is still loading.
   *  Defaults to "/sign-up" so strangers never land on a login wall. */
  signedOutHref?: string;
  className?: string;
  children: ReactNode;
};

/**
 * Auth-aware link for the public marketing surface.
 * Signed-in visitors go straight to `href`; everyone else is routed to
 * `signedOutHref` (sign-up by default) instead of bouncing off a login wall.
 */
export default function SmartLink({
  href,
  signedOutHref = "/sign-up",
  className,
  children,
}: SmartLinkProps) {
  const { isSignedIn, isLoaded } = useClerkAuth();
  const target = isLoaded && isSignedIn ? href : signedOutHref;
  return (
    <Link href={target} className={className}>
      {children}
    </Link>
  );
}
