/**
 * Voice session manager — tracks active voice sessions per user.
 * Used by the WebSocket session route to coordinate state.
 */

import type { VoiceAgentId, VoiceSessionState } from "@/features/voice/types";

interface ActiveSession {
  sessionId: string;
  userId: string;
  agentId: VoiceAgentId;
  state: VoiceSessionState;
  startedAt: number;
  lastActivity: number;
}

class VoiceSessionManager {
  private sessions = new Map<string, ActiveSession>();
  private userSessions = new Map<string, Set<string>>();

  createSession(userId: string, agentId: VoiceAgentId): string {
    const sessionId = `vs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const session: ActiveSession = {
      sessionId,
      userId,
      agentId,
      state: "idle",
      startedAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.sessions.set(sessionId, session);

    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set());
    }
    this.userSessions.get(userId)!.add(sessionId);

    return sessionId;
  }

  getSession(sessionId: string): ActiveSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  updateState(sessionId: string, state: VoiceSessionState): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = state;
      session.lastActivity = Date.now();
    }
  }

  updateAgent(sessionId: string, agentId: VoiceAgentId): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.agentId = agentId;
      session.lastActivity = Date.now();
    }
  }

  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      const userSet = this.userSessions.get(session.userId);
      if (userSet) {
        userSet.delete(sessionId);
        if (userSet.size === 0) {
          this.userSessions.delete(session.userId);
        }
      }
    }
  }

  getUserSessions(userId: string): ActiveSession[] {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) return [];
    return Array.from(sessionIds)
      .map((id) => this.sessions.get(id))
      .filter((s): s is ActiveSession => !!s);
  }

  cleanupStale(maxAgeMs: number = 30 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > maxAgeMs) {
        this.endSession(id);
      }
    }
  }

  get activeCount(): number {
    return this.sessions.size;
  }
}

export const voiceSessionManager = new VoiceSessionManager();
