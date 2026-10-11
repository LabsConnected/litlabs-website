import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  classifyTerminalCommand,
  setTerminalCommandPolicy,
  resetTerminalCommandPolicy,
  splitCompoundCommands,
  type TerminalCommandRisk,
} from "@/lib/litt-intelligence/terminal-command-policy";
import {
  PermissionEngine,
  type ExecutionMode,
  type ToolPermissionInfo,
} from "@/lib/litt-intelligence/permission-engine";
import { handleTerminalExecute } from "@/lib/litt-intelligence/tool-handlers-v2";

const TERMINAL_TOOL: ToolPermissionInfo = {
  toolId: "terminal.execute",
  permissionLevel: "workspace-write",
  isReadOnly: false,
  isMutation: true,
  enabled: true,
};

function perm(command: string, mode: ExecutionMode) {
  return new PermissionEngine().check(TERMINAL_TOOL, { command }, mode);
}

describe("classifyTerminalCommand", () => {
  beforeEach(() => {
    resetTerminalCommandPolicy();
  });

  it.each([
    "ls -la",
    "pwd",
    "whoami",
    "echo hello",
    "cat README.md",
    "head -n 20 file.txt",
    "tail -f /tmp/x.log",
    "wc -l src/index.ts",
    "grep -r foo src/",
    "find . -name '*.ts'",
    "tree src",
    "file package.json",
    "stat package.json",
    "git status",
    "git diff --stat",
    "git log --oneline",
    "git show HEAD",
    "git branch -a",
    "git remote -v",
    "git stash list",
    "tsc --noEmit",
    "eslint src/",
    "npm test",
    "npm t",
    "npm lint",
    "npx tsc --noEmit",
    "vitest run src/",
    "node --version",
    "git --version",
  ])("safe: %s", (command) => {
    expect(classifyTerminalCommand(command)).toBe("safe");
  });

  it.each([
    "git commit -m 'x'",
    "git push",
    "git add .",
    "git checkout -b feature",
    "npm install",
    "npm ci",
    "mkdir foo",
    "touch a.txt",
    "cp a b",
    "mv a b",
    "rm foo.txt",
    "curl https://example.com",
    "wget https://example.com/x.tgz",
    "npx create-next-app",
    "rm -rf ./build", // recursive but workspace-scoped — risky, not deny
    "chmod 755 ./scripts/*.sh",
    "echo secret-token | tee /tmp/x",
  ])("risky: %s", (command) => {
    expect(classifyTerminalCommand(command)).toBe("risky");
  });

  it.each([
    "rm -rf /",
    "rm -rf /*",
    "rm -rf ~",
    "rm -rf $HOME",
    "sudo rm -rf /",
    "mkfs.ext4 /dev/sda1",
    "dd if=/dev/zero of=/dev/sda bs=1M",
    ":(){ :|:& };:",
    "shutdown -h now",
    "reboot",
    "poweroff",
    "chmod -R 777 /",
  ])("deny: %s", (command) => {
    expect(classifyTerminalCommand(command)).toBe("deny");
  });

  it("classifies compound commands at max severity", () => {
    expect(classifyTerminalCommand("git status && ls")).toBe("safe");
    expect(classifyTerminalCommand("git status; pwd")).toBe("safe");
    expect(classifyTerminalCommand("ls\ncat README.md")).toBe("safe");
    expect(classifyTerminalCommand("ls && git commit -m 'x'")).toBe("risky");
    expect(classifyTerminalCommand("git status || npm install")).toBe("risky");
    expect(classifyTerminalCommand("git status && rm -rf /")).toBe("deny");
    expect(classifyTerminalCommand("ls | rm -rf /*")).toBe("deny");
  });

  it("does not split on operators inside quotes", () => {
    expect(classifyTerminalCommand('echo "a && b"')).toBe("safe");
    expect(splitCompoundCommands('echo "a && b"')).toEqual(['echo "a && b"']);
  });

  it("is fail-closed: even a quoted destructive primitive is denied", () => {
    expect(classifyTerminalCommand("echo 'a; rm -rf /'")).toBe("deny");
  });

  it("strips sudo prefixes before classifying the inner command", () => {
    expect(classifyTerminalCommand("sudo git status")).toBe("safe");
    expect(classifyTerminalCommand("sudo -n ls -la")).toBe("safe");
    expect(classifyTerminalCommand("sudo npm install")).toBe("risky");
    expect(classifyTerminalCommand("sudo rm -rf /")).toBe("deny");
  });

  it("treats empty/non-string input as risky (never auto-run)", () => {
    expect(classifyTerminalCommand("")).toBe("risky");
    expect(classifyTerminalCommand("   ")).toBe("risky");
    expect(classifyTerminalCommand(undefined as unknown as string)).toBe("risky");
  });
});

describe("owner overrides", () => {
  beforeEach(() => {
    resetTerminalCommandPolicy();
  });

  it("owner-deny beats built-in safe", () => {
    setTerminalCommandPolicy({ deny: ["git stash"] });
    expect(classifyTerminalCommand("git stash")).toBe("deny");
    expect(classifyTerminalCommand("git stash list")).toBe("deny");
    expect(classifyTerminalCommand("git status")).toBe("safe");
  });

  it("owner-allow beats built-in risky", () => {
    setTerminalCommandPolicy({ allow: ["git checkout"] });
    expect(classifyTerminalCommand("git checkout main")).toBe("safe");
    expect(classifyTerminalCommand("npm install")).toBe("risky");
  });

  it("owner-deny beats owner-allow", () => {
    setTerminalCommandPolicy({ allow: ["git stash"], deny: ["stash"] });
    expect(classifyTerminalCommand("git stash")).toBe("deny");
  });

  it("seeds from LITT_TERMINAL_ALLOW / LITT_TERMINAL_DENY env vars", () => {
    process.env.LITT_TERMINAL_ALLOW = "git stash, git checkout";
    process.env.LITT_TERMINAL_DENY = "npx create";
    resetTerminalCommandPolicy();
    try {
      expect(classifyTerminalCommand("git stash")).toBe("safe");
      expect(classifyTerminalCommand("npx create-next-app")).toBe("deny");
    } finally {
      delete process.env.LITT_TERMINAL_ALLOW;
      delete process.env.LITT_TERMINAL_DENY;
      resetTerminalCommandPolicy();
    }
  });

  it("reset clears programmatic overrides", () => {
    setTerminalCommandPolicy({ deny: ["git status"] });
    expect(classifyTerminalCommand("git status")).toBe("deny");
    resetTerminalCommandPolicy();
    expect(classifyTerminalCommand("git status")).toBe("safe");
  });
});

describe("permission engine — terminal.execute", () => {
  beforeEach(() => {
    resetTerminalCommandPolicy();
  });

  const matrix: Array<{
    command: string;
    risk: TerminalCommandRisk;
    expectations: Record<ExecutionMode, { allowed: boolean; requiresApproval: boolean }>;
  }> = [
    {
      command: "git status",
      risk: "safe",
      expectations: {
        plan: { allowed: true, requiresApproval: false },
        act: { allowed: true, requiresApproval: false },
        auto: { allowed: true, requiresApproval: false },
      },
    },
    {
      command: "git commit -m 'x'",
      risk: "risky",
      expectations: {
        plan: { allowed: false, requiresApproval: false },
        act: { allowed: true, requiresApproval: true },
        auto: { allowed: true, requiresApproval: true },
      },
    },
    {
      command: "rm -rf /",
      risk: "deny",
      expectations: {
        plan: { allowed: false, requiresApproval: false },
        act: { allowed: false, requiresApproval: false },
        auto: { allowed: false, requiresApproval: false },
      },
    },
  ];

  it.each(matrix.map((m) => [m.command, m.risk, m.expectations] as const))(
    "%s (%s)",
    (command, _risk, expectations) => {
      for (const mode of ["plan", "act", "auto"] as const) {
        const result = perm(command, mode);
        expect(result.allowed, `${command} in ${mode}: allowed`).toBe(
          expectations[mode].allowed,
        );
        expect(result.requiresApproval, `${command} in ${mode}: requiresApproval`).toBe(
          expectations[mode].requiresApproval,
        );
      }
    },
  );

  it("risky gives an approval reason, deny gives a refusal reason", () => {
    const risky = perm("npm install", "act");
    expect(risky.reason).toBe("Terminal mutation requires approval");
    const deny = perm("rm -rf /", "act");
    expect(deny.reason).toMatch(/blocked by terminal command policy/i);
    // Refusal reasons stay generic — never echo the command text.
    expect(deny.reason).not.toContain("rm -rf /");
  });

  it("disabled tool is refused before classification", () => {
    const engine = new PermissionEngine();
    const result = engine.check(
      { ...TERMINAL_TOOL, enabled: false },
      { command: "ls" },
      "act",
    );
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(false);
    expect(result.reason).toContain("disabled");
  });

  it("missing capability refuses before classification", () => {
    const engine = new PermissionEngine();
    const result = engine.check(
      { ...TERMINAL_TOOL, requiredCapabilities: ["terminal:live"] },
      { command: "ls" },
      "act",
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("terminal:live");
  });
});

describe("execution path — permission gate + existing handler", () => {
  beforeEach(() => {
    resetTerminalCommandPolicy();
  });

  function makeTransport() {
    return {
      exec: vi
        .fn()
        .mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" }),
    };
  }

  /** The agent-loop decision path: permission engine gate, then the EXISTING
   * handleTerminalExecute → transport.exec. No new execution path. */
  async function gatedExecute(
    command: string,
    mode: ExecutionMode,
    transport: ReturnType<typeof makeTransport>,
  ) {
    const permResult = new PermissionEngine().check(
      TERMINAL_TOOL,
      { command },
      mode,
    );
    if (!permResult.allowed) {
      return { executed: false, requiresApproval: permResult.requiresApproval };
    }
    const result = await handleTerminalExecute(
      { command, projectId: "p1" },
      transport as never,
    );
    return { executed: true, requiresApproval: permResult.requiresApproval, result };
  }

  it("safe command reaches the existing handler", async () => {
    const transport = makeTransport();
    const outcome = await gatedExecute("git status", "auto", transport);
    expect(outcome.executed).toBe(true);
    expect(outcome.requiresApproval).toBe(false);
    expect(transport.exec).toHaveBeenCalledWith("git status", 30_000);
  });

  it("deny command never reaches the handler, in every mode", async () => {
    for (const mode of ["plan", "act", "auto"] as const) {
      const transport = makeTransport();
      const outcome = await gatedExecute("rm -rf /", mode, transport);
      expect(outcome.executed).toBe(false);
      expect(transport.exec).not.toHaveBeenCalled();
    }
  });

  it("risky command reaches the handler only through the approval path", async () => {
    // PLAN mode blocks it outright.
    const blocked = makeTransport();
    expect((await gatedExecute("npm install", "plan", blocked)).executed).toBe(false);
    expect(blocked.exec).not.toHaveBeenCalled();

    // ACT mode flags requiresApproval — the handler runs once approval is granted.
    const approved = makeTransport();
    const outcome = await gatedExecute("npm install", "act", approved);
    expect(outcome.executed).toBe(true);
    expect(outcome.requiresApproval).toBe(true);
    expect(approved.exec).toHaveBeenCalledWith("npm install", 30_000);
  });
});
