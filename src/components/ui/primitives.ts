/**
 * Batch 0 shared primitives.
 *
 * Import from "@/components/ui/primitives" for now. These will be folded into
 * "@/components/ui" (index.ts) in a later batch once the open PRs touching
 * the shell have merged — index.ts is intentionally untouched in this batch
 * to keep the diff to pure additions.
 */
export { Button } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";
export { Input } from "./Input";
export type { InputProps } from "./Input";
export { Textarea } from "./Textarea";
export type { TextareaProps } from "./Textarea";
export { Dialog, DialogTitle, DialogDescription, DialogActions } from "./Dialog";
export type { DialogProps, DialogSize } from "./Dialog";
export { Badge } from "./Badge";
export type { BadgeVariant } from "./Badge";
export { Tabs, TabsPanel } from "./Tabs";
export type { TabsProps, TabItem } from "./Tabs";
