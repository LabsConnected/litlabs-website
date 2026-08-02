# LiTTree North Star

> **Product direction document.** This defines what LiTTree is, what it is
> not, and the experience every feature must support. It is a target, not a
> claim that everything described here is implemented today. See the status
> labels in other `docs/product/` files for current implementation state.

## Status legend

| Label | Meaning |
|---|---|
| IMPLEMENTED | Verified in current production code |
| PARTIAL | Infrastructure exists, but the journey is incomplete |
| PLANNED | Approved product direction, not yet implemented |
| LATER | Intentionally outside the near-term release |

---

## What LiTTree is

LiTTree is an **AI project workspace** where an operator called **LiTT** helps
people turn ideas into finished digital work—working apps, websites, creative
media, brands, campaigns, and more.

LiTTree is not a chatbot, a code generator, or a portfolio site. It is a
complete project environment with:

- **Project memory** that carries context across sessions — PARTIAL
- **Real files and assets** stored in a workspace — PARTIAL
- **Missions** that define goals, plans, and results — PARTIAL
- **Human approvals** for sensitive actions — IMPLEMENTED (mission approvals table + API)
- **Checkpoints and rollback** for safe experimentation — PARTIAL (table exists, rollback incomplete)
- **Preview and deployment** from inside the workspace — PARTIAL (preview API exists, deployment is external)
- **Export and ownership** so users never get locked in — PLANNED

## What LiTTree is not

| LiTTree is                     | LiTTree is not                          |
| ------------------------------ | --------------------------------------- |
| A project workspace            | A chat-only interface                   |
| Operator-driven                | Prompt-only with no persistence         |
| Easy by default                | A developer-only tool                   |
| Powerful when opened up        | A dumbed-down toy                       |
| Real files and results         | A demo or concept showcase              |
| Human-in-the-loop              | Fully autonomous without approval       |
| One product with two modes     | Two separate products                   |

## The North Star experience

> "I described something I wanted, LiTT helped me turn it into a real result,
> I understood what happened, and I knew what to do next."

Every screen, feature, and interaction must support this loop:

```
Idea -> Mission -> Plan -> Work -> Review -> Result -> Save/Share/Deploy -> Return
```

If a feature does not help the user **understand, create, decide, finish, or
continue**, it should be removed, hidden, or postponed.

## The two audiences

LiTTree serves both:

1. **Regular people** who have an idea but do not know repositories, branches,
   APIs, or deployment.
2. **Power users** who want GitHub, real files, terminals, checkpoints, and
   full project control.

The product model is:

> **Easy by default. Powerful when opened up.** — PLANNED (Simple/Pro mode toggle not yet implemented)

A new user should never need Git, a provider key, or technical setup to produce
their first result. A power user should be able to connect a repository, open a
terminal, review diffs, and deploy without leaving the product.

Both audiences use the **same Project system**. Simple Mode and Pro Mode are
views on the same underlying project—not separate products.

## LiTT is an operator

LiTT is not a chat partner. LiTT is an operator that:

- **Before work:** explains what it understood, what it plans to do, what it
  needs, potential cost, and whether approval is required. — PARTIAL
- **During work:** shows current step, completed steps, what is being changed,
  whether anything is blocked, and whether the user can safely leave. — PARTIAL
- **After work:** reports what was completed, what changed, what remains, how
  to review it, how to undo it, and the best next action. — PARTIAL
- **On failure:** never shows only "something went wrong." Shows what failed,
  what was preserved, whether credits were consumed, whether a retry is safe,
  suggested corrective action, and technical details behind an expandable
  control. — PARTIAL

## The most important rule

> **Every screen should help the user understand, create, decide, finish, or
> continue.**

Anything that does none of those should be removed, hidden, or postponed.

## Scope boundaries

LiTTree does not try to be:

- A general-purpose IDE replacement
- A social network
- A payment processor
- A hosting company (deployment is a feature, not the product)
- A replacement for professional creative tools

LiTTree is the bridge between **having an idea** and **having a real result**.
