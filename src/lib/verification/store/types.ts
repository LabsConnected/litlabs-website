/**
 * LiTT Verification Foundation — store port (interface).
 *
 * The store is the persistence boundary. Implementations:
 * - InMemoryVerificationStore (tests, deterministic)
 * - SupabaseVerificationStore (production; maps 1:1 to the verification_*
 *   tables and emits lifecycle events through action_events)
 *
 * The store enforces the write-time contracts: redaction BEFORE persistence,
 * schema-invalid evidence => quarantine + event (never silent).
 */
import type {
  ArtifactRecord,
  AssertionResult,
  CheckDefinition,
  EvidenceIntegrity,
  EvidenceRecord,
  EvidenceSource,
  EvidenceType,
  FailureRecord,
  PlanVerdict,
  PolicySnapshot,
  QuarantineRecord,
  Verdict,
} from "../types";

export interface CreatePlanInput {
  actionRunId: string;
  missionRunId?: string | null;
  userId: string;
  name: string;
}

export interface AddCheckInput {
  planId: string;
  actionRunId: string;
  userId: string;
  key: string;
  required?: boolean;
  blockedBy?: string | null;
  requiresMutation?: boolean;
  maxEvidenceAgeMs?: number | null;
  narrationSatisfies?: boolean;
}

export interface RecordAttemptInput {
  checkId: string;
  actionRunId: string;
  userId: string;
  executor: string;
  commandIdentity: string;
}

export interface RecordEvidenceInput {
  actionRunId: string;
  checkId?: string | null;
  attemptId?: string | null;
  userId: string;
  evidenceType: EvidenceType;
  source: EvidenceSource;
  claim: string;
  assertions: AssertionResult[];
  payload?: Record<string, unknown>;
  integrity?: EvidenceIntegrity;
  collectedAt?: string;
}

export interface RecordEvidenceResult {
  id: string | null;
  quarantined: boolean;
  quarantineReason?: QuarantineRecord["reason"];
  quarantineId?: string;
}

export interface StoreArtifactInput {
  sha256: string;
  byteSize: number;
  contentType?: string | null;
  storageRef: string;
}

export interface RecordVerdictInput {
  actionRunId: string;
  planId?: string | null;
  checkId?: string | null;
  userId: string;
  verdict: PlanVerdict;
}

export interface RecordFailureInput {
  actionRunId: string;
  attemptId?: string | null;
  checkId?: string | null;
  userId: string;
  code: string;
  message: string;
}

export interface AttemptRecord {
  id: string;
  checkId: string;
  actionRunId: string;
  executor: string;
  commandIdentity: string;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
}

export interface PlanRecord {
  id: string;
  actionRunId: string;
  missionRunId: string | null;
  userId: string;
  name: string;
  status: string;
}

export interface VerdictRecord {
  id: string;
  actionRunId: string;
  planId: string | null;
  checkId: string | null;
  verdict: Verdict;
  decidedAt: string;
  rationale: Record<string, unknown>;
  evidenceIds: string[];
}

/** Full reloaded plan state. Implementations MUST deep-clone on read. */
export interface PlanState {
  plan: PlanRecord;
  checks: CheckDefinition[];
  attempts: AttemptRecord[];
  evidence: EvidenceRecord[];
  artifacts: ArtifactRecord[];
  artifactLinks: Array<{ evidenceId: string; artifactId: string }>;
  verdicts: VerdictRecord[];
  failures: FailureRecord[];
  quarantine: QuarantineRecord[];
  policy: PolicySnapshot | null;
}

export interface EmittedEvent {
  sequence: number;
  runId: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface VerificationStore {
  createPlan(input: CreatePlanInput): Promise<PlanRecord>;
  addCheck(input: AddCheckInput): Promise<CheckDefinition>;
  setCheckSkip(
    checkId: string,
    skipped: boolean,
    skipReason: string | null,
  ): Promise<void>;
  recordAttempt(input: RecordAttemptInput): Promise<AttemptRecord>;
  finishAttempt(attemptId: string, exitCode: number | null): Promise<void>;
  recordEvidence(input: RecordEvidenceInput): Promise<RecordEvidenceResult>;
  storeArtifact(input: StoreArtifactInput): Promise<ArtifactRecord>;
  linkArtifact(evidenceId: string, artifactId: string): Promise<void>;
  recordVerdict(input: RecordVerdictInput): Promise<VerdictRecord>;
  recordFailure(input: RecordFailureInput): Promise<FailureRecord>;
  snapshotPolicy(
    planId: string,
    actionRunId: string,
    userId: string,
    policy: PolicySnapshot,
  ): Promise<string>;
  /** Emit a verification lifecycle event through the run's event spine. */
  emitEvent(
    actionRunId: string,
    userId: string,
    type: string,
    payload?: Record<string, unknown>,
  ): Promise<void>;
  /** Reload full plan state (deep-cloned — no shared references). */
  getPlanState(planId: string): Promise<PlanState>;
}
