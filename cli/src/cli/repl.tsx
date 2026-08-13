import React, { useState, useRef, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { ChatMessage, ToolActivity, RuntimeContext } from "./types.js";
import { runLiTTStream } from "./api-client.js";
import { CLI_NAME, CLI_VERSION } from "./types.js";

type ReplProps = {
  cwd: string;
  runtimeContext: RuntimeContext;
  model?: string;
  provider?: string;
  onExit: () => void;
};

export function Repl({ cwd, runtimeContext, model, provider, onExit }: ReplProps): React.JSX.Element {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [assistantText, setAssistantText] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activities, setActivities] = useState<ToolActivity[]>([]);
  const inputRef = useRef<{ focus: () => void }>(null);

  const addActivity = useCallback((type: ToolActivity["type"], label: string) => {
    setActivities((prev) => [...prev, { type, label, timestamp: Date.now() }]);
  }, []);

  const addMessage = useCallback((role: "user" | "assistant", content: string) => {
    setMessages((prev) => [...prev, { role, content, timestamp: Date.now() }]);
  }, []);

  const visibleActivities = activities.slice(-5);

  const statusLine = useCallback((ctx: RuntimeContext): string => {
    const branch = ctx.git.branch ? ` @${ctx.git.branch}` : "";
    const modelPart = model ? ` model:${model}` : "";
    return `${CLI_NAME} v${CLI_VERSION}${branch}${modelPart}`;
  }, [model]);

  const clearActivities = useCallback(() => {
    setActivities([]);
  }, []);

  const submit = useCallback((value: string) => {
    const prompt = value.trim();
    if (!prompt || isStreaming) return;

    addMessage("user", prompt);
    setInput("");
    setIsStreaming(true);
    setAssistantText("");
    addActivity("thinking", "LiTT is thinking…");

    const historyForRequest: ChatMessage[] = messages
      .filter((m) => m.role !== "tool")
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp }));

    (async () => {
      try {
        const stream = runLiTTStream({
          message: prompt,
          history: historyForRequest,
          runtimeContext: {
            cwd: runtimeContext.cwd,
            git: runtimeContext.git,
            project: runtimeContext.project,
            terminalAvailable: runtimeContext.terminalAvailable,
            writeAccess: runtimeContext.writeAccess,
          },
          model,
          provider,
          agentSlug: "litt",
          projectId: runtimeContext.project.projectId ?? undefined,
        });
        for await (const event of stream) {
          if (event.type === "text" && event.text) {
            setAssistantText((prev) => prev + event.text);
          }
        }
        addMessage("assistant", assistantText);
      } catch (err) {
        const message = err instanceof Error ? err.message : "stream error";
        addActivity("waiting", message);
        setAssistantText(`Error: ${message}`);
      } finally {
        setIsStreaming(false);
        clearActivities();
      }
    })();
  }, [
    isStreaming,
    messages,
    addMessage,
    addActivity,
    clearActivities,
    model,
    provider,
    runtimeContext,
    assistantText,
  ]);

  useInput((value, key) => {
    if (key.ctrl && (value === "c" || value === "C")) {
      onExit();
      exit();
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <Box justifyContent="space-between" paddingX={1} paddingY={1}>
        <Text bold color="cyan">{CLI_NAME}</Text>
        <Text dimColor>v{CLI_VERSION}</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {messages.map((message, i) => (
          <Box key={i} flexDirection="column" marginY={0} paddingX={1}>
            <Text color={message.role === "user" ? "green" : "white"}>
              {message.role === "user" ? "You" : "LiTT"}:
            </Text>
            <Text>{message.content}</Text>
          </Box>
        ))}

        {isStreaming && (
          <Box flexDirection="column" paddingX={1}>
            <Box>
              <Spinner />
              <Text color="cyan"> Thinking…</Text>
            </Box>
            {assistantText && <Text>{assistantText}</Text>}
          </Box>
        )}
      </Box>

      {visibleActivities.length > 0 && (
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text dimColor>Activities:</Text>
          {visibleActivities.map((activity, i) => (
            <Box key={`${activity.timestamp}-${i}`}>
              <Text dimColor>{`  • ${activity.type}: ${activity.label}`}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box borderStyle="round" paddingX={1}>
        <Text color="cyan">❯ </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={submit}
          placeholder="Ask LiTT to inspect, build, debug, test, or ship…"
        />
      </Box>

      <Box paddingX={1} justifyContent="space-between">
        <Text dimColor>{cwd}</Text>
        <Text dimColor>{statusLine(runtimeContext)}</Text>
      </Box>
    </Box>
  );
}
