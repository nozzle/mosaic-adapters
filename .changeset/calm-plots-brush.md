---
'@nozzleio/mosaic-core': minor
'@nozzleio/react-mosaic': minor
---

Histogram clients now accept `scale: 'linear' | 'log'`. Log-scaled histograms
discover a positive extent and produce multiplicative bin boundaries, allowing
custom renderers to align queried counts with a logarithmic visual axis.
