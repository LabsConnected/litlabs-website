import { CONFIG } from './config';
import { LiTTMobileEvent } from './protocol';

export interface Project {
  id: string;
  name: string;
  description?: string;
  updated_at?: string;
  status?: string;
}

export interface Conversation {
  id: string;
  title: string;
  project_id?: string;
  agent_slug?: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender: 'user' | 'assistant' | 'system';
  content: string;
  agent_slug?: string;
  created_at: string;
}

export class MobileApiClient {
  private getToken: () => Promise<string | null>;

  constructor(getToken: () => Promise<string | null>) {
    this.getToken = getToken;
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client-Platform': 'mobile-companion',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Fetch all projects for the authenticated user
   */
  async getProjects(): Promise<Project[]> {
    const headers = await this.getHeaders();
    const res = await fetch(`${CONFIG.apiUrl}/api/projects`, {
      method: 'GET',
      headers,
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch projects: ${res.statusText}`);
    }
    const data = await res.json();
    return data.projects || data || [];
  }

  /**
   * Fetch conversations for a specific project
   */
  async getConversations(projectId?: string): Promise<Conversation[]> {
    const headers = await this.getHeaders();
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const res = await fetch(`${CONFIG.apiUrl}/api/studio/conversations${query}`, {
      method: 'GET',
      headers,
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch conversations: ${res.statusText}`);
    }
    const data = await res.json();
    return data.conversations || data || [];
  }

  /**
   * Create a new conversation with LiTT or a specialist agent
   */
  async createConversation(projectId?: string, agentSlug: string = 'litt'): Promise<Conversation> {
    const headers = await this.getHeaders();
    const res = await fetch(`${CONFIG.apiUrl}/api/studio/conversations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        projectId,
        agentSlug,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create conversation: ${res.statusText}`);
    }
    const data = await res.json();
    return data.conversation || data;
  }

  /**
   * Fetch messages for a conversation
   */
  async getMessages(conversationId: string): Promise<Message[]> {
    const headers = await this.getHeaders();
    const res = await fetch(`${CONFIG.apiUrl}/api/studio/conversations/${conversationId}/messages`, {
      method: 'GET',
      headers,
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch messages: ${res.statusText}`);
    }
    const data = await res.json();
    return data.messages || data || [];
  }

  /**
   * Send a message to canonical LiTT Execution Engine and stream the response
   */
  async sendMessage(
    conversationId: string,
    content: string,
    onChunk?: (chunk: string) => void,
    onEvent?: (event: LiTTMobileEvent) => void,
    agentSlug: string = 'litt',
    projectId?: string
  ): Promise<Message> {
    const headers = await this.getHeaders();
    const res = await fetch(`${CONFIG.apiUrl}/api/studio/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content,
        agentSlug,
        projectId,
        stream: true,
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to send message: ${res.statusText}`);
    }

    if (res.body && (onChunk || onEvent)) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        buffer += text;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const rawJson = line.slice(6).trim();
            if (rawJson === '[DONE]') continue;
            try {
              const eventPayload: LiTTMobileEvent = JSON.parse(rawJson);
              if (onEvent) onEvent(eventPayload);
              if (eventPayload.type === 'message.delta' && onChunk) {
                fullText += eventPayload.content;
                onChunk(eventPayload.content);
              }
            } catch {
              // Handle plain text chunk fallback
              fullText += rawJson;
              if (onChunk) onChunk(rawJson);
            }
          } else if (line.trim()) {
            fullText += line;
            if (onChunk) onChunk(line);
          }
        }
      }

      return {
        id: `msg-${Date.now()}`,
        conversation_id: conversationId,
        sender: 'assistant',
        content: fullText,
        agent_slug: agentSlug,
        created_at: new Date().toISOString(),
      };
    } else {
      const data = await res.json();
      return data.message || {
        id: `msg-${Date.now()}`,
        conversation_id: conversationId,
        sender: 'assistant',
        content: data.reply || data.content || '',
        agent_slug: agentSlug,
        created_at: new Date().toISOString(),
      };
    }
  }
}
