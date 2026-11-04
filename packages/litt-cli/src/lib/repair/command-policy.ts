import type { RepairCommand, RepairJob } from "./contracts.js";

export interface CommandPolicy {
  isAllowed(command: RepairCommand): boolean;
  keys: ReadonlySet<string>;
}

export function createCommandPolicy(job: RepairJob): CommandPolicy {
  const commands = [
    job.reproduction.command,
    job.regression.command,
    ...job.checks.map((check) => check.command),
  ];
  const keys = new Set(commands.map(commandKey));
  return {
    keys,
    isAllowed: (command) => keys.has(commandKey(command)),
  };
}

export function commandKey(command: RepairCommand): string {
  return JSON.stringify({
    command: command.command.toLowerCase(),
    args: command.args,
    timeoutMs: command.timeoutMs,
    maxOutputBytes: command.maxOutputBytes,
  });
}
