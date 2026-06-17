/**
 * Jarvis Discord Integration System
 * Multi-channel webhook notifications for events
 */

export type NotificationChannel = 
  | 'general'
  | 'admin'
  | 'security'
  | 'sales'
  | 'errors'
  | 'agents'
  | 'system';

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  footer?: { text: string; icon_url?: string };
  image?: { url: string };
  thumbnail?: { url: string };
  author?: { name: string; url?: string; icon_url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface DiscordMessage {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
  tts?: boolean;
}

// Color codes for different message types
export const DISCORD_COLORS = {
  info: 0x00f0ff,      // Cyan
  success: 0x00ff41,   // Green
  warning: 0xffff00,   // Yellow
  error: 0xff0040,     // Red
  accent: 0xff00a0,    // Pink
  neutral: 0x8888aa,   // Gray
};

// Channel-specific webhook URLs (loaded from env)
const WEBHOOK_URLS: Record<NotificationChannel, string | undefined> = {
  general: process.env.NEXT_PUBLIC_DISCORD_GENERAL_WEBHOOK,
  admin: process.env.NEXT_PUBLIC_DISCORD_ADMIN_WEBHOOK,
  security: process.env.NEXT_PUBLIC_DISCORD_SECURITY_WEBHOOK,
  sales: process.env.NEXT_PUBLIC_DISCORD_SALES_WEBHOOK,
  errors: process.env.NEXT_PUBLIC_DISCORD_ERRORS_WEBHOOK,
  agents: process.env.NEXT_PUBLIC_DISCORD_AGENTS_WEBHOOK,
  system: process.env.NEXT_PUBLIC_DISCORD_SYSTEM_WEBHOOK,
};

/**
 * Send a message to a Discord webhook
 */
export async function sendDiscordMessage(
  channel: NotificationChannel,
  message: DiscordMessage
): Promise<boolean> {
  const url = WEBHOOK_URLS[channel];
  if (!url) {
    console.warn(`Discord webhook not configured for channel: ${channel}`);
    return false;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...message,
        username: message.username || 'Jarvis',
        avatar_url: message.avatar_url || `${process.env.NEXT_PUBLIC_SITE_URL || "https://litlabs.net"}/jarvis-avatar.png`,
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Failed to send Discord message:', error);
    return false;
  }
}

/**
 * Quick notification helpers
 */
export async function notifyLogin(
  username: string,
  ip?: string,
  userAgent?: string
): Promise<void> {
  await sendDiscordMessage('security', {
    embeds: [{
      title: '🔐 User Login',
      description: `**${username}** has logged in.`,
      color: DISCORD_COLORS.info,
      timestamp: new Date().toISOString(),
      fields: [
        { name: 'User', value: username, inline: true },
        { name: 'IP', value: ip || 'Unknown', inline: true },
        { name: 'Device', value: userAgent?.slice(0, 100) || 'Unknown', inline: false },
      ],
    }],
  });
}

export async function notifyPurchase(
  username: string,
  item: string,
  amount: number,
  currency: string
): Promise<void> {
  await sendDiscordMessage('sales', {
    embeds: [{
      title: '💰 New Purchase',
      description: `**${username}** purchased **${item}**`,
      color: DISCORD_COLORS.success,
      timestamp: new Date().toISOString(),
      fields: [
        { name: 'Item', value: item, inline: true },
        { name: 'Amount', value: `${amount} ${currency}`, inline: true },
        { name: 'Buyer', value: username, inline: true },
      ],
    }],
  });
}

export async function notifyAgentActivity(
  agentName: string,
  action: string,
  details?: string
): Promise<void> {
  await sendDiscordMessage('agents', {
    embeds: [{
      title: '🤖 Agent Activity',
      description: `**${agentName}** ${action}`,
      color: DISCORD_COLORS.accent,
      timestamp: new Date().toISOString(),
      fields: details ? [{ name: 'Details', value: details }] : undefined,
    }],
  });
}

export async function notifyError(
  error: Error,
  context?: string
): Promise<void> {
  await sendDiscordMessage('errors', {
    embeds: [{
      title: '⚠️ System Error',
      description: error.message,
      color: DISCORD_COLORS.error,
      timestamp: new Date().toISOString(),
      fields: [
        { name: 'Context', value: context || 'Unknown', inline: true },
        { name: 'Stack', value: error.stack?.slice(0, 1000) || 'No stack trace', inline: false },
      ],
    }],
  });
}

export async function notifySystemStatus(
  status: 'online' | 'offline' | 'maintenance' | 'update',
  message?: string
): Promise<void> {
  const colors = {
    online: DISCORD_COLORS.success,
    offline: DISCORD_COLORS.error,
    maintenance: DISCORD_COLORS.warning,
    update: DISCORD_COLORS.info,
  };

  const emojis = {
    online: '✅',
    offline: '❌',
    maintenance: '🔧',
    update: '🔄',
  };

  await sendDiscordMessage('system', {
    embeds: [{
      title: `${emojis[status]} System ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      description: message || `System is now ${status}`,
      color: colors[status],
      timestamp: new Date().toISOString(),
    }],
  });
}

// Queue for batching messages
class DiscordQueue {
  private queue: { channel: NotificationChannel; message: DiscordMessage }[] = [];
  private timer: NodeJS.Timeout | null = null;

  add(channel: NotificationChannel, message: DiscordMessage): void {
    this.queue.push({ channel, message });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 1000);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const batch = this.queue.splice(0, 10); // Process up to 10 at a time

    await Promise.all(
      batch.map(({ channel, message }) => sendDiscordMessage(channel, message))
    );

    if (this.queue.length > 0) {
      this.scheduleFlush();
    }
  }
}

export const discordQueue = new DiscordQueue();
