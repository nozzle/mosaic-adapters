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
- Available test targets per package: `test:types`, `test:lint`, `test:build`, `build`

## Testing instructions

- **Critical**: Always run type tests during development - do not proceed if they fail
- **Test types:** `pnpm test:types`, `pnpm test:lint`, `pnpm test:build`
- **Full CI suite:** `pnpm test:pr`
- **Fix formatting:** `pnpm format`

## PR instructions

- Always run `pnpm test:lint`, `pnpm test:types`, and `pnpm test:build` before committing
- Test changes in relevant example apps: `cd examples/react/basic && pnpm dev`
- Update corresponding documentation in `docs/` directory when adding features
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
