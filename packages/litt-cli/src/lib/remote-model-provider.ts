/**
 * RemoteModelProvider — the authenticated, server-executed ModelProvider
 * for the interactive cockpit's REMOTE transport.
 *
 * This is the direct counterpart to OpenRouterModelProvider
 * (model-provider.ts): same ModelProvider interface, same native
 * tool_calls accumulation → `tool_call` fence-block translation, same
 * OpenAI-safe tool-name sanitization (openai-tool-names.js) — but the
 * actual HTTP request happens on terminal-server, never in this
 * process. The CLI never reads, requires, or transmits provider API
 * keys when this adapter is used.
 *
 *   RemoteModelProvider.stream()
 *     → RuntimeClient.streamModel()  (authenticated Socket.IO channel)
 *     → terminal-server: billing.ts authorize() + streamModelForRemoteClient()
 *     → server selects transport: direct OpenAI (api.openai.com) OR
 *       OpenRouter fallback (openrouter.ai), based on which managed
 *       credentials are available
 *     → relayed delta/tool_call_chunk/done/error events back to the CLI
 *
 * The server reports the ACTUAL provider in the meta event. This
 * provider is never hardcoded — it reflects the real transport that
 * served the request. The CLI displays it truthfully.
 *
 * Tool EXECUTION still happens locally — this adapter only ever returns
 * model text + `tool_call` fence blocks; the caller's existing agent
 * loop (unchanged) dispatches those through the CLI's own local
 * ExecutionGateway against the user's real local project, exactly as
 * in local-provider mode.
 */

import type {
  ChatMessage,
  ModelProvider,
  ModelResult,
  ModelStreamEvent,
  ModelProfile,
  ToolDefinition,
} from "@litt/agent-core";
import {
  type NativeToolSchema,
  type OpenAiToolNameMap,
  toOpenAiToolSchemas,
  resolveCanonicalToolId,
} from "./openai-tool-names.js";
import type { RuntimeClient, RemoteModelStreamEvent, RemoteChatMessage } from "./runtime-client.js";

export interface RemoteModelProviderOptions {
  /** Already-connected RuntimeClient. streamModel() throws if it is not. */
  client: RuntimeClient;
  /** The provider-native model id (e.g. "gpt-5.6-luna") for direct
   *  transport, or the OpenRouter slug if no native id exists. */
  model: string;
  /** Provider the CLI routed to ("openai", "openrouter", etc.). */
  providerHint?: string;
  /** OpenRouter fallback slug, used if server falls back to OpenRouter. */
  openRouterModelId?: string;
  profile?: ModelProfile;
  maxTokens?: number;
  tools?: ToolDefinition[];
}

/**
 * Thrown when the remote transport itself is unavailable or the request
 * fails — NEVER caught-and-silently-retried with a local provider. The
 * caller (ink/controller.ts) surfaces this as an explicit remote error.
 */
export class RemoteExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteExecutionError";
  }
}

export class RemoteModelProvider implements ModelProvider {
  /**
   * The provider that ACTUALLY served the most recent request, as
   * reported by the server's meta event. Starts as the providerHint
   * (the CLI's routing decision) and is updated to the server's
   * truthful report once the meta event arrives. Never hardcoded to
   * "openrouter" — reflects the real transport.
   */
  providerId: string;
  private readonly _client: RuntimeClient;
  private readonly _model: string;
  private readonly _providerHint: string | undefined;
  private readonly _openRouterModelId: string | undefined;
  private readonly _profile: ModelProfile;
  private readonly _maxTokens: number | undefined;
  private readonly _tools: NativeToolSchema[] | null;
  private readonly _toolNameMap: OpenAiToolNameMap | null;
  private _activeModel: string | null = null;
  /** The requestId of the currently in-flight (or most recent) stream() call. */
  private _currentRequestId: string | null = null;

  constructor(options: RemoteModelProviderOptions) {
    this._client = options.client;
    this._model = options.model;
    this._providerHint = options.providerHint;
    this._openRouterModelId = options.openRouterModelId;
    this._profile = options.profile ?? "smart";
    this._maxTokens = options.maxTokens;
    // Initial providerId is the CLI's routing hint — updated to the
    // server's truthful report once the meta event arrives.
    this.providerId = options.providerHint ?? "openrouter";
    if (options.tools && options.tools.length > 0) {
      const { schemas, map } = toOpenAiToolSchemas(options.tools);
      this._tools = schemas;
      this._toolNameMap = map;
    } else {
      this._tools = null;
      this._toolNameMap = null;
    }
  }

  get configuredModel(): string {
    return this._model;
  }

  get activeModel(): string | null {
    return this._activeModel;
  }

  get profile(): ModelProfile {
    return this._profile;
  }

  async stream(
    messages: ChatMessage[],
    emit: (event: ModelStreamEvent) => void,
  ): Promise<ModelResult> {
    const requestId = `remote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this._currentRequestId = requestId;
    const remoteMessages: RemoteChatMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));

    let content = "";
    let resolvedModel = this._model;
    let resolvedProvider = this.providerId;
    const nativeToolCalls: Array<{ name: string; args: string }> = [];

    const handleEvent = (event: RemoteModelStreamEvent): void => {
      switch (event.type) {
        case "meta":
          // Server reports the ACTUAL provider — update our truthful state.
          resolvedProvider = event.provider;
          this.providerId = event.provider;
          emit({ type: "meta", provider: event.provider, model: event.model, profile: this._profile });
          break;
        case "delta":
          content += event.text;
          emit({ type: "delta", text: event.text });
          break;
        case "tool_call_chunk":
          nativeToolCalls[event.index] ??= { name: "", args: "" };
          if (event.name) nativeToolCalls[event.index].name = event.name;
          if (event.argsChunk) nativeToolCalls[event.index].args += event.argsChunk;
          break;
        case "done":
          resolvedModel = event.model;
          emit({ type: "done", model: event.model, usage: { total_tokens: event.usage.total_tokens }, timing: event.timing });
          break;
        case "error":
          // Surfaced by the streamModel() promise rejection — nothing to
          // emit here (agent-core's ModelStreamEvent has no "error" case
          // distinct from throwing).
          break;
      }
    };

    let result: { provider: string; model: string; usage: { total_tokens: number } };
    try {
      result = await this._client.streamModel(
        requestId,
        this._model,
        remoteMessages,
        this._tools ?? [],
        handleEvent,
        {
          maxTokens: this._maxTokens,
          providerHint: this._providerHint,
          openRouterModelId: this._openRouterModelId,
        },
      );
    } catch (err) {
      // Never fall back to a local provider — surface a distinct,
      // explicit remote-execution error instead.
      throw new RemoteExecutionError(err instanceof Error ? err.message : String(err));
    }

    // Native tool_calls → internal fence format — identical translation
    // to OpenRouterModelProvider.streamOnce() so the agent loop's single
    // parser handles both transports the same way.
    const nativeBlocks = nativeToolCalls
      .filter((tc) => tc.name)
      .map((tc) => {
        let inputs: unknown = {};
        if (tc.args) {
          try {
            inputs = JSON.parse(tc.args);
          } catch {
            inputs = {};
          }
        }
        const canonicalToolId = resolveCanonicalToolId(tc.name, this._toolNameMap);
        return `\`\`\`tool_call\n${JSON.stringify({ tool: canonicalToolId, inputs }, null, 2)}\n\`\`\``;
      })
      .join("\n");
    if (nativeBlocks) {
      content = content ? `${content}\n${nativeBlocks}` : nativeBlocks;
    }

    this._activeModel = resolvedModel;

    return {
      content,
      model: resolvedModel,
      provider: resolvedProvider,
      usage: { total_tokens: result.usage.total_tokens },
      timing: { ttftMs: 0, generationMs: 0, totalMs: 0 },
      profile: this._profile,
    };
  }

  async health(): Promise<number> {
    return this._client.is_connected() ? 1 : 0;
  }

  /** Cancel the in-flight (or most recent) stream() call, if any. */
  cancel(): void {
    if (this._currentRequestId) this._client.cancelModelStream(this._currentRequestId);
  }
}
