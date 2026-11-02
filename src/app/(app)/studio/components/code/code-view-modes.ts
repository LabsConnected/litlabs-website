import { Columns2, Eye, Monitor } from "lucide-react";

export type ViewMode = "code" | "split" | "file-preview" | "app-preview";

/**
 * View-mode toggle for the Code workspace tab toolbar. There is
 * intentionally no "Code" option: the Code workspace tab itself is the code
 * view, and a second Code button here duplicated it in the same toolbar.
 */
export const CODE_VIEW_MODES: { id: ViewMode; icon: typeof Columns2; label: string }[] = [
  { id: "split", icon: Columns2, label: "Split" },
  { id: "file-preview", icon: Eye, label: "File" },
  { id: "app-preview", icon: Monitor, label: "App" },
];
