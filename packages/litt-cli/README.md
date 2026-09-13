# LiTT CLI

The command-line companion for [LiTTree LabStudios](https://litlabs.net).

Use it to start projects, run local agents, inspect code, run checks, and ship — from your terminal.

## Requirements

- Node.js **22** or later
- Git
- pnpm is recommended but not required

## Install

```bash
npm install -g @litlabs/litt-cli
# or
pnpm add -g @litlabs/litt-cli
```

Run once without installing:

```bash
npx @litlabs/litt-cli --version
# or
pnpm dlx @litlabs/litt-cli --version
```

## Quick start

```bash
litt --version       # confirm the install
litt                 # open the cockpit
litt doctor          # run a health check
litt check           # run typecheck / lint style checks
litt build           # build the current project
litt run             # run the current project locally
litt production finish   # prepare a production release
litt deploy verify       # verify the live deployment
```

## Key commands

- `litt` / `litt shell` — interactive shell
- `litt cockpit` / `litt tui` — terminal UI
- `litt ask` — ask LiTT about your project
- `litt explain` — explain recent changes
- `litt diff` — show project diff
- `litt test` — run project tests
- `litt doctor` — diagnose environment and dependencies
- `litt production doctor` — check production readiness
- `litt production finish` — run the production finish flow
- `litt stripe doctor` — check Stripe billing integration
- `litt deploy verify` — verify deployment health
- `litt studio acceptance` — run studio acceptance checks

## Local-first by default

LiTT starts in local mode. Use `--remote` to connect to the LiTT cloud, or `--local` to force local-only operation.

- `LITT_LOCAL_ONLY=1` blocks remote/model use.
- `LITT_TARGET_OVERRIDE` can be set by `--local` or `--remote` flags.

## Development

To build from source:

```bash
git clone https://github.com/LabsConnected/litlabs-website.git
cd litlabs-website
pnpm install
pnpm --filter @litlabs/litt-cli build
pnpm --filter @litlabs/litt-cli link --global
litt --version
```

## License

Copyright © LiTTree LabStudios. All rights reserved.
