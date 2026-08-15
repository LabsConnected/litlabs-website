/**
 * Signal handler — canonical Ctrl+C semantics for the LiTT CLI.
 *
 *   First Ctrl+C while a run is active  →  send cancellation, CLI stays alive
 *   Second Ctrl+C while idle             →  exit normally
 *   Ctrl+C while idle (first press)      →  exit normally
 *
 * The CLI never exits on the first Ctrl+C if there's an active run.
 * It sends a cancel request to terminal-server and waits for the
 * run.completed event with status=cancelled.
 */

import { RuntimeClient } from "./runtime-client.js";
import { c } from "./utils.js";

export class SignalHandler {
  private client: RuntimeClient;
  private cancelInFlight = false;
  private lastSigintTime = 0;
  private readonly doublePressMs = 2000;

  constructor(client: RuntimeClient) {
    this.client = client;
  }

  /**
   * Install the signal handler. Returns a cleanup function.
   */
  install(): () => void {
    const handler = (sig: string) => this.handleSignal(sig);
    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
    return () => {
      process.removeListener("SIGINT", handler);
      process.removeListener("SIGTERM", handler);
    };
  }

  private async handleSignal(sig: string): Promise<void> {
    if (sig === "SIGTERM") {
      // SIGTERM = always exit
      process.exit(143);
      return;
    }

    // SIGINT (Ctrl+C)
    const now = Date.now();
    const hasActiveRun = this.client.hasActiveRun();

    if (hasActiveRun && !this.cancelInFlight) {
      // First Ctrl+C with an active run → cancel
      this.cancelInFlight = true;
      console.log(`\n${c.yellow}!${c.reset} Cancelling active run...`);

      const runId = this.client.getCurrentRunId();
      const cancelled = await this.client.cancelActiveRun();

      if (cancelled) {
        console.log(`${c.yellow}⊘${c.reset} Cancel request sent for run ${runId?.slice(-8)}`);
      } else {
        console.log(`${c.red}✗${c.reset} Cancel request failed — run may continue on server`);
      }

      // Reset cancelInFlight after a delay to allow re-cancellation
      setTimeout(() => { this.cancelInFlight = false; }, 3000);
      return;
    }

    // No active run, or cancel already in flight
    if (this.cancelInFlight) {
      // Second Ctrl+C while waiting for cancellation → force exit
      console.log(`\n${c.red}!${c.reset} Force exit`);
      process.exit(130);
      return;
    }

    // No active run — check for double press
    if (now - this.lastSigintTime < this.doublePressMs) {
      // Double press while idle → exit
      process.exit(130);
      return;
    }

    // First press while idle → show hint and wait
    this.lastSigintTime = now;
    console.log(`\n${c.gray}Press Ctrl+C again to exit${c.reset}`);
  }
}
