"use client";

/**
 * ConversationContext — the canonical conversation provider for Studio.
 *
 * Wires together:
 * - ConversationEngine (canonical message lifecycle)
 * - CanvasEngine (linked transcript blocks)
 * - RealtimeVoiceProvider (OpenAI Realtime / fallback)
 * - CapabilityRegistry (real tool states)
 * - LiTTEventBus (shared event stream)
 *
 * This provider mounts ABOVE Studio tool routing. Tool switching,
 * project creation, and Canvas opening must NOT destroy the session.
 *
 * @see src/lib/litt/types.ts
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { ConversationEngine, generateId } from "@/lib/litt/conversation-engine";
import { CanvasEngine, type ConversationCanvasMode } from "@/lib/litt/canvas/canvas-engine";
import { getEventBus } from "@/lib/litt/event-bus";
import { getCapabilityRegistry } from "@/lib/litt/capability/capability-registry";
import { OpenAIRealtimeProvider } from "@/lib/litt/voice/openai-realtime";
import { TextOnlyFallbackProvider } from "@/lib/litt/voice/text-only-fallback";
import type {
  ChatMessage,
  InputMode,
  RealtimeVoiceProvider,
  VoiceRuntimeState,
  CapabilityRecord,
  LiTTEvent,
  LiTTError,
} from "@/lib/litt/types";

interface ConversationContextValue {
  conversation: ConversationEngine;
  canvas: CanvasEngine;
  voiceProvider: RealtimeVoiceProvider;
  voiceRuntimeState: VoiceRuntimeState;
  connectVoice: (config: { agentId: string; instructions: string; voice?: string }) => Promise<void>;
  disconnectVoice: () => Promise<void>;
  startMicrophone: () => Promise<void>;
  stopMicrophone: () => void;
  interruptVoice: () => Promise<void>;
  speakAssistantMessage: (messageId: string, text: string) => Promise<void>;
  partialTranscript: string;
  clearPartialTranscript: () => void;
  messages: ChatMessage[];
  sendMessage: (text: string, inputMode?: InputMode) => Promise<ChatMessage | null>;
  startAssistantResponse: (inputMode?: InputMode) => ChatMessage;
  appendAssistantDelta: (messageId: string, delta: string) => void;
  completeAssistantMessage: (messageId: string, finalContent?: string) => ChatMessage | null;
  failMessage: (messageId: string, error: LiTTError) => void;
  clearConversation: () => void;
  canvasMode: ConversationCanvasMode;
  setCanvasMode: (mode: ConversationCanvasMode) => void;
  capabilities: CapabilityRecord[];
  subscribeToEvents: (handler: (event: LiTTEvent) => void) => () => void;
}

const ConversationContext = createContext<ConversationContextValue | null>(null);

export function useConversation(): ConversationContextValue {
  const ctx = useContext(ConversationContext);
  if (!ctx) {
    throw new Error("useConversation must be used within ConversationProvider");
  }
  return ctx;
}

interface ConversationProviderProps {
  children: ReactNode;
  agentId?: string;
  instructions?: string;
}

export function ConversationProvider({
  children,
  agentId = "litt",
  instructions: _instructions = "You are LiTT, the LabStudios Ultra assistant.",
}: ConversationProviderProps) {
  // Engines — created once via lazy useState, survive re-renders
  const [conversation] = useState(
    () => new ConversationEngine({ conversationId: generateId("conv"), agentId }),
  );
  const [canvas] = useState(
    () => new CanvasEngine({ canvasId: generateId("canvas"), mode: "live_stream" }),
  );
  const [capabilityRegistry] = useState(() => getCapabilityRegistry());
  const [bus] = useState(() => getEventBus());

  // Voice provider — state so context value updates on swap
  const [voiceProvider, setVoiceProvider] = useState<RealtimeVoiceProvider>(
    () => new TextOnlyFallbackProvider(),
  );

  // UI state
  const [messages, setMessages] = useState<ChatMessage[]>(() => [...conversation.getMessages()]);
  const [voiceRuntimeState, setVoiceRuntimeState] = useState<VoiceRuntimeState>(() =>
    voiceProvider.getRuntimeState(),
  );
  const [partialTranscript, setPartialTranscript] = useState("");
  const [canvasMode, setCanvasModeState] = useState<ConversationCanvasMode>(canvas.getMode());
  const [capabilities, setCapabilities] = useState<CapabilityRecord[]>(() =>
    capabilityRegistry.getAllRecords(),
  );

  const syncMessages = useCallback(() => {
    setMessages([...conversation.getMessages()]);
  }, [conversation]);

  // Subscribe to event bus
  useEffect(() => {
    const unsubscribe = bus.subscribe((event) => {
      switch (event.type) {
        case "message.user.created":
        case "message.assistant.started":
        case "message.assistant.completed":
        case "message.failed":
        case "message.assistant.delta":
          syncMessages();
          break;
        case "voice.user_transcript.delta":
          setPartialTranscript((prev) => prev + event.text);
          break;
        case "voice.user_transcript.completed":
          setPartialTranscript("");
          break;
        case "voice.transport.connected":
          capabilityRegistry.setState("voice.transport", "ready", undefined, "openai-realtime");
          capabilityRegistry.setState("voice.input", "ready");
          capabilityRegistry.setState("voice.output", "ready");
          setCapabilities(capabilityRegistry.getAllRecords());
          break;
        case "voice.transport.disconnected":
          capabilityRegistry.setState("voice.transport", "offline");
          capabilityRegistry.setState("voice.input", "offline");
          capabilityRegistry.setState("voice.output", "offline");
          setCapabilities(capabilityRegistry.getAllRecords());
          break;
        case "voice.mic.started":
        case "voice.mic.stopped":
        case "voice.mic.denied":
          setVoiceRuntimeState(voiceProvider.getRuntimeState());
          break;
      }
    });
    return unsubscribe;
  }, [bus, syncMessages, capabilityRegistry, voiceProvider]);

  // Voice connection
  const connectVoice = useCallback(
    async (config: { agentId: string; instructions: string; voice?: string }) => {
      const provider = new OpenAIRealtimeProvider();

      provider.onUserTranscriptDelta(({ text }) => {
        bus.emit({ type: "voice.user_transcript.delta", text });
      });
      provider.onUserTranscriptComplete(({ text }) => {
        bus.emit({ type: "voice.user_transcript.completed", text });
        const userMsg = conversation.createUserMessage(text, "voice");
        canvas.createTranscriptBlock(userMsg);
      });
      provider.onAssistantTextDelta(({ messageId, delta }) => {
        conversation.appendDelta(messageId, delta);
        const block = canvas.findBlockByMessageId(messageId);
        if (block) {
          const msg = conversation.getMessages().find((m) => m.id === messageId);
          if (msg) canvas.updateBlockContent(block.id, msg.content);
        }
      });
      provider.onAssistantTextComplete(({ messageId, content }) => {
        const completed = conversation.completeAssistantMessage(messageId, content);
        const block = canvas.findBlockByMessageId(messageId);
        if (block) canvas.finalizeBlock(block.id);
        if (completed) {
          provider.speakText(completed.id, completed.content);
        }
      });
      provider.onTransportChange((state) => {
        if (state === "connected") bus.emit({ type: "voice.transport.connected" });
        else if (state === "disconnected") bus.emit({ type: "voice.transport.disconnected" });
        else if (state === "connecting") bus.emit({ type: "voice.transport.connecting" });
        setVoiceRuntimeState(provider.getRuntimeState());
      });
      provider.onMicChange((state) => {
        if (state === "on") bus.emit({ type: "voice.mic.started" });
        else if (state === "off") bus.emit({ type: "voice.mic.stopped" });
        else if (state === "denied") bus.emit({ type: "voice.mic.denied" });
        setVoiceRuntimeState(provider.getRuntimeState());
      });
      provider.onError((error) => {
        bus.emit({ type: "voice.transport.error", error });
      });

      await provider.connect(config);
      setVoiceProvider(provider);
      setVoiceRuntimeState(provider.getRuntimeState());
    },
    [bus, conversation, canvas],
  );

  const disconnectVoice = useCallback(async () => {
    await voiceProvider.disconnect();
    const fallback = new TextOnlyFallbackProvider();
    setVoiceProvider(fallback);
    setVoiceRuntimeState(fallback.getRuntimeState());
  }, [voiceProvider]);

  const startMicrophone = useCallback(async () => {
    await voiceProvider.startMicrophone();
    setVoiceRuntimeState(voiceProvider.getRuntimeState());
  }, [voiceProvider]);

  const stopMicrophone = useCallback(() => {
    voiceProvider.stopMicrophone();
    setVoiceRuntimeState(voiceProvider.getRuntimeState());
  }, [voiceProvider]);

  const interruptVoice = useCallback(async () => {
    await voiceProvider.interrupt();
    setVoiceRuntimeState(voiceProvider.getRuntimeState());
  }, [voiceProvider]);

  const speakAssistantMessage = useCallback(
    async (messageId: string, text: string) => {
      await voiceProvider.speakText(messageId, text);
      setVoiceRuntimeState(voiceProvider.getRuntimeState());
    },
    [voiceProvider],
  );

  const clearPartialTranscript = useCallback(() => setPartialTranscript(""), []);

  const sendMessage = useCallback(
    async (text: string, inputMode: InputMode = "text"): Promise<ChatMessage | null> => {
      const userMsg = conversation.createUserMessage(text, inputMode);
      canvas.createTranscriptBlock(userMsg);
      syncMessages();
      return userMsg;
    },
    [conversation, canvas, syncMessages],
  );

  const startAssistantResponse = useCallback(
    (inputMode: InputMode = "text"): ChatMessage => {
      const msg = conversation.startAssistantMessage(inputMode);
      canvas.createTranscriptBlock(msg);
      syncMessages();
      return msg;
    },
    [conversation, canvas, syncMessages],
  );

  const appendAssistantDelta = useCallback(
    (messageId: string, delta: string) => {
      conversation.appendDelta(messageId, delta);
      const block = canvas.findBlockByMessageId(messageId);
      if (block) {
        const msg = conversation.getMessages().find((m) => m.id === messageId);
        if (msg) canvas.updateBlockContent(block.id, msg.content);
      }
    },
    [conversation, canvas],
  );

  const completeAssistantMessage = useCallback(
    (messageId: string, finalContent?: string): ChatMessage | null => {
      const completed = conversation.completeAssistantMessage(messageId, finalContent);
      const block = canvas.findBlockByMessageId(messageId);
      if (block) canvas.finalizeBlock(block.id);
      syncMessages();
      return completed;
    },
    [conversation, canvas, syncMessages],
  );

  const failMessage = useCallback(
    (messageId: string, error: LiTTError) => {
      conversation.failMessage(messageId, error);
      syncMessages();
    },
    [conversation, syncMessages],
  );

  const clearConversation = useCallback(() => {
    conversation.clear();
    canvas.clear();
    setPartialTranscript("");
    syncMessages();
  }, [conversation, canvas, syncMessages]);

  const setCanvasMode = useCallback((mode: ConversationCanvasMode) => {
    canvas.setMode(mode);
    setCanvasModeState(mode);
  }, [canvas]);

  const subscribeToEvents = useCallback(
    (handler: (event: LiTTEvent) => void) => bus.subscribe(handler),
    [bus],
  );

  const value = useMemo<ConversationContextValue>(
    () => ({
      conversation,
      canvas,
      voiceProvider,
      voiceRuntimeState,
      connectVoice,
      disconnectVoice,
      startMicrophone,
      stopMicrophone,
      interruptVoice,
      speakAssistantMessage,
      partialTranscript,
      clearPartialTranscript,
      messages,
      sendMessage,
      startAssistantResponse,
      appendAssistantDelta,
      completeAssistantMessage,
      failMessage,
      clearConversation,
      canvasMode,
      setCanvasMode,
      capabilities,
      subscribeToEvents,
    }),
    [
      conversation,
      canvas,
      voiceProvider,
      voiceRuntimeState,
      connectVoice,
      disconnectVoice,
      startMicrophone,
      stopMicrophone,
      interruptVoice,
      speakAssistantMessage,
      partialTranscript,
      messages,
      sendMessage,
      startAssistantResponse,
      appendAssistantDelta,
      completeAssistantMessage,
      failMessage,
      clearConversation,
      canvasMode,
      setCanvasMode,
      capabilities,
      subscribeToEvents,
    ],
  );

  return (
    <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>
  );
}
