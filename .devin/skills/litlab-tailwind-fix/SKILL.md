---
name: litlab-tailwind-fix
description: Fix Tailwind CSS v4 canonical class warnings in a file or directory. Converts deprecated arbitrary-value syntax to canonical named utilities.
argument-hint: "[file-or-glob]"
model: swe
allowed-tools:
  - read
  - edit
  - grep
  - glob
  - exec
permissions:
  allow:
    - Read(**)
    - Write(src/**)
    - Exec(npx eslint)
    - Exec(npx tsc)
---

Fix Tailwind CSS v4 `suggestCanonicalClasses` warnings in the specified file(s).

## Common conversions (Tailwind v4)

| Deprecated (arbitrary) | Canonical (named) |
|---|---|
| `bg-gradient-to-r` | `bg-linear-to-r` |
| `bg-gradient-to-t` | `bg-linear-to-t` |
| `bg-gradient-to-br` | `bg-linear-to-br` |
| `bg-gradient-to-b` | `bg-linear-to-b` |
| `h-[280px]` | `h-70` (280/4=70) |
| `w-[140px]` | `w-35` (140/4=35) |
| `max-w-[680px]` | `max-w-170` (680/4=170) |
| `min-h-[760px]` | `min-h-190` (760/4=190) |
| `rounded-[2rem]` | `rounded-4xl` (2rem=32px → 4xl) |
| `aspect-[16/9]` | `aspect-video` |
| `aspect-[16/10]` | `aspect-16/10` |
| `aspect-[4/3]` | `aspect-4/3` |
| `bg-white/[.02]` | `bg-white/2` |
| `bg-white/[.03]` | `bg-white/3` |
| `bg-white/[.045]` | `bg-white/4.5` |
| `bg-white/[.05]` | `bg-white/5` |
| `bg-white/[.06]` | `bg-white/6` |
| `hover:bg-white/[.04]` | `hover:bg-white/4` |
| `tracking-[-.05em]` | `tracking-tighter` |
| `z-[10000]` | `z-10000` |
| `z-[2147483647]` | `z-2147483647` |
| `[background-image:linear-gradient(...)]` | `bg-[linear-gradient(...)]` |
| `[background-size:64px_64px]` | `bg-size-[64px_64px]` |

## Conversion rules
- **Spacing scale**: `[Npx]` → `N/4` (e.g. `[280px]` → `70`, `[140px]` → `35`). Decimals allowed (e.g. `[90px]` → `22.5`).
- **Opacity**: `/[.0X]` → `/X` (drop leading dot, drop trailing zero). `[.045]` → `4.5`.
- **Gradients**: `bg-gradient-to-*` → `bg-linear-to-*` (Tailwind v4 renamed).
- **Aspect ratios**: `aspect-[16/9]` → `aspect-video` (special case) or `aspect-16/10` → `aspect-16/10` (just drop brackets).
- **z-index**: `z-[N]` → `z-N` (drop brackets).
- **tracking**: `tracking-[-.05em]` → `tracking-tighter`, `tracking-[-.02em]` → `tracking-tight`.

## Workflow
1. Read the target file(s).
2. `grep` for each deprecated pattern: `bg-gradient-to-`, `\[.*px\]`, `/\[\.0`, `aspect-\[`, `z-\[`, `tracking-\[`, `\[background-`.
3. Apply conversions using `edit` with `replace_all: true` for repeated patterns.
4. Verify: `npx eslint <file>` (0 warnings) and `npx tsc --noEmit` (0 new errors).
5. Report: count of fixes per file, verification result.

## Important
- NEVER convert a class that's already canonical — only fix flagged warnings.
- Preserve responsive prefixes (`sm:`, `md:`, `lg:`, `xl:`, `hover:`, `focus:`).
- Some arbitrary values have NO canonical equivalent (e.g. very specific pixel values not on the 4px scale) — leave those alone.
- Always run eslint after to confirm 0 warnings remain.
