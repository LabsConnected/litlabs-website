"use client";

import { type ReactNode } from "react";

/**
 * ProductPageFrame — the canonical page sizing system for LitLabs.
 *
 * This is the single source of truth for content max-widths across the
 * site. Every product page should wrap its content in this component
 * instead of hardcoding `max-w-*` classes. This stops the "compact page"
 * drift that happens when individual pages pick their own widths.
 *
 * ## Size variants
 *
 * | Variant    | Max-width | Use case                                    |
 * |------------|-----------|---------------------------------------------|
 * | workspace  | 1680px    | Dashboard, data-dense app pages             |
 * | product    | 1500px    | Default for most product pages              |
 * | marketing  | 1400px    | Sales/landing pages with hero sections      |
 * | reading    | 820px     | Legal docs, privacy policy, long-form text  |
 *
 * ## Usage
 *
 * ```tsx
 * <ProductPageFrame variant="product">
 *   <MyPageContent />
 * </ProductPageFrame>
 * ```
 *
 * The frame provides:
 *   - Centered horizontal layout with responsive padding
 *   - Consistent max-width per variant
 *   - No vertical padding (pages control their own spacing)
 */

export type PageFrameVariant = "workspace" | "product" | "marketing" | "reading";

export const VARIANT_MAX_WIDTH: Record<PageFrameVariant, string> = {
  workspace: "max-w-[1680px]",
  product: "max-w-[1500px]",
  marketing: "max-w-[1400px]",
  reading: "max-w-[820px]",
};

interface ProductPageFrameProps {
  variant?: PageFrameVariant;
  className?: string;
  children: ReactNode;
}

export function ProductPageFrame({
  variant = "product",
  className = "",
  children,
}: ProductPageFrameProps) {
  return (
    <div className={`relative mx-auto w-full ${VARIANT_MAX_WIDTH[variant]} px-4 sm:px-6 lg:px-8 ${className}`}>
      {children}
    </div>
  );
}

/**
 * Convenience wrappers for common variants.
 */
export function WorkspaceFrame({ className, children }: Omit<ProductPageFrameProps, "variant">) {
  return <ProductPageFrame variant="workspace" className={className}>{children}</ProductPageFrame>;
}

export function ProductFrame({ className, children }: Omit<ProductPageFrameProps, "variant">) {
  return <ProductPageFrame variant="product" className={className}>{children}</ProductPageFrame>;
}

export function MarketingFrame({ className, children }: Omit<ProductPageFrameProps, "variant">) {
  return <ProductPageFrame variant="marketing" className={className}>{children}</ProductPageFrame>;
}

export function ReadingFrame({ className, children }: Omit<ProductPageFrameProps, "variant">) {
  return <ProductPageFrame variant="reading" className={className}>{children}</ProductPageFrame>;
}
