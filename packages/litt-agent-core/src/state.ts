/**
 * Runtime state and event system.
 *
 * One canonical runtime truth. PowerShell and web will eventually
 * consume this same state instead of maintaining their own.
 */

import type {
  RuntimePhase,
  RuntimeState,
  RuntimeEvent,
  RuntimeEventEmitter,
  ProjectContext,
} from "./types.js";

export function createInitialState(): RuntimeState {
  return {
    phase: "idle",
    project: null,
    branch: null,
    model: null,
    profile: null,
    gitChanges: 0,
    online: false,
    pingMs: -1,
    contextTokens: 0,
  };
}

export class RuntimeStore {
  private state: RuntimeState;
  private emitter: RuntimeEventEmitter | null;

  constructor(emitter?: RuntimeEventEmitter) {
    this.state = createInitialState();
    this.emitter = emitter ?? null;
  }

  getState(): RuntimeState {
    return { ...this.state };
  }

  setPhase(phase: RuntimePhase): void {
    const prev = this.state.phase;
    this.state.phase = phase;
    if (prev !== phase) {
      this.emit({
        type: "phase_change",
        ts: Date.now(),
        data: { from: prev, to: phase },
      });
    }
  }

  setProject(project: ProjectContext | null): void {
    this.state.project = project;
    this.state.branch = project?.branch ?? null;
  }

  setModel(model: string | null, profile: string | null): void {
    this.state.model = model;
    this.state.profile = profile;
  }

  setGitChanges(count: number): void {
    this.state.gitChanges = count;
  }

  setOnline(online: boolean, pingMs: number): void {
    this.state.online = online;
    this.state.pingMs = pingMs;
  }

  setContextTokens(tokens: number): void {
    this.state.contextTokens = tokens;
  }

  private emit(event: RuntimeEvent): void {
    if (this.emitter) {
      try {
        this.emitter(event);
      } catch {
        // emitter must never crash the runtime
      }
    }
  }
}
