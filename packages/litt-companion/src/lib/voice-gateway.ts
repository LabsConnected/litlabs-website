export type VoiceSessionState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'processing';

export interface VoiceGateway {
  createSession(): Promise<void>;
  sendAudio(chunk: ArrayBuffer | Blob): void;
  interrupt(): void;
  mute(muted: boolean): void;
  endSession(): void;

  onTranscript(cb: (data: { text: string; isFinal: boolean; sender: 'user' | 'assistant' }) => void): void;
  onAssistantText(cb: (text: string) => void): void;
  onAudio(cb: (pcmData: ArrayBuffer) => void): void;
  onStateChange(cb: (state: VoiceSessionState) => void): void;
  onToolEvent(cb: (event: Record<string, unknown>) => void): void;
}

export class LiTTVoiceGateway implements VoiceGateway {
  private ws: WebSocket | null = null;
  private state: VoiceSessionState = 'idle';
  private isMuted: boolean = false;
  private serverUrl: string;

  private transcriptListeners: Array<(data: { text: string; isFinal: boolean; sender: 'user' | 'assistant' }) => void> = [];
  private assistantTextListeners: Array<(text: string) => void> = [];
  private audioListeners: Array<(pcmData: ArrayBuffer) => void> = [];
  private stateListeners: Array<(state: VoiceSessionState) => void> = [];
  private toolEventListeners: Array<(event: Record<string, unknown>) => void> = [];

  constructor(serverUrl: string = "wss://litlabs.net/api/voice/gateway") {
    this.serverUrl = serverUrl;
  }

  async createSession(): Promise<void> {
    this.setState('connecting');
    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        this.setState('listening');
      };

      this.ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'transcript') {
              this.transcriptListeners.forEach((cb) => cb(msg.payload));
            } else if (msg.type === 'assistant_text') {
              this.setState('speaking');
              this.assistantTextListeners.forEach((cb) => cb(msg.text));
            } else if (msg.type === 'tool_event') {
              this.toolEventListeners.forEach((cb) => cb(msg.event));
            }
          } catch {
            // Ignore parse error
          }
        } else if (event.data instanceof ArrayBuffer) {
          this.setState('speaking');
          this.audioListeners.forEach((cb) => cb(event.data));
        }
      };

      this.ws.onerror = () => {
        this.setState('idle');
      };

      this.ws.onclose = () => {
        this.setState('idle');
      };
    } catch {
      this.setState('idle');
    }
  }

  sendAudio(chunk: ArrayBuffer | Blob): void {
    if (this.isMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.setState('processing');
    this.ws.send(chunk);
  }

  interrupt(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'interrupt' }));
    }
    this.setState('listening');
  }

  mute(muted: boolean): void {
    this.isMuted = muted;
  }

  endSession(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('idle');
  }

  onTranscript(cb: (data: { text: string; isFinal: boolean; sender: 'user' | 'assistant' }) => void): void {
    this.transcriptListeners.push(cb);
  }

  onAssistantText(cb: (text: string) => void): void {
    this.assistantTextListeners.push(cb);
  }

  onAudio(cb: (pcmData: ArrayBuffer) => void): void {
    this.audioListeners.push(cb);
  }

  onStateChange(cb: (state: VoiceSessionState) => void): void {
    this.stateListeners.push(cb);
  }

  onToolEvent(cb: (event: Record<string, unknown>) => void): void {
    this.toolEventListeners.push(cb);
  }

  private setState(newState: VoiceSessionState): void {
    this.state = newState;
    this.stateListeners.forEach((cb) => cb(newState));
  }
}
