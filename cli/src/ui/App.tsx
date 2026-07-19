import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { askLiTTCode } from "@litt/agent-core";

type AppProps = {
  cwd: string;
  model: string;
  mode: string;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
};

export function App({ cwd, model, mode }: AppProps): React.JSX.Element {
  const { exit } = useApp();

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "LiTT Code online. Tell me what we are building.",
    },
  ]);

  useInput((character, key) => {
    if (key.ctrl && character === "c") {
      if (busy) {
        setBusy(false);
        return;
      }

      exit();
    }
  });

  async function submit(value: string): Promise<void> {
    const prompt = value.trim();

    if (!prompt || busy) {
      return;
    }

    setInput("");
    setBusy(true);

    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: prompt,
      },
    ]);

    try {
      const resolvedModel = model === "auto" ? undefined : model;
      const reply = await askLiTTCode(prompt, resolvedModel);

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: reply,
        },
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown agent error";

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "tool",
          content: `Error: ${message}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box
        borderStyle="round"
        paddingX={1}
        justifyContent="space-between"
      >
        <Text bold>⚡ LiTT Code</Text>

        <Text dimColor>
          {model} · {mode.toUpperCase()}
        </Text>
      </Box>

      <Box flexDirection="column" paddingX={1} minHeight={10}>
        {messages.slice(-20).map((message) => (
          <Box key={message.id} marginBottom={1}>
            <Text
              bold
              color={
                message.role === "user"
                  ? "cyan"
                  : message.role === "tool"
                    ? "yellow"
                    : "green"
              }
            >
              {message.role === "user"
                ? "You › "
                : message.role === "tool"
                  ? "Tool › "
                  : "LiTT › "}
            </Text>

            <Text>{message.content}</Text>
          </Box>
        ))}

        {busy && (
          <Text>
            <Spinner type="dots" /> LiTT is working…
          </Text>
        )}
      </Box>

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
        <Text dimColor>
          {cwd}
        </Text>

        <Text dimColor>
          Ctrl+C cancel · /help · @file · !command
        </Text>
      </Box>
    </Box>
  );
}
