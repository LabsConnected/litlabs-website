// Jarvis Notification System
// Real-time notifications for sales, signups, system alerts
// Multi-channel: Discord, Webhook, Push, Email

import { supabase } from "./supabase";

export type NotificationType =
  | "sale"
  | "signup"
  | "agent_created"
  | "system_alert"
  | "chat"
  | "marketing"
  | "cli_event";

export type NotificationPriority = "low" | "medium" | "high" | "critical";

export interface NotificationPayload {
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  userId?: string;
  channels?: ("discord" | "webhook" | "push" | "email")[];
}

export interface NotificationConfig {
  discordWebhookUrl?: string;
  adminEmail?: string;
  pushProvider?: "onesignal" | "webpush";
  webhookEndpoint?: string;
}

// Jarvis class for handling notifications
class Jarvis {
  private config: NotificationConfig;
  private initialized = false;

  constructor(config: NotificationConfig = {}) {
    this.config = config;
  }

  init(config: NotificationConfig) {
    this.config = { ...this.config, ...config };
    this.initialized = true;
  }

  async notify(payload: NotificationPayload): Promise<boolean> {
    if (!this.initialized) {
      // Silenced
    }

    const channels = payload.channels || ["discord"];
    const results: boolean[] = [];

    // Save to database first
    try {
      const { error } = await supabase.from("notifications").insert({
        user_id: payload.userId || null,
        type: payload.type,
        priority: payload.priority,
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
        channels: channels,
      });

      if (error) {
        // Silenced
      }
    } catch {
      // Silenced
    }

    // Send to each channel
    for (const channel of channels) {
      try {
        switch (channel) {
          case "discord":
            results.push(await this.sendDiscord(payload));
            break;
          case "webhook":
            results.push(await this.sendWebhook(payload));
            break;
          case "push":
            results.push(await this.sendPush());
            break;
          case "email":
            results.push(await this.sendEmail());
            break;
        }
      } catch {
        results.push(false);
      }
    }

    return results.some((r) => r); // Return true if at least one succeeded
  }

  private async sendDiscord(payload: NotificationPayload): Promise<boolean> {
    if (!this.config.discordWebhookUrl) {
      return false;
    }

    const colorMap: Record<NotificationPriority, number> = {
      low: 0x00ff00, // Green
      medium: 0xffff00, // Yellow
      high: 0xffa500, // Orange
      critical: 0xff0000, // Red
    };

    const typeEmoji: Record<NotificationType, string> = {
      sale: "💰",
      signup: "📝",
      agent_created: "🤖",
      system_alert: "⚠️",
      chat: "💬",
      marketing: "📢",
      cli_event: "💻",
    };

    const embed = {
      title: `${typeEmoji[payload.type]} ${payload.title}`,
      description: payload.body,
      color: colorMap[payload.priority],
      timestamp: new Date().toISOString(),
      fields: payload.data
        ? Object.entries(payload.data).map(([key, value]) => ({
            name: key,
            value: String(value).substring(0, 1000),
            inline: true,
          }))
        : [],
      footer: {
        text: `LiTTree Labs • ${payload.priority.toUpperCase()}`,
      },
    };

    try {
      const response = await fetch(this.config.discordWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  private async sendWebhook(payload: NotificationPayload): Promise<boolean> {
    if (!this.config.webhookEndpoint) {
      return false;
    }

    try {
      const response = await fetch(this.config.webhookEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: payload.type,
          priority: payload.priority,
          title: payload.title,
          body: payload.body,
          data: payload.data,
          timestamp: new Date().toISOString(),
          source: "jarvis",
        }),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  private async sendPush(): Promise<boolean> {
    // OneSignal or WebPush implementation would go here
    return true;
  }

  private async sendEmail(): Promise<boolean> {
    // Resend or SendGrid implementation would go here
    return true;
  }

  // Quick notification methods
  async sale(data: {
    buyerName: string;
    agentName: string;
    priceLBC: number;
    priceUSD?: number;
    sellerName?: string;
  }) {
    return this.notify({
      type: "sale",
      priority: "high",
      title: "New Sale! 🎉",
      body: `${data.buyerName} bought ${data.agentName} for ${data.priceLBC} LBC`,
      data: {
        buyer: data.buyerName,
        agent: data.agentName,
        price_lbc: data.priceLBC,
        price_usd: data.priceUSD || 0,
        seller: data.sellerName || "Platform",
      },
      channels: ["discord", "webhook"],
    });
  }

  async signup(data: { userName: string; userEmail: string; source?: string }) {
    return this.notify({
      type: "signup",
      priority: "medium",
      title: "New User Signup",
      body: `${data.userName} (${data.userEmail}) just joined`,
      data: {
        name: data.userName,
        email: data.userEmail,
        source: data.source || "website",
      },
      channels: ["discord"],
    });
  }

  async agentCreated(data: {
    creatorName: string;
    agentName: string;
    category: string;
  }) {
    return this.notify({
      type: "agent_created",
      priority: "medium",
      title: "New Agent Created",
      body: `${data.creatorName} created ${data.agentName}`,
      data: {
        creator: data.creatorName,
        agent: data.agentName,
        category: data.category,
      },
      channels: ["discord"],
    });
  }

  async systemAlert(data: {
    message: string;
    severity: NotificationPriority;
    details?: Record<string, unknown>;
  }) {
    return this.notify({
      type: "system_alert",
      priority: data.severity,
      title: "System Alert",
      body: data.message,
      data: data.details || {},
      channels: ["discord", "webhook", "email"],
    });
  }

  async cliEvent(data: {
    tool: string;
    command: string;
    output: string;
    success: boolean;
  }) {
    return this.notify({
      type: "cli_event",
      priority: data.success ? "low" : "high",
      title: `CLI: ${data.tool}`,
      body: data.success
        ? "Command executed successfully"
        : `Failed: ${data.output}`,
      data: {
        tool: data.tool,
        command: data.command,
        output: data.output.substring(0, 500),
        success: data.success,
      },
      channels: ["discord"],
    });
  }
}

// Singleton instance
export const jarvis = new Jarvis();

// Initialize with environment variables
if (typeof window !== "undefined") {
  // Browser - can't access env vars directly
  // Will be initialized via API call
} else {
  // Server
  jarvis.init({
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
    adminEmail: process.env.ADMIN_EMAIL,
    webhookEndpoint: process.env.JARVIS_WEBHOOK_URL,
  });
}

export default jarvis;
