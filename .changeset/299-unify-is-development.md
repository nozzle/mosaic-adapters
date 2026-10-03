---
'@nozzleio/mosaic-core': patch
---

Gate every development-only warning on one check. The dotted table-name hint used its own helper that treated an unset `NODE_ENV` (a plain Node script, or an unbundled browser with no `process` global) as development, so it could fire where the ignored-filter warning stayed silent. Both warnings now share the same rule: they fire only when `process.env.NODE_ENV` is set and is not `'production'`. Run a plain Node script with `NODE_ENV=development` to see them. The docs gain a "When development warnings fire" section describing each environment.
