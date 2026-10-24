import { describe, it, expect } from "vitest";
import {
  evaluateCompletion,
  requirementForMode,
  type ExecutionEvidence,
  type WorkspaceChangeEvidence,
} from "./completion-evidence";

/**
 * A completion verdict may never contradict the workspace.
 *
 * Before this, "nothing was changed" was derived entirely from tool success
 * flags. A tool that wrote bytes and then failed, or a run cancelled after a
 * write landed, produced state "failed" with the literal claim that nothing
 * had changed — while the user's file on disk had been rewritten.
 *
 * The pre-mutation checkpoint already gives a baseline, so the diff against
 * it is the authority. Tool flags describe what the model was TOLD happened;
 * only the diff describes what is actually persisted.
 */

const BUILD = requirementForMode("build");

function evidence(
  toolCalls: ExecutionEvidence["toolCalls"],
  workspaceChange?: WorkspaceChangeEvidence | null,
): ExecutionEvidence {
  return { toolCalls, workspaceChange };
}

const changed = (files: string[] = ["index.html"]): WorkspaceChangeEvidence => ({
  status: "changed",
  files,
  checkpointSha: "abc1234",
  rollbackAvailable: true,
});

const unchanged: WorkspaceChangeEvidence = {
  status: "unchanged",
  files: [],
  checkpointSha: "abc1234",
  rollbackAvailable: true,
};

describe("completion verdict vs. actual workspace state", () => {
  // 1. mutation succeeds, a later step fails → changes reported
  it("reports changes when a mutation landed and a later step failed", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence(
        [
          { toolId: "files.write", mutating: true, success: true },
          { toolId: "project.build", mutating: false, success: false },
        ],
        changed(),
      ),
    );

    // A successful mutation exists, so this is not the no-mutation branch —
    // but the verdict must still never claim the workspace is untouched.
    expect(verdict.reason).not.toContain("nothing was changed");
  });

  // 2. mutation fails before any bytes change → no changes
  it("says the run failed BEFORE making changes when the diff is empty", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence([{ toolId: "files.write", mutating: true, success: false }], unchanged),
    );

    expect(verdict.state).toBe("failed");
    expect(verdict.workspaceChange).toBe("unchanged");
    expect(verdict.reason).toContain("failed before making changes");
  });

  // 3. the headline case: a failed mutation that still wrote bytes
  it("never claims nothing changed when the workspace differs", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence([{ toolId: "files.write", mutating: true, success: false }], changed()),
    );

    expect(verdict.state).toBe("failed");
    expect(verdict.workspaceChange).toBe("changed");
    expect(verdict.reason).not.toContain("nothing was changed");
    expect(verdict.reason).toContain("failed after making changes");
  });

  // 4. partial multi-file mutation
  it("reports partial changes when one file landed and another failed", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence(
        [
          { toolId: "files.write", mutating: true, success: false },
          { toolId: "files.write", mutating: true, success: false },
        ],
        changed(["index.html"]),
      ),
    );

    expect(verdict.workspaceChange).toBe("changed");
    expect(verdict.changedFiles).toEqual(["index.html"]);
    expect(verdict.reason).toContain("index.html");
  });

  it("summarises by count when several files changed", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence(
        [{ toolId: "files.write", mutating: true, success: false }],
        changed(["index.html", "style.css", "app.js"]),
      ),
    );

    expect(verdict.changedFiles).toHaveLength(3);
    expect(verdict.reason).toContain("3 files");
  });

  // 5. cancelled after a mutation landed
  it("reports changes when a run was cancelled after a write", () => {
    const verdict = evaluateCompletion(
      BUILD,
      // Cancellation leaves the call with no result — absence of a result is
      // not success, and not proof the disk is untouched.
      evidence([{ toolId: "files.write", mutating: true, success: undefined }], changed()),
    );

    expect(verdict.workspaceChange).toBe("changed");
    expect(verdict.reason).not.toContain("nothing was changed");
  });

  // 6 & 7. the diff is the authority
  it("checkpoint diff empty → no changes", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence([{ toolId: "files.write", mutating: true, success: false }], unchanged),
    );
    expect(verdict.workspaceChange).toBe("unchanged");
  });

  it("checkpoint diff non-empty → changes reported", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence([{ toolId: "files.write", mutating: true, success: false }], changed()),
    );
    expect(verdict.workspaceChange).toBe("changed");
  });

  // 8. the verdict may never contradict the diff
  it("no verdict contradicts the diff across the evidence matrix", () => {
    const flags: Array<boolean | undefined> = [true, false, undefined];
    for (const success of flags) {
      for (const change of [changed(), unchanged]) {
        const verdict = evaluateCompletion(
          BUILD,
          evidence([{ toolId: "files.write", mutating: true, success }], change),
        );
        if (change.status === "changed") {
          expect(verdict.reason).not.toContain("nothing was changed");
          expect(verdict.reason).not.toContain("before making changes");
          expect(verdict.workspaceChange).toBe("changed");
        } else {
          expect(verdict.workspaceChange).toBe("unchanged");
        }
      }
    }
  });

  // Absence of evidence is not evidence of absence.
  it("does not assert the workspace is untouched when no diff was taken", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence([{ toolId: "files.write", mutating: true, success: false }], null),
    );

    expect(verdict.state).toBe("failed");
    expect(verdict.workspaceChange).toBe("unknown");
    expect(verdict.reason).not.toContain("nothing was changed");
    expect(verdict.reason).not.toContain("before making changes");
  });

  it("carries checkpoint and rollback availability for the UI", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence([{ toolId: "files.write", mutating: true, success: false }], changed()),
    );

    expect(verdict.checkpointSha).toBe("abc1234");
    expect(verdict.rollbackAvailable).toBe(true);
  });

  // No auto-rollback: the changes must survive for the user to inspect.
  it("reports rollback as available without implying it happened", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence([{ toolId: "files.write", mutating: true, success: false }], changed()),
    );

    expect(verdict.rollbackAvailable).toBe(true);
    expect(verdict.reason).not.toMatch(/rolled back|reverted|restored/i);
  });

  it("still reports nothing changed when no mutation was even attempted", () => {
    const verdict = evaluateCompletion(BUILD, evidence([], unchanged));

    expect(verdict.state).toBe("not_started");
    expect(verdict.reason).toContain("nothing was changed");
  });

  // ─── A claimed success is not proof either — PR follow-up to the Studio
  // false-completion remediation. Every test above exercises successfulMutations
  // === 0 (every mutating call has success: false/undefined); none of them
  // reach the branch below, which is what actually changes here.

  describe("a tool reports success:true/mutating:true — that claim alone is not proof", () => {
    it("is contradicted by a VERIFIED-unchanged diff → failed, not complete", () => {
      // The canonical case: a command exits 0 having printed to stdout and
      // written nothing (no shell to interpret `>` — the exact shape of the
      // bug just fixed in the LiTT CLI's project.run, on a different
      // transport here).
      const verdict = evaluateCompletion(
        BUILD,
        evidence([{ toolId: "files.write", mutating: true, success: true }], unchanged),
      );

      expect(verdict.state).toBe("failed");
      expect(verdict.workspaceChange).toBe("unchanged");
      expect(verdict.reason).toMatch(/reported a successful mutation/i);
      expect(verdict.reason).toMatch(/no changes/i);
    });

    it("is corroborated by a changed diff → complete (the honest-success path still works)", () => {
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [{ toolId: "files.write", mutating: true, success: true, paths: ["index.html"] }],
          changed(["index.html"]),
        ),
      );

      expect(verdict.state).toBe("complete");
      expect(verdict.workspaceChange).toBe("changed");
    });

    it("is neither confirmed nor denied by an UNKNOWN diff → NOT complete (unverifiable is never proof)", () => {
      // Absence of evidence is not evidence of absence — but it is not
      // proof of success either. A generation result whose mutation claim
      // cannot be checked (no checkpoint yet, unreachable workspace,
      // provisioning still settling) stays short of "complete".
      const verdict = evaluateCompletion(
        BUILD,
        evidence([{ toolId: "files.write", mutating: true, success: true }], null),
      );

      expect(verdict.state).toBe("partial");
      expect(verdict.state).not.toBe("complete");
      expect(verdict.workspaceChange).toBe("unknown");
      expect(verdict.missing).toContain("verified workspace change matching the reported mutation");
    });

    it("one of several mutating calls succeeded, diff verified unchanged → still failed", () => {
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [
            { toolId: "files.write", mutating: true, success: false },
            { toolId: "files.write", mutating: true, success: true },
          ],
          unchanged,
        ),
      );

      expect(verdict.state).toBe("failed");
      expect(verdict.missing).toContain("workspace change matching the reported mutation");
    });
  });

  describe("per-mutation persisted evidence (read-back + declared paths)", () => {
    it("a read-back-confirmed write completes even with no usable diff (static/gitless workspace)", () => {
      // Static workspaces can never produce a checkpoint diff — the
      // read-back is their only persisted-change channel.
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [{ toolId: "files.write", mutating: true, success: true, paths: ["index.html"], persisted: true }],
          null,
        ),
      );

      expect(verdict.state).toBe("complete");
      expect(verdict.workspaceChange).toBe("unknown");
    });

    it("a contradicted read-back fails the run even when the diff is unverifiable", () => {
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [{ toolId: "files.write", mutating: true, success: true, paths: ["index.html"], persisted: false }],
          null,
        ),
      );

      expect(verdict.state).toBe("failed");
      expect(verdict.reason).toMatch(/did not find the claimed change/i);
    });

    it("a contradicted read-back vetoes a claim even when unrelated files changed", () => {
      // The workspace did change — just not what the tool claimed.
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [{ toolId: "files.write", mutating: true, success: true, paths: ["index.html"], persisted: false }],
          changed(["index.html"]),
        ),
      );

      expect(verdict.state).toBe("failed");
    });

    it("changes only in files the run never declared → failed, not complete (unrelated files)", () => {
      // e.g. provisioning files landing mid-run, or churn the run did not
      // make: a real diff that names none of the declared targets cannot
      // corroborate the reported write.
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [{ toolId: "files.write", mutating: true, success: true, paths: ["index.html"] }],
          changed([".litt-run.log", "assets/provisioned.png"]),
        ),
      );

      expect(verdict.state).toBe("failed");
      expect(verdict.missing).toContain("workspace change in a file the run declared it was writing");
      expect(verdict.reason).toMatch(/not in any file the run declared/i);
    });

    it("a tool with undeclared side effects is corroborated by any real change (terminal.execute)", () => {
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [{ toolId: "terminal.execute", mutating: true, success: true }],
          changed(["index.html"]),
        ),
      );

      expect(verdict.state).toBe("complete");
    });

    it("a legitimate overwrite verified by read-back completes even when the diff reports unchanged", () => {
      // The file ended up containing exactly what the tool claimed — the
      // requested end state is persisted, so net-zero is not a failure.
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [{ toolId: "files.write", mutating: true, success: true, paths: ["index.html"], persisted: true }],
          unchanged,
        ),
      );

      expect(verdict.state).toBe("complete");
    });

    it("unrelated changes alongside a verified write do not block completion", () => {
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [{ toolId: "files.write", mutating: true, success: true, paths: ["index.html"], persisted: true }],
          changed(["index.html", ".litt-run.log"]),
        ),
      );

      expect(verdict.state).toBe("complete");
    });
  });

  // ─── Issue #704: the verified-mutation requirement is per-claim, not
  // per-run. One verified write must not let a contradicted or
  // unattributable claim in the same run report "complete".
  describe("per-claim verification — one verified mutation cannot mask a failed claim", () => {
    it("a contradicted read-back fails a multi-file build even when the other writes verified (gitless)", () => {
      // The headline case: files 1–2 verified, file 3's write was
      // contradicted by read-back. Before per-claim tracking this still
      // reported "complete".
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [
            { toolId: "files.write", mutating: true, success: true, paths: ["index.html"], persisted: true },
            { toolId: "files.write", mutating: true, success: true, paths: ["style.css"], persisted: true },
            { toolId: "files.write", mutating: true, success: true, paths: ["app.js"], persisted: false },
          ],
          null,
        ),
      );

      expect(verdict.state).toBe("failed");
      expect(verdict.reason).toMatch(/did not find the claimed change/i);
      expect(verdict.reason).toMatch(/app\.js/);
    });

    it("a claim the diff cannot attribute fails a multi-file build even when the others verified", () => {
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [
            { toolId: "files.write", mutating: true, success: true, paths: ["a.html"] },
            { toolId: "files.write", mutating: true, success: true, paths: ["b.html"] },
            { toolId: "files.write", mutating: true, success: true, paths: ["c.html"] },
          ],
          changed(["a.html", "b.html"]),
        ),
      );

      expect(verdict.state).toBe("failed");
      expect(verdict.missing).toContain("workspace change in a file the run declared it was writing");
    });

    it("an unverifiable claim alongside a verified one is partial — never complete (gitless)", () => {
      // The write verified by read-back; the exec claim can be checked by
      // neither channel on a static workspace. "Complete" would claim
      // certainty the evidence does not have.
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [
            { toolId: "files.write", mutating: true, success: true, paths: ["index.html"], persisted: true },
            { toolId: "terminal.execute", mutating: true, success: true },
          ],
          null,
        ),
      );

      expect(verdict.state).toBe("partial");
      expect(verdict.state).not.toBe("complete");
      expect(verdict.missing).toContain("verified workspace change matching the reported mutation");
    });

    it("a boundary-verified mutation cannot mask a contradicted file claim", () => {
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [
            { toolId: "preview.start", mutating: true, success: true },
            { toolId: "files.write", mutating: true, success: true, paths: ["index.html"], persisted: false },
          ],
          null,
        ),
      );

      expect(verdict.state).toBe("failed");
    });

    it("a contradicted claim superseded by a later verified rewrite of the same path completes", () => {
      // The first write's read-back failed, but a later write landed the
      // requested end state — what persisted is what was asked for.
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [
            { toolId: "files.write", mutating: true, success: true, paths: ["index.html"], persisted: false },
            { toolId: "files.write", mutating: true, success: true, paths: ["index.html"], persisted: true },
          ],
          null,
        ),
      );

      expect(verdict.state).toBe("complete");
    });

    it("an earlier verified write does NOT supersede a later contradicted claim on the same path", () => {
      // Supersede only runs forward: the final persisted state is what
      // the last read-back saw, and it contradicts the claim.
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [
            { toolId: "files.write", mutating: true, success: true, paths: ["index.html"], persisted: true },
            { toolId: "files.write", mutating: true, success: true, paths: ["index.html"], persisted: false },
          ],
          null,
        ),
      );

      expect(verdict.state).toBe("failed");
    });
  });

  // ─── Issue #703: verification coverage beyond the four file tools.
  // On gitless (static) workspaces the read-back is the only channel —
  // these used to be unverifiable and reported failed on real success.
  describe("mutation verification coverage beyond write/delete/rename", () => {
    it("files.mkdir verified by read-back completes on a gitless workspace", () => {
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [{ toolId: "files.mkdir", mutating: true, success: true, paths: ["assets"], persisted: true }],
          null,
        ),
      );

      expect(verdict.state).toBe("complete");
    });

    it("files.mkdir contradicted by read-back fails on a gitless workspace", () => {
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [{ toolId: "files.mkdir", mutating: true, success: true, paths: ["assets"], persisted: false }],
          null,
        ),
      );

      expect(verdict.state).toBe("failed");
    });

    it("image.generate persisted via the saved asset path completes with no diff", () => {
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [{ toolId: "image.generate", mutating: true, success: true, paths: ["assets/images/hero.png"], persisted: true }],
          null,
        ),
      );

      expect(verdict.state).toBe("complete");
    });

    it("project.insert_asset persisted via the returned asset path completes with no diff", () => {
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [{ toolId: "project.insert_asset", mutating: true, success: true, paths: ["assets/hero.png"], persisted: true }],
          null,
        ),
      );

      expect(verdict.state).toBe("complete");
    });

    it("a failed in-workspace asset save vetoes image.generate even with no diff", () => {
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [{ toolId: "image.generate", mutating: true, success: true, persisted: false }],
          null,
        ),
      );

      expect(verdict.state).toBe("failed");
    });

    it("preview.start is verified at the tool boundary — an unchanged diff cannot contradict it", () => {
      // A preview produces no workspace diff by design: before the
      // capability split, a verified-unchanged diff reported this
      // legitimate success as failed.
      const verdict = evaluateCompletion(
        BUILD,
        evidence([{ toolId: "preview.start", mutating: true, success: true }], unchanged),
      );

      expect(verdict.state).toBe("complete");
    });

    it("mutating browser.* claims are verified at the tool boundary on gitless runs", () => {
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [
            { toolId: "browser.click", mutating: true, success: true },
            { toolId: "browser.type", mutating: true, success: true },
          ],
          null,
        ),
      );

      expect(verdict.state).toBe("complete");
    });

    it("a contradicted status probe still vetoes a boundary claim (preview.start)", () => {
      const verdict = evaluateCompletion(
        BUILD,
        evidence([{ toolId: "preview.start", mutating: true, success: true, persisted: false }], null),
      );

      expect(verdict.state).toBe("failed");
    });

    it("terminal.execute keeps file-evidence requirements — the boundary pass must not reopen the hole", () => {
      // The canonical false completion: an exit-0 command that wrote
      // nothing. A verified-unchanged diff still contradicts it.
      const contradicted = evaluateCompletion(
        BUILD,
        evidence([{ toolId: "terminal.execute", mutating: true, success: true }], unchanged),
      );
      expect(contradicted.state).toBe("failed");

      // And on a gitless workspace it is unverifiable — partial, never
      // complete (the false negative becomes honesty, not success).
      const unverifiable = evaluateCompletion(
        BUILD,
        evidence([{ toolId: "terminal.execute", mutating: true, success: true }], null),
      );
      expect(unverifiable.state).toBe("partial");
      expect(unverifiable.state).not.toBe("complete");
    });

    it("git.commit keeps file-evidence requirements too", () => {
      const contradicted = evaluateCompletion(
        BUILD,
        evidence([{ toolId: "git.commit", mutating: true, success: true }], unchanged),
      );
      expect(contradicted.state).toBe("failed");

      const unverifiable = evaluateCompletion(
        BUILD,
        evidence([{ toolId: "git.commit", mutating: true, success: true }], null),
      );
      expect(unverifiable.state).toBe("partial");
    });

    it("a declared directory is attributed to changed files inside it", () => {
      // insert_asset declares the directory it wrote into; the diff
      // names the file inside it.
      const verdict = evaluateCompletion(
        BUILD,
        evidence(
          [{ toolId: "project.insert_asset", mutating: true, success: true, paths: ["assets", "assets/hero.png"] }],
          changed(["assets/hero.png"]),
        ),
      );

      expect(verdict.state).toBe("complete");
    });
  });
});

describe("supersede: multi-path claims need full coverage", () => {
  // A non-verified claim is excused only when a LATER verified claim
  // covers its declared paths — a rewrite that landed after it. For a
  // multi-path claim (rename declares old AND new) covering just one
  // side must NOT excuse the whole claim: the other half may have
  // silently not landed (Greptile P1 #2).
  it("a verified write to one path does not excuse a two-path claim", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence(
        [
          // files.rename old→new declared both paths; its read-back could
          // not confirm (persisted undefined) and the diff is unavailable
          // (gitless workspace → unverifiable).
          {
            toolId: "files.rename",
            mutating: true,
            success: true,
            paths: ["old.txt", "new.txt"],
          },
          // A LATER verified write covers only old.txt.
          {
            toolId: "files.write",
            mutating: true,
            success: true,
            paths: ["old.txt"],
            persisted: true,
          },
        ],
        null,
      ),
    );

    // new.txt's half of the rename was never confirmed — the claim must
    // stay open, not be superseded by the old.txt write.
    expect(verdict.state).not.toBe("complete");
    expect(verdict.state).toBe("partial");
  });

  it("later verified writes covering BOTH paths still supersede", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence(
        [
          {
            toolId: "files.rename",
            mutating: true,
            success: true,
            paths: ["old.txt", "new.txt"],
          },
          {
            toolId: "files.write",
            mutating: true,
            success: true,
            paths: ["old.txt"],
            persisted: true,
          },
          {
            toolId: "files.write",
            mutating: true,
            success: true,
            paths: ["new.txt"],
            persisted: true,
          },
        ],
        null,
      ),
    );

    expect(verdict.state).toBe("complete");
  });
});
