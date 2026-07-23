export type BuilderBlock =
  | {
      id: string;
      type: "message";
      role: "user" | "assistant";
      content: string;
      createdAt?: number;
    }
  | {
      id: string;
      type: "terminal";
      command?: string;
      output?: string;
      status: "queued" | "running" | "success" | "failed" | "disconnected";
      exitCode?: number;
      durationMs?: number;
      startedBy: "user" | "litt";
    };

export type TerminalBuilderBlock = Extract<BuilderBlock, { type: "terminal" }>;
