---
'@nozzleio/mosaic-core': minor
'@nozzleio/react-mosaic': patch
---

`topology.destroy()` now tears down its owned `compose`/`cascading` contexts and FilterSets silently by default: relays are detached but no clear clause is published and no `value` event fires, so clients still connected to those contexts no longer each run one unfiltered query on their way out. Pass `clearOnDestroy: true` in the `createTopology` options to restore the previous clearing teardown. External instances are still never touched.

The building blocks gain the same opt-in: `FilterSet.destroy({ silent: true })`, and `destroy({ silent: true })` on the handles returned by `createComposedSelection` and `createCascadingContexts`. Their default (clearing) teardown is unchanged. New exported types: `FilterSetDestroyOptions` and `CompositionDestroyOptions`.

`useTopology` inherits the silent teardown, so a parent unmounting no longer makes its still-connected descendants re-query.
