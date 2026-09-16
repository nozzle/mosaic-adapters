---
'@nozzleio/mosaic-core': patch
---

Data clients now honour a current-request guarantee: only the response to the most recent main-query request writes `status`/data to the store. A response for a request that has since been superseded — by a `filterBy`/`havingBy`/Param-driven re-query, `setInputs`, `refetch()`, or an empty round — is dropped whether it succeeds or fails and whichever order responses arrive in. Previously an older in-flight query completing first would briefly report `'success'` with stale rows against the newer `inputs` (nozzle/mosaic-adapters#230).
