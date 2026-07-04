---
'@nozzleio/react-mosaic': minor
---

Add `useMosaicSelection(type = 'intersect')` — a singular companion to `useMosaicSelections` returning one stable `Selection`. It's the first hook most consumers reach for, both for `filterBy` / `havingBy` wiring and as a lightweight pub/sub channel between sibling widgets. The `useState(() => Selection.single())` idiom is documented as the escape hatch.
