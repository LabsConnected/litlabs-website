/**
 * Redact token query strings and other credential-shaped text in an
 * acceptance artifact directory before it is uploaded.
 *
 * Usage: node scripts/final-acceptance/redact-artifacts.mjs <dir>
 * Prints a count only. Never prints file contents.
 */
import { redactArtifactTree } from "./redact-secrets.mjs";

const root = process.argv[2] || "artifacts/final-acceptance";
const { files, changed } = await redactArtifactTree(root);
console.log(`Redacted acceptance artifacts: ${changed} text file(s) updated, ${files} scanned.`);
