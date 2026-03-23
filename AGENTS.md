# AGENTS.md

## Scope

- This repo is a `pnpm` workspace managed with Nx.
- Discover exact projects, scripts, and targets from `package.json`, `nx.json`, and package-level config instead of duplicating them here.

## Code expectations

- Keep core logic framework-agnostic; put framework bindings in framework-specific packages.
- Preserve strict TypeScript and type-safe public APIs.
- Use `workspace:*` for internal package dependencies.
- Prefer defensive checks and early exits; avoid inline `if (...) return ...` style.

## Validation

- Add or update tests for code changes.
- Always run `pnpm test:types` for relevant changes before handoff.
- Run `pnpm test:lint` and `pnpm test:build` before commit or final handoff.
- Run `pnpm test:lib` for package logic changes.
- Run `pnpm test:e2e` for user-visible behavior changes in example apps.

## Docs and examples

- If public APIs or documented usage change, update the relevant files in `docs/`.
- When runtime behavior changes, validate in the relevant example app under `examples/react/*`.
