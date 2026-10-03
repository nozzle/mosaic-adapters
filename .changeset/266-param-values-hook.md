---
'@nozzleio/react-mosaic': minor
---

Add `useMosaicParamValues(params)`, the record form of `useMosaicParamValue`: read several Params in one subscription and get back `{ [key]: value | undefined }`, each entry typed from its Param (exported `ParamValueOf` / `UseMosaicParamValuesResult` types). Entries are each Param's `value` as upstream reports it, so an explicit `null` stays `null`. The snapshot is frozen and keeps its identity while every value is `Object.is`-equal. `params` must be memoized; the subscription is keyed on the record's identity.

`useMosaicParamValue` and `useMosaicSelectionValue` now keep a stable subscription keyed on the Param / Selection instance, so they no longer unsubscribe and re-subscribe on every render. `useMosaicSelectionValue` applies a changed `source` option at read time.
