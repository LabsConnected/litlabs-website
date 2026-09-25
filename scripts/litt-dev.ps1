param(
  [ValidateSet("dev", "test", "lint", "typecheck", "build")]
  [string]$Task = "dev"
)

$ErrorActionPreference = "Stop"

switch ($Task) {
  "dev" {
    pnpm dev
  }

  "test" {
    pnpm test:e2e
  }

  "lint" {
    pnpm lint
  }

  "typecheck" {
    pnpm type-check
  }

  "build" {
    pnpm build
  }
}
