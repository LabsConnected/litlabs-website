/**
 * Agent Tools Framework
 * Allows Jarvis agents to execute real actions beyond just chatting.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  data?: Record<string, unknown>;
}

export interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
}

// Registry of all available tools
const toolRegistry: Map<string, ToolDefinition> = new Map();

export function registerTool(tool: ToolDefinition): void {
  toolRegistry.set(tool.name, tool);
}

export function getTool(name: string): ToolDefinition | undefined {
  return toolRegistry.get(name);
}

export function listTools(): ToolDefinition[] {
  return Array.from(toolRegistry.values());
}

export async function executeTool(
  name: string,
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = toolRegistry.get(name);
  if (!tool) {
    return { success: false, output: `Unknown tool: ${name}` };
  }
  try {
    return await tool.execute(params);
  } catch (err) {
    return {
      success: false,
      output: `Tool error: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Parse tool calls from agent response text.
 * Format: [TOOL:name {"param":"value"}]
 */
export function parseToolCalls(text: string): ToolCall[] {
  const regex = /\[TOOL:(\w+)\s+({[^}]+})\]/g;
  const calls: ToolCall[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const params = JSON.parse(match[1] === undefined ? "{}" : match[2]);
      calls.push({ tool: match[1], params });
    } catch {
      // Skip malformed tool calls
    }
  }
  return calls;
}

/**
 * Build tool descriptions for injection into agent system prompts.
 */
export function buildToolPrompt(): string {
  const tools = listTools();
  if (tools.length === 0) return "";

  const lines = tools.map((t) => {
    const params = Object.entries(t.parameters)
      .map(([k, v]) => `    ${k}: ${v.type} — ${v.description}${v.required ? " (required)" : ""}`)
      .join("\n");
    return `- ${t.name}: ${t.description}\n${params}`;
  });

  return `\nAvailable tools (use format [TOOL:name {"param":"value"}] to invoke):\n${lines.join("\n\n")}`;
}

// ─── Built-in Tools ────────────────────────────────────────────────────────

registerTool({
  name: "notify",
  description: "Send a notification via Jarvis (Discord, push, email)",
  parameters: {
    title: { type: "string", description: "Notification title", required: true },
    body: { type: "string", description: "Notification body", required: true },
    priority: { type: "string", description: "low | medium | high | critical" },
    channels: { type: "string[]", description: "discord, push, email" },
  },
  execute: async (params) => {
    const { default: jarvis } = await import("@/lib/jarvis");
    const success = await jarvis.notify({
      type: "system_alert",
      priority: (params.priority as "low" | "medium" | "high" | "critical") || "medium",
      title: String(params.title),
      body: String(params.body),
      channels: (params.channels as ("discord" | "push" | "email")[]) || ["discord"],
    });
    return { success, output: success ? "Notification sent" : "Failed to send" };
  },
});

registerTool({
  name: "search_notifications",
  description: "Search recent notifications/events on the platform",
  parameters: {
    limit: { type: "number", description: "Max results (default 5)" },
    type: { type: "string", description: "Filter by type (sale, signup, system_alert, etc.)" },
  },
  execute: async (params) => {
    const { getSupabaseAdmin } = await import("@/lib/supabase");
    const admin = getSupabaseAdmin();
    if (!admin) return { success: false, output: "Database unavailable" };

    let query = admin
      .from("notifications")
      .select("type, title, body, priority, created_at")
      .order("created_at", { ascending: false })
      .limit(Number(params.limit) || 5);

    if (params.type) {
      query = query.eq("type", String(params.type));
    }

    const { data, error } = await query;
    if (error) return { success: false, output: error.message };

    const formatted = (data || [])
      .map((n: Record<string, unknown>) => `[${n.priority}] ${n.title}: ${n.body}`)
      .join("\n");

    return {
      success: true,
      output: formatted || "No notifications found",
      data: { notifications: data },
    };
  },
});

registerTool({
  name: "get_stats",
  description: "Get platform statistics (users, agents, recent activity)",
  parameters: {},
  execute: async () => {
    const { getSupabaseAdmin } = await import("@/lib/supabase");
    const admin = getSupabaseAdmin();
    if (!admin) return { success: false, output: "Database unavailable" };

    const [users, notifications] = await Promise.all([
      admin.from("users").select("id", { count: "exact", head: true }),
      admin.from("notifications").select("id", { count: "exact", head: true }),
    ]);

    const stats = {
      totalUsers: users.count || 0,
      totalNotifications: notifications.count || 0,
    };

    return {
      success: true,
      output: `Users: ${stats.totalUsers} | Notifications: ${stats.totalNotifications}`,
      data: stats,
    };
  },
});

registerTool({
  name: "home_control",
  description: "Control smart home devices via Home Assistant",
  parameters: {
    action: { type: "string", description: "turn_on | turn_off | set_brightness | set_color", required: true },
    entity: { type: "string", description: "Home Assistant entity_id", required: true },
    value: { type: "string", description: "Value for the action (brightness 0-255, hex color, etc.)" },
  },
  execute: async (params) => {
    const haUrl = process.env.HOME_ASSISTANT_URL;
    const haToken = process.env.HOME_ASSISTANT_TOKEN;
    if (!haUrl || !haToken) {
      return { success: false, output: "Home Assistant not configured" };
    }

    const action = String(params.action);
    const entity = String(params.entity);
    const value = params.value ? String(params.value) : undefined;

    let service = "homeassistant";
    let serviceAction = action;
    const serviceData: Record<string, unknown> = { entity_id: entity };

    if (action === "turn_on" || action === "turn_off") {
      serviceAction = action;
    } else if (action === "set_brightness") {
      service = "light";
      serviceAction = "turn_on";
      serviceData.brightness = parseInt(value || "255", 10);
    } else if (action === "set_color") {
      service = "light";
      serviceAction = "turn_on";
      serviceData.rgb_color = value?.split(",").map(Number) || [255, 255, 255];
    }

    try {
      const res = await fetch(`${haUrl}/api/services/${service}/${serviceAction}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${haToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(serviceData),
      });
      if (res.ok) {
        return { success: true, output: `${action} executed on ${entity}` };
      }
      return { success: false, output: `HA returned ${res.status}` };
    } catch (err) {
      return { success: false, output: `HA error: ${err instanceof Error ? err.message : "Unknown"}` };
    }
  },
});

registerTool({
  name: "web_search",
  description: "Search the web for information",
  parameters: {
    query: { type: "string", description: "Search query", required: true },
  },
  execute: async (params) => {
    const query = String(params.query);
    // Use a simple fetch to DuckDuckGo instant answer API
    try {
      const res = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
      );
      const data = await res.json();
      const abstract = data.AbstractText || data.Answer || "No direct answer found.";
      const relatedTopics = (data.RelatedTopics || [])
        .slice(0, 3)
        .map((t: Record<string, string>) => t.Text)
        .filter(Boolean)
        .join("\n");
      return {
        success: true,
        output: abstract + (relatedTopics ? `\n\nRelated:\n${relatedTopics}` : ""),
        data: { source: "DuckDuckGo" },
      };
    } catch {
      return { success: false, output: "Search failed" };
    }
  },
});
