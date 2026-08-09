# Provider & BYOK (Bring Your Own Key)

## Overview

LiTTree supports multiple AI providers. Users can use LiTTree-managed keys or bring their own. Provider health is tracked truthfully.

## Provider model

```ts
interface Provider {
  id: string;              // "openai", "anthropic", "google", "groq", "together"
  name: string;            // "OpenAI", "Anthropic"
  models: Model[];
  supportsBYOK: boolean;
  managed: boolean;        // LiTTree provides a key
}

interface Model {
  id: string;              // "gpt-4o", "claude-3-5-sonnet"
  name: string;            // "GPT-4o"
  provider: string;
  contextWindow: number;
  capabilities: string[];  // "chat", "vision", "tool_use", "realtime"
  pricing: { input: number; output: number };  // per 1M tokens
}

interface SelectedModel {
  provider: string;
  model: string;
}
```

## Provider health

```ts
type ProviderHealth = "available" | "degraded" | "unavailable" | "locked";

// available   — working normally
// degraded    — working but slow or rate-limited
// unavailable — down or erroring
// locked      — not configured (no key)
```

Health is checked by actual API calls, not assumed. This feeds into the Truth Layer.

## BYOK flow

```
Settings → AI Providers

OpenAI
  [ ] Use my own key
  [ sk-_________________________________ ]
  Status: ● Available

Anthropic
  [✓] Use my own key
  [ sk-ant-_____________________________ ]
  Status: ● Available

Google
  [ ] Use my own key
  Status: ● Locked (no key configured)
```

### Key storage

User keys are stored **encrypted** in the database, never exposed to the client after storage. API calls route through LiTTree backend which decrypts the key server-side.

```sql
CREATE TABLE studio_user_provider_keys (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);
```

### Fallback chain

If a user's BYOK key fails (rate limit, invalid, expired):

1. Try next model in user's preference order
2. If no BYOK keys work, fall back to LiTTree-managed key (if plan allows)
3. If no managed key, report "unavailable" truthfully

## Model selection in Studio

```
Model: GPT-4o ▾

  OpenAI
    ✓ GPT-4o          ● Available
      Claude 3.5 Sonnet  ● Available
      Gemini 2.0 Flash   ● Available
      Llama 3.3 70B      ● Degraded

  My Keys
    OpenAI (sk-...3f2)   ● Available
    Anthropic (sk-...8a1) ● Available
```

## Model routing in LITT CORE

Model selection is part of the canonical state. It persists across surfaces:

```
Web Studio selects GPT-4o
→ VS Code extension uses same model
→ Voice session uses same model (or realtime-compatible fallback)
```

### Realtime voice

Not all models support realtime. If the selected model doesn't support realtime:

```
Selected: Claude 3.5 Sonnet (no realtime support)
Voice session: GPT-4o Realtime (fallback)
Text: Claude 3.5 Sonnet (primary)
```

This is communicated truthfully:

> "Voice is using GPT-4o Realtime. Text responses use Claude 3.5 Sonnet."

## Existing codebase mapping

| Concept | Current |
|---|---|
| Model store | `useStudioModelStore` |
| Provider health | `useStudioModelStore.providerHealth` |
| Model selection | `useStudioModelStore.selectedModel` |
| Fallback | `useStudioModelStore.fallbackNotice` |
| Models list | `MODELS` constant |

### What needs to change

1. Add `studio_user_provider_keys` table
2. Add BYOK settings UI
3. Add encrypted key storage / retrieval
4. Update model routing to check BYOK keys first
5. Add fallback chain logic
6. Surface model + provider in build receipts

## Pricing transparency

Show cost per run in the build receipt:

```
LiTT BUILD RECEIPT
──────────────────
Model: GPT-4o
Tokens: 4,200 in / 1,800 out
Cost: $0.03
```

This builds trust and helps users understand BYOK value.
