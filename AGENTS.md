# AGENTS.md

## Project overview

This monorepo contains various adapters and examples for the Mosaic framework. The structure is as follows:

- `packages/`: Contains the core adapter packages for different frameworks (e.g., React, Vue, Svelte).
- `examples/`: Contains example projects demonstrating the use of the adapters in various frameworks.

## Setup commands

- Install deps: `pnpm install`
- Build packages: `pnpm build` (affected) or `pnpm build:all` (all packages)
- Watch for changes: `pnpm dev`

## Code style

- TypeScript strict mode with extensive type safety.
- Framework-agnostic core logic separated from framework-specific bindings.
- Type-safe arguments and parameters for user-facing APIs.
- Use workspace protocol for internal package dependencies (`workspace:*`).
- TypeScript/JavaScript IF statements should not use inline returns.
- TypeScript/JavaScript IF statement checking should be defensive and exit early to reduce nesting.

## Dev environment tips

- This is a pnpm workspace monorepo with packages organized by functionality.
- Nx provides caching, affected testing, targeting, and parallel execution for efficiency.
- Use `pnpx nx show projects` to list all available packages.
- Available test targets per package: `test:types`, `test:lint`, `test:build`, `test:lib`, `build`
- E2E test target: `test:e2e` (for examples with `playwright.config.ts`)

## Testing instructions

- **Critical**: Always run type tests during development - do not proceed if they fail

### Commands

- `pnpm test:pr` - Full CI suite (lint, types, lib, build, e2e)
- `pnpm test:lib` - Vitest unit tests (affected packages)
- `pnpm test:e2e` - Playwright E2E tests (affected examples)
- `pnpm test:types` - Type checking
- `pnpm test:lint` - Linting
- `pnpm test:build` - Build verification
- `pnpm test:format` - Check formatting
- `pnpm format` - Fix formatting

### Test Locations

- Unit tests: `packages/<pkg>/tests/*.test.ts`
- E2E tests: `examples/**/**/tests/*.test.ts` (where `playwright.config.ts` exists)

### When to use test:lib vs test:e2e

- **test:lib** (Vitest) - Unit/integration tests for package internals: logic, utilities, type behavior, mocking. Tests run in Node without a browser.
- **test:e2e** (Playwright) - Runtime behavior tests for consumers: button clicks trigger correct UI changes, data flows correctly through components, user interactions work as expected in a real browser.

Use e2e when testing "does the right thing happen on screen when a user interacts with it?" Use lib for everything else.

## PR instructions

- Always run `pnpm test:lint`, `pnpm test:types`, and `pnpm test:build` before committing
- Test changes in relevant example apps: `cd examples/react/trimmed && pnpm dev`
- Update corresponding documentation in `docs/` directory when adding adding/changing any library APIs and their usage
- Add or update tests for any code changes

## Package structure

**Core packages:**

- `packages/mosaic-tanstack-table-core/` - Framework-agnostic core logic.
- `packages/mosaic-tanstack-react-table/` - React bindings and components.

**Examples & testing:**

- `examples/react` - Example applications (test changes here).

## Framework-specific notes

**React:**

- Package: `@nozzleio/mosaic-tanstack-react-router`

## Environment requirements

- **Node.js** - Required for development
- **pnpm** - Package manager (required for workspace features)

## Development workflow

1. **Setup**: `pnpm install`
2. **Build**: `pnpm build:all` or `pnpm dev` for watch mode.
3. **Test**: Make changes and run relevant tests (use nx for targeted testing).
4. **Examples**: Navigate to examples and run `pnpm dev` to test changes.
5. **Quality**: Run `pnpm test:lint`, `pnpm test:types`, `pnpm test:build` before committing.
