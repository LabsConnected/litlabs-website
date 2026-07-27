# Intent Classification

The Kernel classifies every user message before selecting a mode.

## Classification Dimensions

1. **Mode** — what kind of operation (think, research, create, build, review, ship, status, learn)
2. **Domains** — what expertise (physics, design, engineering, devops, accessibility, commerce, etc.)
3. **Requires project** — does this need a Project context?
4. **Requires current information** — does this need web search or live data?
5. **Requires private data** — does this need user-specific data?
6. **Requires execution** — does this need tools, files, or deployment?

## Examples

| User message | Mode | Domains | Requires project |
|---|---|---|---|
| "Explain black holes" | learn | physics | no |
| "Compare current GPU prices" | research | commerce | no |
| "Design a landing page" | create | design | no |
| "Implement the page" | build | engineering | yes |
| "Audit accessibility" | review | accessibility | yes |
| "Deploy the app" | ship | devops | yes |
| "Is voice working?" | status | platform | no |
| "Make notes about the meeting" | create | notes | no |
| "Add dark mode to the homepage" | build | engineering | yes |

## Implementation

Classification is deterministic where possible (regex + keyword matching) and
falls back to a lightweight LLM call only for ambiguous cases.

See `src/lib/litt-kernel/intent-router.ts`.
