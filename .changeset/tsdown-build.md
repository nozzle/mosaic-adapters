---
'@nozzleio/mosaic-core': patch
'@nozzleio/mosaic-tanstack-table-core': patch
'@nozzleio/mosaic-tanstack-react-table': patch
'@nozzleio/react-mosaic': patch
---

Build the published packages with tsdown instead of Vite library mode, with type declarations emitted by TypeScript 7. There are no runtime or API changes. The `dist/esm` layout, entry points, and `exports` map are unchanged.

- Declaration files that no public type refers to are no longer emitted (`base-client.d.ts` and `topology/wiring.d.ts` in `@nozzleio/mosaic-core`, `use-data-client.d.ts` in `@nozzleio/react-mosaic`).
- The emitted JavaScript and declarations are formatted differently (for example `const` instead of `var` for module-level bindings).
