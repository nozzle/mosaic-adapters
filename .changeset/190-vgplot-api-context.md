---
'@nozzleio/react-mosaic': minor
---

`useVgPlot` now hands its factory a typed vgplot API context bound to the hook's resolved coordinator, so plots query the same coordinator as the data hooks.

- The factory receives `api` — upstream `createAPIContext({ coordinator })`, typed as the exported `VgPlotApi` (with `VgPlotApiContext` / `VgPlotNamedPlots`). Build marks, interactors, and inputs through it: `useVgPlot((api) => api.plot(...))`. Existing zero-argument factories using the bare `vg.*` namespace keep working unchanged.
- The coordinator resolves from a new optional third argument, `{ coordinator }`, then the nearest `MosaicProvider`, then the upstream global coordinator. A change of resolved coordinator rebuilds the plot.
- One API context is shared per coordinator, so cross-plot naming (`api.name`, legends' `for`) works across plots. For the global coordinator it reuses vgplot's global `namedPlots` registry, so context-built and bare-namespace plots still see each other's names.
- In development, the hook warns once if the built plot's marks are connected to a different coordinator than the resolved one (typically a bare `vg.plot(...)` under a `MosaicProvider`). Pass the `coordinator` option to opt a deliberately bound plot out of the check.
