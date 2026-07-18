/**
 * Public type-surface pin. React apps depend only on `@nozzleio/react-mosaic`
 * (the @tanstack/react-table distribution model), so the framework-agnostic
 * core's public types must stay reachable through this package's entrypoint
 * via the `export * from '@nozzleio/mosaic-core'` re-export. These are
 * compile-time assertions: `tsc` (test:types) fails if any of these core names
 * stops being re-exported from the package entrypoint. The runtime body is a
 * trivial guard so vitest (test:lib) also has a case to execute.
 */
import { describe, expect, test } from 'vitest';
import type {
  DataClientOptions,
  DataClientStatus,
  FilterSet,
  FilterSpec,
  ParamValue,
  Persister,
  Topology,
  TopologyConfig,
  TopologyOptions,
} from '../src/index';

/** Compiles only if `T` is a type reachable from the package entrypoint. */
type Reexported<T> = T;

describe('public type surface', () => {
  test('re-exports @nozzleio/mosaic-core public types', () => {
    const status: Reexported<DataClientStatus> = 'success';
    expect<DataClientStatus>(status).toBe('success');

    // Referenced purely to pin resolvability of the remaining core types
    // through the entrypoint; `tsc` fails here if any name is dropped.
    type _Pins = [
      Reexported<TopologyConfig>,
      Reexported<Topology>,
      Reexported<TopologyOptions>,
      Reexported<ParamValue>,
      Reexported<FilterSet>,
      Reexported<FilterSpec>,
      Reexported<DataClientOptions<Record<string, unknown>>>,
      Reexported<Persister<unknown>>,
    ];
    const pinned: _Pins | undefined = undefined;
    expect(pinned).toBeUndefined();
  });
});
