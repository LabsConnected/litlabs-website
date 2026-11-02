/**
 * "classify-direct" provider — calls LiTT's REAL, deployed intent
 * classifier (packages/litt-cli/src/lib/intent.ts, compiled to
 * dist/lib/intent.js) directly. This is not a simulation or a prompt to
 * an LLM — it is the literal function the interactive LiTT cockpit calls
 * at ink/controller.ts:2181 to decide CHAT vs MISSION ("BUILD") routing.
 *
 * $0 cost, deterministic, no network/model call. This is the ground-truth
 * track the other providers are checked against.
 */
const path = require("node:path");

const CLI_DIST = path.resolve(
  __dirname,
  "../../../packages/litt-cli/dist/lib/intent.js",
);

class ClassifyDirectProvider {
  id() {
    return "litt-classify-direct";
  }

  async callApi(prompt) {
    const mod = await import(`file://${CLI_DIST}`);
    const intent = mod.classifyIntent(prompt);
    return {
      output: JSON.stringify({ intent, source: "real classifyIntent() — ink/controller.ts:2181" }),
    };
  }
}

module.exports = ClassifyDirectProvider;
