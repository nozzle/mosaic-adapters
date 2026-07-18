---
'@nozzleio/react-mosaic': minor
---

Add `useMosaicParamRef` and `useMosaicParamValue` for working with topology Params from React. `useMosaicParamRef(ref)` resolves a declared or external Param through the nearest `MosaicTopologyProvider`, mirroring `useMosaicSelectionRef`. `useMosaicParamValue(param)` reactively reads a Param's current value, re-rendering on every `value` change and re-subscribing when a different Param instance is passed. `useTopology` now also keys topology recreation on the identities of `options.params` and `options.paramOptions`, matching the existing `options.selections` / `options.filterSets` semantics. `useMosaicParamRef` is generic — `useMosaicParamRef<TParamValue = any>(ref)` — so a caller can write `useMosaicParamRef<MedalMetric>('metric')` and get a typed `Param` without a cast.
