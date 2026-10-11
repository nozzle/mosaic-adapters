---
'@nozzleio/mosaic-core': patch
'@nozzleio/react-mosaic': patch
---

Support Mosaic 0.32.1 and update `@tanstack/store` / `@tanstack/react-store` to `^0.11.2`. The Mosaic peer range stays `>=0.32.0 <1`, so nothing changes for apps on 0.32.0.

Mosaic 0.32.1 itself removes `socketConnector` / `SocketConnector`, and `new Coordinator()` without a connector now defaults to a REST connector. Apps that used the socket connector need `restConnector`, `wasmConnector` or their own connector before upgrading Mosaic. The remote-connector example in the connector lifecycle docs now uses `restConnector`.
