/**
 * useLiTTRun — client-side hook for the canonical LiTT run lifecycle.
 *
 * Manages: user submission → run creation → SSE event streaming →
 * assistant message updates → Canvas block updates → failure/retry.
 *
 * Local UI state caches drafts only. Canonical persistence is server-side.
 */

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  CanonicalMessage,
  KernelDecisionSummary,
  LiTTRunEvent,
  RunStatus,
} from "@/lib/litt/run-contract";

export interface RunState {
  status: RunStatus | "idle";
  runId: string | null;
  conversationId: string | null;
  userMessage: CanonicalMessage | null;
  assistantMessage: CanonicalMessage | null;
  kernelDecision: KernelDecisionSummary | null;
  canvasBlocks: Array<{
    id: string;
    speaker: string;
    content: string;
    status: string;
  }>;
  error: { code: string; message: string; retryable: boolean } | null;
}

const initialState: RunState = {
  status: "idle",
  runId: null,
  conversationId: null,
  userMessage: null,
  assistantMessage: null,
  kernelDecision: null,
  canvasBlocks: [],
  error: null,
};

export function useLiTTRun() {
  const [state, setState] = useState<RunState>(initialState);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Clean up EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const submitMessage = useCallback(
    async (
      message: string,
      options?: {
        conversationId?: string;
        projectId?: string;
        inputMode?: "text" | "voice" | "tool";
      },
    ) => {
      if (!message.trim()) return;
      if (state.status === "pending" || state.status === "running" || state.status === "streaming") {
        return; // Don't allow concurrent runs
      }

      setState({
        ...initialState,
        status: "pending",
      });

      try {
        const response = await fetch("/api/litt/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            conversationId: options?.conversationId,
            projectId: options?.projectId,
            inputMode: options?.inputMode ?? "text",
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          setState({
            ...initialState,
            status: "failed",
            error: {
              code: `HTTP_${response.status}`,
              message: errorData.error || `Request failed: ${response.statusText}`,
              retryable: response.status >= 500,
            },
          });
          return;
        }

        const data = await response.json();
        const runId: string = data.runId;
        const conversationId: string = data.conversationId;
        const userMessage: CanonicalMessage = data.userMessage;
        const kernelDecision: KernelDecisionSummary = data.kernelDecision;

        setState({
          ...initialState,
          status: "streaming",
          runId,
          conversationId,
          userMessage,
          kernelDecision,
          canvasBlocks: [
            {
              id: userMessage.canvasBlockId ?? "",
              speaker: "user",
              content: userMessage.content,
              status: "complete",
            },
          ],
        });

        // Connect to SSE events stream
        const eventsUrl = data.eventsUrl;
        const es = new EventSource(eventsUrl);
        eventSourceRef.current = es;

        es.addEventListener("message.assistant.started", (e) => {
          const event: LiTTRunEvent = JSON.parse(e.data);
          if (event.type === "message.assistant.started") {
            setState((prev) => ({
              ...prev,
              assistantMessage: event.message,
              canvasBlocks: [
                ...prev.canvasBlocks,
                {
                  id: event.message.canvasBlockId ?? "",
                  speaker: "litt",
                  content: "",
                  status: "streaming",
                },
              ],
            }));
          }
        });

        es.addEventListener("message.assistant.delta", (e) => {
          const event: LiTTRunEvent = JSON.parse(e.data);
          if (event.type === "message.assistant.delta") {
            setState((prev) => {
              if (!prev.assistantMessage) return prev;
              const newContent = prev.assistantMessage.content + event.delta;
              return {
                ...prev,
                assistantMessage: {
                  ...prev.assistantMessage,
                  content: newContent,
                },
                canvasBlocks: prev.canvasBlocks.map((b, i) =>
                  i === prev.canvasBlocks.length - 1
                    ? { ...b, content: newContent }
                    : b,
                ),
              };
            });
          }
        });

        es.addEventListener("canvas.block.updated", (e) => {
          const event: LiTTRunEvent = JSON.parse(e.data);
          if (event.type === "canvas.block.updated") {
            setState((prev) => ({
              ...prev,
              canvasBlocks: prev.canvasBlocks.map((b) =>
                b.id === event.blockId
                  ? { ...b, content: event.content }
                  : b,
              ),
            }));
          }
        });

        es.addEventListener("message.assistant.completed", (e) => {
          const event: LiTTRunEvent = JSON.parse(e.data);
          if (event.type === "message.assistant.completed") {
            setState((prev) => ({
              ...prev,
              status: "completed",
              assistantMessage: event.message,
              canvasBlocks: prev.canvasBlocks.map((b, i) =>
                i === prev.canvasBlocks.length - 1
                  ? { ...b, status: "complete" }
                  : b,
              ),
            }));
          }
        });

        es.addEventListener("run.completed", () => {
          setState((prev) => ({ ...prev, status: "completed" }));
          es.close();
          eventSourceRef.current = null;
        });

        es.addEventListener("run.failed", (e) => {
          const event: LiTTRunEvent = JSON.parse(e.data);
          if (event.type === "run.failed") {
            setState((prev) => ({
              ...prev,
              status: "failed",
              error: event.error,
              assistantMessage: prev.assistantMessage
                ? { ...prev.assistantMessage, status: "failed", error: event.error }
                : null,
            }));
          }
          es.close();
          eventSourceRef.current = null;
        });

        es.addEventListener("run.cancelled", () => {
          setState((prev) => ({
            ...prev,
            status: "cancelled",
            assistantMessage: prev.assistantMessage
              ? { ...prev.assistantMessage, status: "cancelled" }
              : null,
          }));
          es.close();
          eventSourceRef.current = null;
        });

        es.onerror = () => {
          // SSE error — try to reconnect or mark as failed
          setState((prev) => ({
            ...prev,
            status: prev.status === "streaming" ? "failed" : prev.status,
            error: prev.error ?? {
              code: "SSE_DISCONNECTED",
              message: "Connection to the server was lost",
              retryable: true,
            },
          }));
          es.close();
          eventSourceRef.current = null;
        };
      } catch (err) {
        setState({
          ...initialState,
          status: "failed",
          error: {
            code: "NETWORK_ERROR",
            message: err instanceof Error ? err.message : "Network error",
            retryable: true,
          },
        });
      }
    },
    [state.status],
  );

  const cancelRun = useCallback(async () => {
    if (!state.runId) return;
    try {
      await fetch(`/api/litt/runs/${state.runId}/cancel`, { method: "POST" });
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setState((prev) => ({
        ...prev,
        status: "cancelled",
        assistantMessage: prev.assistantMessage
          ? { ...prev.assistantMessage, status: "cancelled" }
          : null,
      }));
    } catch {
      // Even if cancel request fails, close the SSE stream
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }
  }, [state.runId]);

  const retryRun = useCallback(async () => {
    if (!state.runId) return;
    if (state.status !== "failed" && state.status !== "cancelled") return;

    setState((prev) => ({ ...prev, status: "pending", error: null }));

    try {
      const response = await fetch(`/api/litt/runs/${state.runId}/retry`, {
        method: "POST",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: {
            code: `HTTP_${response.status}`,
            message: errorData.error || "Retry failed",
            retryable: true,
          },
        }));
        return;
      }

      const data = await response.json();
      const newRunId: string = data.runId;

      setState((prev) => ({
        ...prev,
        status: "streaming",
        runId: newRunId,
        assistantMessage: null,
        error: null,
        canvasBlocks: prev.canvasBlocks.filter((b) => b.speaker === "user"),
      }));

      // Connect to new SSE stream
      const eventsUrl = data.eventsUrl;
      const es = new EventSource(eventsUrl);
      eventSourceRef.current = es;

      es.addEventListener("message.assistant.started", (e) => {
        const event: LiTTRunEvent = JSON.parse(e.data);
        if (event.type === "message.assistant.started") {
          setState((prev) => ({
            ...prev,
            assistantMessage: event.message,
            canvasBlocks: [
              ...prev.canvasBlocks,
              {
                id: event.message.canvasBlockId ?? "",
                speaker: "litt",
                content: "",
                status: "streaming",
              },
            ],
          }));
        }
      });

      es.addEventListener("message.assistant.delta", (e) => {
        const event: LiTTRunEvent = JSON.parse(e.data);
        if (event.type === "message.assistant.delta") {
          setState((prev) => {
            if (!prev.assistantMessage) return prev;
            const newContent = prev.assistantMessage.content + event.delta;
            return {
              ...prev,
              assistantMessage: { ...prev.assistantMessage, content: newContent },
              canvasBlocks: prev.canvasBlocks.map((b, i) =>
                i === prev.canvasBlocks.length - 1
                  ? { ...b, content: newContent }
                  : b,
              ),
            };
          });
        }
      });

      es.addEventListener("message.assistant.completed", (e) => {
        const event: LiTTRunEvent = JSON.parse(e.data);
        if (event.type === "message.assistant.completed") {
          setState((prev) => ({
            ...prev,
            status: "completed",
            assistantMessage: event.message,
            canvasBlocks: prev.canvasBlocks.map((b, i) =>
              i === prev.canvasBlocks.length - 1
                ? { ...b, status: "complete" }
                : b,
            ),
          }));
        }
      });

      es.addEventListener("run.completed", () => {
        setState((prev) => ({ ...prev, status: "completed" }));
        es.close();
        eventSourceRef.current = null;
      });

      es.addEventListener("run.failed", (e) => {
        const event: LiTTRunEvent = JSON.parse(e.data);
        if (event.type === "run.failed") {
          setState((prev) => ({
            ...prev,
            status: "failed",
            error: event.error,
          }));
        }
        es.close();
        eventSourceRef.current = null;
      });

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
      };
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: "failed",
        error: {
          code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Network error",
          retryable: true,
        },
      }));
    }
  }, [state.runId, state.status]);

  const restoreConversation = useCallback(
    async (conversationId: string) => {
      try {
        const response = await fetch(`/api/litt/conversations/${conversationId}`);
        if (!response.ok) return;

        const data = await response.json();
        const messages: CanonicalMessage[] = data.messages || [];
        const blocks: Array<Record<string, unknown>> = data.blocks || [];

        // Reconstruct UI state from persisted data
        const userMessages = messages.filter((m) => m.role === "user");
        const assistantMessages = messages.filter((m) => m.role === "assistant");

        setState({
          status: "idle",
          runId: null,
          conversationId,
          userMessage: userMessages[userMessages.length - 1] ?? null,
          assistantMessage: assistantMessages[assistantMessages.length - 1] ?? null,
          kernelDecision: null,
          canvasBlocks: blocks.map((b) => ({
            id: b.id as string,
            speaker: (b.metadata as Record<string, unknown>)?.speaker as string ?? "user",
            content: ((b.content as Record<string, unknown>)?.text as string) ?? "",
            status: ((b.content as Record<string, unknown>)?.status as string) ?? "complete",
          })),
          error: null,
        });
      } catch {
        // Silent fail on restore — UI shows empty state
      }
    },
    [],
  );

  return {
    state,
    submitMessage,
    cancelRun,
    retryRun,
    restoreConversation,
  };
}
