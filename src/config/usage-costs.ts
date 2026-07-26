export type UsageCategory =
  | "chat.free"
  | "chat.fast"
  | "chat.premium"
  | "code.generate"
  | "code.long_context"
  | "image.standard"
  | "image.premium"
  | "audio.generate"
  | "video.generate"
  | "terminal.minute"
  | "deployment.operation";

export interface UsageCost {
  category: UsageCategory;
  litbits: number;
  label: string;
  description: string;
}

export const USAGE_COSTS: Record<UsageCategory, UsageCost> = {
  "chat.free": {
    category: "chat.free",
    litbits: 1,
    label: "Chat (free model)",
    description: "Standard chat using free-tier AI routing",
  },
  "chat.fast": {
    category: "chat.fast",
    litbits: 3,
    label: "Chat (fast model)",
    description: "Low-latency model for quick responses",
  },
  "chat.premium": {
    category: "chat.premium",
    litbits: 8,
    label: "Chat (premium model)",
    description: "High-quality model for complex reasoning",
  },
  "code.generate": {
    category: "code.generate",
    litbits: 5,
    label: "Code generation",
    description: "Standard code generation request",
  },
  "code.long_context": {
    category: "code.long_context",
    litbits: 15,
    label: "Long-context code",
    description: "Large codebase context processing",
  },
  "image.standard": {
    category: "image.standard",
    litbits: 10,
    label: "Image (standard)",
    description: "Standard quality image generation",
  },
  "image.premium": {
    category: "image.premium",
    litbits: 25,
    label: "Image (premium)",
    description: "High-resolution or premium model image",
  },
  "audio.generate": {
    category: "audio.generate",
    litbits: 20,
    label: "Audio generation",
    description: "Music or voice audio generation",
  },
  "video.generate": {
    category: "video.generate",
    litbits: 50,
    label: "Video generation",
    description: "Short video clip generation",
  },
  "terminal.minute": {
    category: "terminal.minute",
    litbits: 2,
    label: "Terminal minute",
    description: "Per minute of terminal runtime usage",
  },
  "deployment.operation": {
    category: "deployment.operation",
    litbits: 5,
    label: "Deployment",
    description: "Single deploy or preview operation",
  },
};

export function getCost(category: UsageCategory): UsageCost {
  return USAGE_COSTS[category] ?? USAGE_COSTS["chat.free"];
}
