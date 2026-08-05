/**
 * Braintrust offline eval runner for LiTTree Lab Studios.
 *
 * Run with: npx tsx scripts/braintrust-evals.ts
 *
 * This script:
 *   1. Loads a dataset of (prompt, expected, agentSlug, mode) tuples
 *   2. Runs each prompt through the unified LLM client
 *   3. Scores outputs against project-specific eval dimensions
 *   4. Logs results to Braintrust for comparison and tracking
 *
 * Dataset format (JSON file, path via BT_EVAL_DATASET env or default):
 *   [
 *     {
 *       "prompt": "What's my project status?",
 *       "expected": "Should report exact repo, branch, terminal state",
 *       "agentSlug": "litt",
 *       "mode": "standard",
 *       "systemPrompt": "You are LiTT..."
 *     }
 *   ]
 */
import { Eval } from "braintrust";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateText } from "../src/lib/llm";

interface EvalRow {
  prompt: string;
  expected: string;
  agentSlug?: string;
  mode?: string;
  systemPrompt?: string;
}

function loadDataset(): EvalRow[] {
  const path = process.env.BT_EVAL_DATASET ?? "scripts/eval-dataset.json";
  const raw = readFileSync(resolve(process.cwd(), path), "utf-8");
  return JSON.parse(raw) as EvalRow[];
}

async function main() {
  if (!process.env.BT_API_KEY) {
    console.error("BT_API_KEY is required. Run `bt login` or set it in .env.local");
    process.exit(1);
  }

  const dataset = loadDataset();
  console.log(`Loaded ${dataset.length} eval rows`);

  const projectName = "litlabs-website";

  await Eval(projectName, {
    // Map raw rows into EvalCase shape: { input, expected, tags }
    data: dataset.map((row) => ({
      input: row,
      expected: row.expected,
      tags: [row.agentSlug ?? "unknown", row.mode ?? "default"].filter(Boolean),
    })),
    task: async (input: EvalRow) => {
      const result = await generateText(
        input.prompt,
        { task: "chat" },
        input.systemPrompt,
      );
      return result.text;
    },
    // scores is an array of EvalScorer functions.
    // Each scorer receives { input, output, expected, ... } and returns
    // a Score object { name, score } or a plain number/null.
    scores: [
      // Deterministic: check for boilerplate patterns
      ({ output }: { output: string }) => {
        const boilerplatePatterns = [
          /your app name/i,
          /lorem ipsum/i,
          /placeholder text/i,
          /todo:\s*implement/i,
          /function\s+foo\s*\(/i,
          /console\.log\(["']hello/i,
        ];
        const violations = boilerplatePatterns.filter((p) => p.test(output));
        return { name: "anti-boilerplate", score: violations.length === 0 ? 1 : 0 };
      },
      // Heuristic: truthfulness via hedging vs confident claims
      ({ output }: { output: string }) => {
        const hedgingPatterns = [/i don't know/i, /i'm not sure/i, /i cannot verify/i];
        const claimPatterns = [/definitely/i, /certainly/i, /i can confirm/i];
        const hedges = hedgingPatterns.filter((p) => p.test(output)).length;
        const claims = claimPatterns.filter((p) => p.test(output)).length;
        const score = (hedges > 0 && claims === 0) ? 1 : (claims > 0 && hedges === 0) ? 0.3 : 0.7;
        return { name: "truthfulness", score };
      },
      // Heuristic: helpfulness via input/output word overlap
      ({ input, output }: { input: EvalRow; output: string }) => {
        if (output.length < 10) return { name: "helpfulness", score: 0 };
        const inputWords = input.prompt.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
        const outputLower = output.toLowerCase();
        const overlap = inputWords.filter((w) => outputLower.includes(w)).length;
        return { name: "helpfulness", score: Math.min(1, overlap / Math.max(1, inputWords.length)) };
      },
    ],
    metadata: {
      evalRunner: "scripts/braintrust-evals.ts",
      datasetPath: process.env.BT_EVAL_DATASET ?? "scripts/eval-dataset.json",
    },
  });
}

main().catch((err) => {
  console.error("Eval run failed:", err);
  process.exit(1);
});
