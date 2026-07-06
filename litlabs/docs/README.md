# LiT Console v2 — Documentation Pack

This folder contains the strategy, architecture, and roadmap for taking LiT Console from its current foundation to a best-in-class project-aware AI command center.

## Files

| File | Purpose |
|------|---------|
| `LIT_CONSOLE_GAP_ANALYSIS.md` | What the best tools have that LiT still needs, and what LiT already has. |
| `LIT_CONSOLE_V2_ROADMAP.md` | 24-week phased roadmap: execution loop → terminal intelligence → preview → integrations → workflows → trust. |
| `FEATURE_MATRIX.md` | Side-by-side comparison of LiT Console vs Cursor, Claude Code, Windsurf, and Codex. |
| `ARCHITECTURE_BLUEPRINT.md` | System architecture, data model, layers, and implementation order. |
| `roadmap.svg` | Visual timeline of the 6-phase roadmap. |
| `architecture.svg` | Visual system architecture diagram. |

## How to use these

- **Roadmap**: Start with `LIT_CONSOLE_V2_ROADMAP.md` and `roadmap.svg` for the big picture.
- **Architecture**: Read `ARCHITECTURE_BLUEPRINT.md` + `architecture.svg` before writing new data models or APIs.
- **Prioritization**: Use `LIT_CONSOLE_GAP_ANALYSIS.md` and `FEATURE_MATRIX.md` to decide what to build next and why.
- **Print to PDF**: Open any markdown file in a browser and print to PDF for sharing with stakeholders.

## Landing page

A premium v2 landing page is also available at `/public/landing-v2.html` in the Next.js project. Open it directly in a browser or view it at `http://localhost:3000/landing-v2.html` when running the dev server.

## Next steps

1. Review and approve the roadmap.
2. Pick the first epic (Foundation: execution loop).
3. Create the `runs` / `run_steps` / `run_artifacts` Supabase tables.
4. Refactor `CommandDock` to start a `Run` instead of just a chat message.
5. Build the Director planning API.
