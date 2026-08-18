/**
 * LiTT Desktop operator bridge.
 *
 * Desktop
 *   -> authenticated litt:chat
 *   -> terminal-server
 *   -> runAgentLoop
 *   -> native OpenRouter tool selection
 *   -> ExecutionGateway
 *   -> ToolRegistry / CommandExecutor
 *   -> real project
 *
 * No second execution authority is introduced.
 */

import path from "path";

import {
  runAgentLoop,
  type ChatMessage,
  type ModelProvider,
  type ModelResult,
  type ModelStreamEvent,
  type ToolDefinition,
} from "@litt/agent-core";

import {
  streamLiTTMessagesWithTools,
  health as littModelHealth,
  type LiTTEvent,
  type LiTTResult,
  type LiTTNativeTool,
} from "./litt-code";

import {
  getRuntimeStore,
  getExecutionGateway,
  getCanonicalToolRegistry,
  getCanonicalShell,
} from "./runtime";


class SharedLiTTModelProvider implements ModelProvider {
  lastResult: LiTTResult | null = null;

  private readonly nativeTools: LiTTNativeTool[];

  constructor(toolDefinitions: ToolDefinition[]) {
    const usedNames = new Set<string>();

    this.nativeTools =
      toolDefinitions.map((tool) => {
        const baseName =
          tool.id
            .replace(
              /[^a-zA-Z0-9_-]/g,
              "_",
            )
            .slice(0, 60) ||
          "litt_tool";

        let functionName = baseName;
        let suffix = 2;

        while (usedNames.has(functionName)) {
          functionName =
            `${baseName}_${suffix++}`;
        }

        usedNames.add(functionName);

        return {
          toolId: tool.id,
          functionName,
          description: tool.description,
          parameters: tool.inputSchema,
        };
      });
  }

  async stream(
    messages: ChatMessage[],
    emit: (event: ModelStreamEvent) => void,
  ): Promise<ModelResult> {
    const result =
      await streamLiTTMessagesWithTools(
        messages,
        this.nativeTools,
        (event: LiTTEvent) => {
          emit(event);
        },
      );

    this.lastResult = result;

    return result;
  }

  async health(): Promise<number> {
    const latency =
      await littModelHealth();

    return latency >= 0 ? 1 : 0;
  }
}


/**
 * Run one authenticated Desktop operator turn.
 *
 * Read-only tools can execute immediately.
 * Mutating/elevated work remains governed by ExecutionGateway.
 * With no Desktop approval callback configured yet, actions requiring
 * approval fail closed.
 */
export async function streamLiTTOperator(
  prompt: string,
  cwd: string,
  emit: (event: LiTTEvent) => void,
): Promise<void> {
  const projectRoot =
    path.resolve(cwd);

  // Use canonical singletons from runtime.ts — never create a second
  // RuntimeStore or ExecutionGateway in the same terminal-server process.
  // Both the terminal:input path (runLiTTOperator) and the Desktop
  // litt:chat path (streamLiTTOperator) must share one store, one
  // gateway, one tool registry so mission state, event projection,
  // and runtime truth remain consistent.
  const store =
    getRuntimeStore();

  const gateway =
    getExecutionGateway(projectRoot, "act");

  const tools =
    getCanonicalToolRegistry(projectRoot);

  const shell =
    getCanonicalShell(projectRoot);

  const model =
    new SharedLiTTModelProvider(
      tools.list(),
    );

  try {
    const result =
      await runAgentLoop(
        prompt,
        {
          model,
          tools,
          shell,
          gateway,
          cwd: projectRoot,
          userId: "desktop-local",
          mode: "act",
          maxRounds: 12,

          projectContext: {
            name:
              path.basename(
                projectRoot,
              ),
            root: projectRoot,
            branch: null,
          },

          store,
        },
      );

    const providerResult =
      model.lastResult;

    if (!providerResult) {
      emit({
        type: "error",
        message:
          result.content ||
          "LiTT operator ended without a model result.",
      });

      return;
    }

    emit({
      type: "meta",
      provider:
        providerResult.provider,
      model:
        providerResult.model,
      profile:
        providerResult.profile,
    });

    if (result.content) {
      emit({
        type: "delta",
        text: result.content,
      });
    }

    emit({
      type: "done",
      model:
        providerResult.model,
      usage:
        result.usage,
      timing:
        providerResult.timing,
    });
  } catch (error) {
    emit({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
}