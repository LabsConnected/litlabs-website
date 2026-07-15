"use client";

import nextDynamic from "next/dynamic";
import {
  Code,
  Image as ImageIcon,
  Video,
  Music,
  Workflow,
  GitBranch,
  FolderOpen,
  TerminalSquare,
  Bot,
  SquareTerminal,
  Palette,
  Boxes,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import type { StudioToolId } from "./studio-context";

const Lazy = <T extends ComponentType>(loader: () => Promise<{ default: T }>) =>
  nextDynamic(loader, { ssr: false });

export type ToolDef = {
  id: StudioToolId;
  label: string;
  desc: string;
  icon: LucideIcon;
  group: "Code" | "Create" | "Automate" | "Data" | "Extras";
  component: ComponentType;
};

export const TOOLS: ToolDef[] = [
  {
    id: "code",
    label: "Code",
    desc: "Editor + live preview",
    icon: Code,
    group: "Code",
    component: Lazy(() => import("./tools/CodeTool")),
  },
  {
    id: "canvas",
    label: "Canvas",
    desc: "AI code builder",
    icon: Sparkles,
    group: "Code",
    component: Lazy(() => import("./tools/CanvasTool")),
  },
  {
    id: "image",
    label: "Image",
    desc: "Image generation",
    icon: ImageIcon,
    group: "Create",
    component: Lazy(() => import("./tools/ImageTool")),
  },
  {
    id: "video",
    label: "Video",
    desc: "Video generation",
    icon: Video,
    group: "Create",
    component: Lazy(() => import("./tools/VideoTool")),
  },
  {
    id: "audio",
    label: "Audio",
    desc: "Music & sound",
    icon: Music,
    group: "Create",
    component: Lazy(() => import("./tools/AudioTool")),
  },
  {
    id: "flow",
    label: "Flow",
    desc: "Prompt chaining",
    icon: Workflow,
    group: "Automate",
    component: Lazy(() => import("./tools/FlowTool")),
  },
  {
    id: "pipeline",
    label: "Pipeline",
    desc: "Workflow orchestrator",
    icon: GitBranch,
    group: "Automate",
    component: Lazy(() => import("./tools/PipelineTool")),
  },
  {
    id: "gallery",
    label: "Gallery",
    desc: "All your assets",
    icon: FolderOpen,
    group: "Data",
    component: Lazy(() => import("./tools/GalleryTool")),
  },
  {
    id: "cli",
    label: "CLI Bridge",
    desc: "Run shell commands",
    icon: TerminalSquare,
    group: "Data",
    component: Lazy(() => import("./tools/CLIBridgeTool")),
  },
  {
    id: "agents",
    label: "Agents",
    desc: "Chat with your crew",
    icon: Bot,
    group: "Extras",
    component: Lazy(() => import("./tools/AgentTool")),
  },
  {
    id: "agents-terminal",
    label: "Agent Terminal",
    desc: "Multi-agent console",
    icon: SquareTerminal,
    group: "Extras",
    component: Lazy(() => import("./tools/AgentsTerminalTool")),
  },
  {
    id: "color",
    label: "Color by Number",
    desc: "Palette painter",
    icon: Palette,
    group: "Extras",
    component: Lazy(() => import("./tools/ColorByNumberTool")),
  },
  {
    id: "space",
    label: "Space",
    desc: "Spatial generator",
    icon: Boxes,
    group: "Extras",
    component: Lazy(() => import("./tools/SpaceTool")),
  },
];

export const TOOL_MAP: Record<StudioToolId, ToolDef> = TOOLS.reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Record<StudioToolId, ToolDef>,
);

export const GROUPS: ToolDef["group"][] = ["Code", "Create", "Automate", "Data", "Extras"];