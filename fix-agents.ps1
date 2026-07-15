$f = 'c:\Users\litbi\CascadeProjects\litlab\src\lib\agents.ts'
$content = Get-Content $f -Raw

# Make sure the import is present (idempotent)
if ($content -notmatch 'from "@/lib/litt-identity"') {
    $content = $content -replace '(import \{ generateText \} from "@/lib/llm";)', "`$1`nimport { mergeLittIdentityWithProject } from ""@/lib/litt-identity"";"
}

# Replace the buildSystemPrompt function body
$oldBlock = @'
export function buildSystemPrompt(base: string, ctx?: ProjectContext): string {
  if (!ctx) return base;
  const lines: string[] = [];
  if (ctx.name) lines.push(`Project: ${ctx.name}`);
  if (ctx.description) lines.push(`Description: ${ctx.description}`);
  if (ctx.stack) lines.push(`Stack: ${ctx.stack}`);
  if (ctx.goals) lines.push(`Goals: ${ctx.goals}`);
  if (ctx.repoUrl) lines.push(`Repo: ${ctx.repoUrl}`);
  if (ctx.customInstructions) lines.push(`Special instructions: ${ctx.customInstructions}`);
  if (!lines.length) return base;
  return `${base}\n\n---\nUSER PROJECT CONTEXT (always factor this in):\n${lines.join("\n")}\n---`;
}
'@

$newBlock = @'
export function buildSystemPrompt(base: string, ctx?: ProjectContext): string {
  // 1) Static project identity (always on). This is the part that makes
  //    the system "know we're working on litlabs.net" without being told.
  const identity = mergeLittIdentityWithProject(ctx);

  // 2) Agent's own system prompt on top, so role/personality rules win.
  return `${identity}\n\n---\n\n${base}`;
}
'@

$content = $content.Replace($oldBlock, $newBlock)

Set-Content -Path $f -Value $content -NoNewline
Write-Host "Updated. File length:" (Get-Content $f -Raw).Length
