---
'@nozzleio/react-mosaic': minor
---

**BREAKING:** `useVgPlot` and the `VgPlotElement` type have moved off the package root onto a new `@nozzleio/react-mosaic/vgplot` entry point. Everything else on the root export is unchanged.

`@uwdata/vgplot` is now declared as an optional peer dependency (`>=0.30.0 <1`), so it is only required by consumers that import the new subpath.

Migration — update the import path:

```diff
-import { useVgPlot } from '@nozzleio/react-mosaic';
-import type { VgPlotElement } from '@nozzleio/react-mosaic';
+import { useVgPlot } from '@nozzleio/react-mosaic/vgplot';
+import type { VgPlotElement } from '@nozzleio/react-mosaic/vgplot';
```

The hook's signature and behaviour (including the `deps` rebuild semantics) are unchanged.
