---
'@nozzleio/react-mosaic': minor
---

The data hooks (`useMosaicRows`, `useMosaicFacet`, `useMosaicHistogram`, `useMosaicSparkline`, `useMosaicRollup`, `useMosaicPivot`, `useMosaicValues`) now pass through the new `skipSources` option and fold it into their structural identity via `skipSourcesKey`, so changing the excluded-source set rebinds the client while an equal set does not trigger a rebind. `skipSourcesKey` is exported from `use-data-client` alongside `paramsKey`.
