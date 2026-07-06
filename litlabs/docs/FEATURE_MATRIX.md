# LiT Console vs Best-in-Class — Feature Matrix

Legend: ✅ strong · 🟡 partial · ❌ missing / weak · 🚧 planned

| Capability | LiT Console (current) | Cursor | Claude Code | Windsurf | Codex | What LiT needs |
|---|---|---|---|---|---|---|
| **Chat UI** | ✅ Good | ✅ | ✅ CLI | ✅ | ✅ | Keep improving streaming + tool cards |
| **Real terminal (PTY)** | ✅ node-pty | ✅ | ✅ | ✅ | ✅ | Add session persistence + CWD tracking |
| **Terminal AI loop** | 🟡 Q&A only | ✅ | ✅ | ✅ | ✅ | Close the loop: execute → observe → iterate |
| **Diff-first editing** | ❌ | ✅ | ✅ | ✅ | ✅ | Diff review before apply |
| **Persistent project memory** | 🟡 20-string agent memory | ✅ Rules + mems | ✅ /memory | ✅ Memories | ✅ Skills | Project rules, memories, skills |
| **AGENTS.md / repo instructions** | ✅ Has AGENTS.md | ✅ | ✅ CLAUDE.md | ✅ | ✅ | Expand to runtime rules + skills |
| **Agent orchestration** | 🟡 Two orchestrators, not unified | ✅ Subagents | ✅ | ✅ Cascade | ✅ Subagents | Single task-graph orchestrator |
| **Background / async agents** | 🟡 API schema exists | ✅ Cloud | ✅ | ✅ | ✅ | Durable queue + job runner |
| **App preview pane** | ❌ | ✅ | ✅ | ✅ | ✅ | Embed preview + error capture |
| **Browser error capture** | ❌ | 🟡 | 🟡 | ✅ | ✅ | Console/network errors → chat |
| **MCP / tool ecosystem** | ❌ | ✅ | ✅ | ✅ | ✅ | Tool registry + MCP layer |
| **GitHub integration** | ❌ | ✅ | ✅ | ✅ | ✅ | Repo context, PRs, review agent |
| **Supabase integration** | 🟡 Schema exists | 🟡 via MCP | 🟡 via MCP | 🟡 via MCP | 🟡 via MCP | First-class DB introspection + migrations |
| **Vercel / deploy loop** | 🟡 Stub endpoint | ✅ | ✅ | ✅ | ✅ | Deploy, preview URL, logs, rollback |
| **Approval policies** | 🟡 Approve button | ✅ | ✅ | ✅ | ✅ | Policy engine + risk classification |
| **Sandbox / safety** | 🟡 Blocked commands | ✅ | ✅ | ✅ | ✅ | Docker sandbox + egress controls |
| **Hooks / workflows** | ❌ | ✅ | ✅ | ✅ | ✅ | User-defined hooks + workflow builder |
| **Code review agent** | ❌ | ✅ | ✅ | ✅ | ✅ | PR review + diff comments |
| **Team / shared projects** | 🟡 Clerk orgs ready | ✅ | 🟡 | ✅ | ✅ | Shared rules, runs, workflows |
| **Enterprise controls** | ❌ | ✅ | ✅ | ✅ | ✅ | SSO, audit, BYOK, retention |

## Score summary

| Tool | Score (out of 20) |
|---|---|
| Cursor | ~18 |
| Claude Code | ~17 |
| Windsurf | ~17 |
| Codex | ~16 |
| **LiT Console (current)** | **~9** |
| **LiT Console (v2 target)** | **~18** |

LiT's biggest single lever is the **execution loop**: plan → act → observe → approve → ship. Everything else follows from that.
