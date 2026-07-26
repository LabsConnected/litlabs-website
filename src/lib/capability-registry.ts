export type CapabilityAssistant = "litt" | "spark" | "both";

export type CapabilityStatus = "available" | "unavailable" | "misconfigured";

export type CapabilityExecutor = (input: Record<string, unknown>) => Promise<{ success: boolean; output?: string; error?: string }>;

export interface CapabilityDefinition {
  key: string;
  assistant: CapabilityAssistant;
  status: CapabilityStatus;
  requiredConnections: string[];
  requiredPermissions: string[];
  execute?: CapabilityExecutor;
}

export const CAPABILITY_REGISTRY: Record<string, CapabilityDefinition> = {
  "github.code_review": {
    key: "github.code_review",
    assistant: "litt",
    status: "available",
    requiredConnections: ["github"],
    requiredPermissions: ["repo:read"],
  },
  "github.repository_search": {
    key: "github.repository_search",
    assistant: "litt",
    status: "available",
    requiredConnections: ["github"],
    requiredPermissions: ["repo:read"],
  },
  "workflow.build_test": {
    key: "workflow.build_test",
    assistant: "litt",
    status: "available",
    requiredConnections: ["terminal"],
    requiredPermissions: ["terminal:execute"],
  },
  "workflow.landing_page": {
    key: "workflow.landing_page",
    assistant: "litt",
    status: "available",
    requiredConnections: [],
    requiredPermissions: [],
  },
  "content.social_plan": {
    key: "content.social_plan",
    assistant: "spark",
    status: "available",
    requiredConnections: [],
    requiredPermissions: [],
  },
  "creative.brand_kit": {
    key: "creative.brand_kit",
    assistant: "spark",
    status: "available",
    requiredConnections: [],
    requiredPermissions: [],
  },
  "content.copy_edit": {
    key: "content.copy_edit",
    assistant: "spark",
    status: "available",
    requiredConnections: [],
    requiredPermissions: [],
  },
  "vercel.deploy": {
    key: "vercel.deploy",
    assistant: "litt",
    status: "unavailable",
    requiredConnections: ["vercel"],
    requiredPermissions: ["deploy:write"],
  },
  "supabase.schema_assist": {
    key: "supabase.schema_assist",
    assistant: "litt",
    status: "unavailable",
    requiredConnections: ["supabase"],
    requiredPermissions: ["db:write"],
  },
};

export function getCapability(key: string): CapabilityDefinition | undefined {
  return CAPABILITY_REGISTRY[key];
}

export function isCapabilityAvailable(key: string, connectedServices: string[]): CapabilityStatus {
  const cap = CAPABILITY_REGISTRY[key];
  if (!cap) return "unavailable";
  if (cap.status === "unavailable") return "unavailable";
  const missing = cap.requiredConnections.filter((c) => !connectedServices.includes(c));
  if (missing.length > 0) return "misconfigured";
  return "available";
}

export function getInstalledCapabilities(installedKeys: string[], connectedServices: string[]): string[] {
  return installedKeys.filter((key) => {
    const cap = CAPABILITY_REGISTRY[key];
    if (!cap) return false;
    const status = isCapabilityAvailable(key, connectedServices);
    return status === "available";
  });
}
