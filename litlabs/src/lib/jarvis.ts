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
  pushVapidPublicKey?: string;
  pushVapidPrivateKey?: string;
  pushVapidSubject?: string;
  webhookEndpoint?: string;
  resendApiKey?: string;
}

class LiT {
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
      // LiT not initialized — using default config
    }

    const channels = payload.channels || ["discord"];
    const results: boolean[] = [];

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
      // DB error saving notification — continuing
    } catch (err) {
      // Error saving notification — continuing
    }

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
            results.push(await this.sendPush(payload));
            break;
          case "email":
            results.push(await this.sendEmail(payload));
            break;
        }
      } catch (err) {
        // Failed to send notification on this channel — continuing
        results.push(false);
      }
    }

    return results.some((r) => r);
  }

  private async sendDiscord(payload: NotificationPayload): Promise<boolean> {
    if (!this.config.discordWebhookUrl) return false;

    const colorMap: Record<NotificationPriority, number> = {
      low: 0x00ff00,
      medium: 0xffff00,
      high: 0xffa500,
      critical: 0xff0000,
    };

    const typeEmoji: Record<NotificationType, string> = {
      sale: "\u{1F4B0}",
      signup: "\u{1F4DD}",
      agent_created: "\u{1F916}",
      system_alert: "\u26A0\uFE0F",
      chat: "\u{1F4AC}",
      marketing: "\u{1F4E2}",
      cli_event: "\u{1F4BB}",
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
      footer: { text: `LiTTree Labs \u2022 ${payload.priority.toUpperCase()}` },
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
    if (!this.config.webhookEndpoint) return false;

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
          source: "lit",
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async sendPush(payload: NotificationPayload): Promise<boolean> {
    if (!this.config.pushVapidPublicKey || !this.config.pushVapidPrivateKey) {
      return false;
    }

    try {
      const subscriptions = await supabase
        .from("push_subscriptions")
        .select("subscription")
        .eq("user_id", payload.userId || "");

      const subs = subscriptions.data || [];
      if (subs.length === 0) return false;

      const results = await Promise.allSettled(
        subs.map(async (row) => {
          const sub = (row as { subscription: { endpoint: string } }).subscription;
          await fetch(sub.endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `vapid t=${this.config.pushVapidPublicKey}, k=${this.config.pushVapidPrivateKey}`,
            },
            body: JSON.stringify({
              title: payload.title,
              body: payload.body,
              icon: "/logo.webp",
              data: payload.data || {},
            }),
          });
        }),
      );

      return results.some((r) => r.status === "fulfilled");
    } catch {
      return false;
    }
  }

  private async sendEmail(payload: NotificationPayload): Promise<boolean> {
    if (!this.config.resendApiKey || !this.config.adminEmail) {
      return false;
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.resendApiKey}`,
        },
        body: JSON.stringify({
          from: "LiT <notifications@litlabs.net>",
          to: this.config.adminEmail,
          subject: `[${payload.priority.toUpperCase()}] ${payload.title}`,
          html: `
            <h2>${payload.title}</h2>
            <p>${payload.body}</p>
            ${payload.data ? `<pre>${JSON.stringify(payload.data, null, 2)}</pre>` : ""}
            <hr />
            <p style="color: #888; font-size: 12px;">LiTTree Labs Notification System</p>
          `,
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

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
      title: "New Sale! \uD83C\uDF89",
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

export const lit = new LiT();

if (typeof window === "undefined") {
  lit.init({
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
    adminEmail: process.env.ADMIN_EMAIL,
    webhookEndpoint: process.env.LIT_WEBHOOK_URL,
    pushVapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    pushVapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
    pushVapidSubject: process.env.VAPID_SUBJECT || "mailto:admin@litlabs.net",
    resendApiKey: process.env.RESEND_API_KEY,
  });
}

export default lit;
