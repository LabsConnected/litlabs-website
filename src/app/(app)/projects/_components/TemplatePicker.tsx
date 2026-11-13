/**
 * TemplatePicker — the Templates category content for /projects
 * (Decision C: the picker is UI-only work over a ready backend).
 *
 * The 5 scaffolding templates are REAL server-side:
 * PROJECT_TEMPLATES in src/lib/projects/project-repository.ts, and
 * POST /api/studio-projects already validates and builds from
 * `templateId` (the create helper createManagedStudioProject forwards
 * it). Until now every create flow hardcoded "blank-static", so no
 * user could reach the other four. This picker is the missing UI:
 * choosing one opens the standard name dialog, and the create runs
 * through the exact same idempotent flow as New project.
 *
 * The catalog below mirrors the server labels/descriptions for
 * display. The server record stays the source of truth — if a
 * template id is ever rejected, the create route's own error
 * surfaces in the dialog, unchanged.
 */

import { ArrowRight, LayoutTemplate } from "lucide-react";
import type { AppShellColors } from "@/components/app-shell/LiTTAppShell";
import type { ProjectTemplateId } from "@/lib/projects/types";

export interface ProjectTemplateCatalogEntry {
  id: ProjectTemplateId;
  label: string;
  description: string;
  framework: string;
}

export const PROJECT_TEMPLATE_CATALOG: ProjectTemplateCatalogEntry[] = [
  {
    id: "blank-static",
    label: "Blank Static Site",
    description: "A single index.html with minimal CSS. No build step.",
    framework: "static",
  },
  {
    id: "empty-static",
    label: "Empty Static Site",
    description: "An empty managed workspace. LiTT creates the application files from your request.",
    framework: "static",
  },
  {
    id: "nextjs",
    label: "Next.js Application",
    description: "Next.js 16 with React 19, Tailwind CSS, TypeScript.",
    framework: "nextjs",
  },
  {
    id: "react-vite",
    label: "React + Vite",
    description: "React 19 with Vite, TypeScript, Tailwind CSS.",
    framework: "vite",
  },
  {
    id: "expo-react-native",
    label: "Expo + React Native (Android-first)",
    description: "Expo SDK 57 + React Native 0.86 + Expo Router. Android priority, iOS later.",
    framework: "expo",
  },
];

interface TemplatePickerProps {
  colors: AppShellColors;
  onUseTemplate: (template: ProjectTemplateCatalogEntry) => void;
}

export default function TemplatePicker({ colors: T, onUseTemplate }: TemplatePickerProps) {
  return (
    <div>
      <p className="max-w-2xl text-sm leading-relaxed" style={{ color: T.textMuted }}>
        Start from a real scaffolding template. Pick one, name your project,
        and LiTT builds it in Studio — the same create flow as a blank project.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PROJECT_TEMPLATE_CATALOG.map((template) => (
          <div
            key={template.id}
            className="flex flex-col gap-3 rounded-2xl border p-4"
            style={{ backgroundColor: `${T.boxBg}b8`, borderColor: `${T.borderColor}45` }}
          >
            <div className="flex items-start justify-between gap-3">
              <span
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl"
                style={{ backgroundColor: `${T.accentColor}14`, color: T.accentColor }}
              >
                <LayoutTemplate size={18} />
              </span>
              <span
                className="rounded-full px-2.5 py-1 text-[9px] font-black uppercase"
                style={{
                  backgroundColor: `${T.accentColor}12`,
                  color: T.accentColor,
                  border: `1px solid ${T.accentColor}30`,
                }}
              >
                {template.framework}
              </span>
            </div>
            <div>
              <div className="text-sm font-black" style={{ color: T.headerColor }}>
                {template.label}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed" style={{ color: T.textMuted }}>
                {template.description}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onUseTemplate(template)}
              aria-label={`Use template ${template.label}`}
              className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black"
              style={{ backgroundColor: T.accentColor, color: T.bgColor }}
            >
              Use template <ArrowRight size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
