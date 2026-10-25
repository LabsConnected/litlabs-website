import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

function workflow(name: string): string {
  return readFileSync(path.resolve(__dirname, "../.github/workflows", name), "utf-8");
}

describe("public Actions logs do not echo secrets", () => {
  it("reports secret-scan hits as file:line and a rule name", () => {
    const build = workflow("build.yml");
    expect(build).not.toContain('echo "$HITS"');
    expect(build).toContain('echo "rule: ${rule}"');
    expect(build).toContain("cut -d: -f1,2");
    expect(build).toContain("scan_rule \"groq-api-key\"");
  });

  it("does not echo the deploy digest body or the bearer header", () => {
    const digest = workflow("cron-deploy-digest.yml");
    expect(digest).not.toContain("Response body:");
    expect(digest).not.toContain('echo "$BODY"');
    expect(digest).not.toContain('echo "$RESPONSE"');
    expect(digest).toContain('printf \'Authorization: Bearer %s\\n\' "$INTERNAL_API_KEY"');
    expect(digest).toContain("Summary: success=");
    expect(digest).toContain('rm -f "$header_file"');
  });

  it("does not store the raw health payload as a release-gate output", () => {
    const gate = workflow("release-gate.yml");
    expect(gate).not.toContain('echo "response=$RESPONSE"');
    expect(gate).toContain("Bearer [redacted]");
  });

  it("runs gitleaks with redaction and does not upload a findings artifact", () => {
    const leaks = workflow("gitleaks.yml");
    expect(leaks).toContain("pull_request:");
    expect(leaks).toContain("branches: [main]");
    expect(leaks).toContain("--redact=100");
    expect(leaks).toContain("--report-template .github/gitleaks-report.tmpl");
    expect(leaks).not.toContain("upload-artifact");
    expect(leaks).not.toContain("GITLEAKS_ENABLE_COMMENTS");
    const template = readFileSync(
      path.resolve(__dirname, "../.github/gitleaks-report.tmpl"),
      "utf-8",
    );
    expect(template).toContain(".RuleID");
    expect(template).toContain(".File");
    expect(template).toContain(".StartLine");
    expect(template).not.toContain(".Secret");
    expect(template).not.toContain(".Match");
  });
});
