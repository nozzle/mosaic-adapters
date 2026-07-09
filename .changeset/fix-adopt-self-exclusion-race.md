---
'@nozzleio/mosaic-core': patch
---

Fix crossfilter self-exclusion loss when a FilterSet-publishing client remounts. A client destroyed inside the deferred prepare/adopt window no longer re-keys the surviving clause to itself (guarded in the base client's `prepare` wrapper and in the rows/facet/histogram `#adoptFromSet` paths), and a freshly-adopted client now re-queries once its own clause is confirmed self-excluded on its filter context, so a remounted selection table no longer renders only its selected rows. Reproducible in production builds under fast unmount/remount, not just React StrictMode.
