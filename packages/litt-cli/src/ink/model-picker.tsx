/**
 * ModelPicker — Ink model selector.
 *
 * Shows available models grouped by provider. User navigates with
 * arrow keys and selects with Enter. Esc cancels.
 *
 * The selected model is passed back via onSelect. The picker does
 * NOT execute anything — it only captures user intent.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";

export interface ModelOption {
  id: string;
  label: string;
  provider: string;
}

export interface ModelPickerProps {
  models: ModelOption[];
  activeModelId: string | null;
  onSelect: (model: ModelOption) => void;
  onCancel: () => void;
}

export function ModelPicker({ models, activeModelId, onSelect, onCancel }: ModelPickerProps): React.ReactElement {
  const { exit } = useApp();
  const [selectedIdx, setSelectedIdx] = useState(() => {
    const activeIdx = models.findIndex(m => m.id === activeModelId);
    return activeIdx >= 0 ? activeIdx : 0;
  });

  useInput(useCallback((_, key) => {
    if (key.upArrow) {
      setSelectedIdx(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIdx(prev => Math.min(models.length - 1, prev + 1));
    } else if (key.return) {
      onSelect(models[selectedIdx]);
    } else if (key.escape) {
      onCancel();
    }
  }, [models, selectedIdx, onSelect, onCancel, exit]));

  // Group models by provider
  const providers = [...new Set(models.map(m => m.provider))];
  let flatIdx = 0;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">SELECT MODEL</Text>
      </Box>
      {providers.map(provider => (
        <Box key={provider} flexDirection="column">
          <Text dimColor bold>{provider}</Text>
          {models.filter(m => m.provider === provider).map(model => {
            const idx = flatIdx++;
            const isSelected = idx === selectedIdx;
            const isActive = model.id === activeModelId;
            return (
              <Box key={model.id}>
                <Text color={isSelected ? "magenta" : undefined}>
                  {isSelected ? ">" : " "}
                </Text>
                <Text color={isSelected ? "magenta" : "white"} bold={isSelected}>
                  {" "}{model.label}
                </Text>
                {isActive && <Text color="green"> ✓ ACTIVE</Text>}
              </Box>
            );
          })}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter select · Esc cancel</Text>
      </Box>
    </Box>
  );
}

/**
 * Default model catalog — models available through OpenRouter.
 * In production, this could be fetched from the OpenRouter API.
 */
export const DEFAULT_MODELS: ModelOption[] = [
  { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", provider: "Anthropic" },
  { id: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6", provider: "Anthropic" },
  { id: "openai/gpt-5.6", label: "GPT-5.6", provider: "OpenAI" },
  { id: "openai/gpt-5.6-codex", label: "GPT-5.6 Codex", provider: "OpenAI" },
  { id: "google/gemini-3-pro", label: "Gemini 3 Pro", provider: "Google" },
  { id: "qwen/qwen3-coder", label: "Qwen3-Coder", provider: "Local" },
  { id: "openrouter/auto", label: "Auto (LiTT routes)", provider: "Local" },
];
