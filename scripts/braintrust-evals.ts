/**
 * Braintrust offline eval runner for LiTTree Lab Studios.
 *
 * Run with: npx tsx scripts/braintrust-evals.ts
 *
 * This script:
 *   1. Loads a dataset of (prompt, expected, agentSlug, mode) tuples
 *   2. Runs each prompt through the unified LLM client
 *   3. Scores outputs against the eval dimensions defined in
 *      src/lib/evals/braintrust.ts
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
import { generateText } from "@/lib/llm";
import { EVAL_DIMENSIONS, type LLMCallMetadata } from "@/lib/evals/braintrust";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
    data: dataset,
    task: async (row: EvalRow) => {
      const metadata: LLMCallMetadata = {
        agentSlug: row.agentSlug,
        agentMode: row.mode,
      };
      const result = await generateText(row.prompt, {
        task: "chat",
        evalMetadata: metadata,
      }, row.systemPrompt);
      return result.text;
    },
    scores: {
      // Deterministic scorers run synchronously on the output
      "anti-boilerplate": (output: string) => {
        const dim = EVAL_DIMENSIONS.find((d) => d.name === "anti-boilerplate");
        if (dim?.type === "deterministic" && "check" in dim && dim.check) {
          return dim.check(output);
        }
        return 0;
      },
      // LLM-as-judge scorers (Braintrust runs these async)
      "truthfulness": async (input: EvalRow, output: string) => {
        // Simple heuristic: check for hedging language vs confident claims
        const hedgingPatterns = [/i don't know/i, /i'm not sure/i, /i cannot verify/i];
        const claimPatterns = [/definitely/i, /certainly/i, /i can confirm/i];
        const hedges = hedgingPatterns.filter((p) => p.test(output)).length;
        const claims = claimPatterns.filter((p) => p.test(output)).length;
        // Good: hedges when uncertain, no unsupported claims
        if (hedges > 0 && claims === 0) return 1;
        if (claims > 0 && hedges === 0) return 0.3;
        return 0.7;
      },
      "helpfulness": async (input: EvalRow, output: string) => {
        // Heuristic: output should be > 10 chars and reference the input topic
        if (output.length < 10) return 0;
        const inputWords = input.prompt.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
        const outputLower = output.toLowerCase();
        const overlap = inputWords.filter((w) => outputLower.includes(w)).length;
        return Math.min(1, overlap / Math.max(1, inputWords.length));
      },
      "latency-bucket": (_input: EvalRow, _output: string, metadata?: { latencyMs?: number }) => {
        const ms = metadata?.latencyMs;
        if (!ms) return null;
        if (ms < 2000) return 1;
        if (ms < 5000) return 0.75;
        if (ms < 10000) return 0.5;
        return 0.25;
      },
    },
    // Log metadata for each eval row
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
