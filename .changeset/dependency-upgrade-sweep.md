---
'@nozzleio/mosaic-core': patch
'@nozzleio/react-mosaic': patch
'@nozzleio/mosaic-tanstack-table-core': patch
'@nozzleio/mosaic-tanstack-react-table': patch
---

build(deps): upgrade dependencies to their latest eligible versions.

Notably `@tanstack/store` and `@tanstack/react-store` move to `^0.11.0` (from `^0.9.1`) — no API changes. All other bumps are build tooling and dev dependencies (no change to published runtime surface). TypeScript is held on the `5.9.x` line.
