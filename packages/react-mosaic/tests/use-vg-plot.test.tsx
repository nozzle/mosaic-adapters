import { createAthletesDb, render, waitFor } from '@nozzleio/test-support/react';
import type { TestDb } from '@nozzleio/test-support/react';
import { coordinator as globalCoordinator } from '@uwdata/mosaic-core';
import type { Coordinator, Selection } from '@uwdata/mosaic-core';
import * as vg from '@uwdata/vgplot';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, test, vi } from 'vitest';

import { MosaicProvider, useTopology } from '../src/index';
import type { Topology, TopologyConfig } from '../src/index';
import { useVgPlot } from '../src/vgplot';
import type { UseVgPlotOptions, VgPlotApi, VgPlotFactory } from '../src/vgplot';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A dot plot over the athletes fixture, built through `api`. */
function athletesPlot(api: VgPlotApi): HTMLElement {
  return api.plot(
    api.dot(api.from('athletes'), { x: 'weight', y: 'id' }),
    api.width(200),
    api.height(120),
  );
}

/** Records the `api` each build received and mounts an empty element. */
function PlotHost(props: {
  factory: VgPlotFactory;
  deps?: ReadonlyArray<unknown>;
  options?: UseVgPlotOptions;
}) {
  const plotRef = useVgPlot(props.factory, props.deps, props.options);
  return <div data-testid="host" ref={plotRef} />;
}

function withProvider(coordinator: Coordinator | null, children: ReactNode) {
  return <MosaicProvider coordinator={coordinator}>{children}</MosaicProvider>;
}

describe('useVgPlot', () => {
  test('mounts a real vgplot element and disconnects its mark clients on unmount', async () => {
    const view = await render(withProvider(db.coordinator, <PlotHost factory={athletesPlot} />), {
      reactStrictMode: true,
    });

    // The dot mark is a MosaicClient connected to the provider's coordinator.
    // StrictMode detaches and re-attaches the ref, so the surviving plot is
    // the second one: exactly one mark client must be live.
    await waitFor(() => {
      expect(db.coordinator.clients.size).toBe(1);
    });
    expect(document.querySelector('.plot')).not.toBeNull();

    await view.unmount();
    expect(db.coordinator.clients.size).toBe(0);
    expect(document.querySelector('.plot')).toBeNull();
  });

  test('passes an API context bound to the provider coordinator, shared per coordinator', async () => {
    const received: Array<VgPlotApi> = [];
    const factory = (api: VgPlotApi) => {
      received.push(api);
      return athletesPlot(api);
    };

    const view = await render(
      withProvider(
        db.coordinator,
        <>
          <PlotHost factory={factory} />
          <PlotHost factory={factory} />
        </>,
      ),
    );

    await waitFor(() => {
      expect(db.coordinator.clients.size).toBe(2);
    });
    expect(received).toHaveLength(2);
    const [first, second] = received;
    // One context per coordinator, so both plots share its namedPlots registry.
    expect(first).toBe(second);
    expect(first?.context.coordinator).toBe(db.coordinator);
    expect(first?.coordinator()).toBe(db.coordinator);
    // The provider's coordinator is not the global one, so the context owns a
    // fresh named-plot registry (createAPIContext's default).
    expect(first?.context.namedPlots).not.toBe(vg.namedPlots);
    for (const client of db.coordinator.clients) {
      expect(client.coordinator).toBe(db.coordinator);
    }

    await view.unmount();
    expect(db.coordinator.clients.size).toBe(0);
  });

  test('binds to the global coordinator (and its named plots) when there is no provider', async () => {
    let received: VgPlotApi | null = null;
    // Return a plain element: nothing connects, so no query reaches the
    // global coordinator's (unconfigured) connector.
    const factory = (api: VgPlotApi) => {
      received = api;
      return document.createElement('div');
    };

    const view = await render(<PlotHost factory={factory} />);

    await waitFor(() => {
      expect(received).not.toBeNull();
    });
    const api = received as VgPlotApi | null;
    expect(api?.context.coordinator).toBe(globalCoordinator());
    // Plots built through the context and through the bare `vg.*` namespace
    // resolve names through the same (global) registry.
    expect(api?.context.namedPlots).toBe(vg.namedPlots);

    await view.unmount();
  });

  test('the coordinator option overrides the provider', async () => {
    const other = await createAthletesDb();
    let received: VgPlotApi | null = null;
    const factory = (api: VgPlotApi) => {
      received = api;
      return athletesPlot(api);
    };

    const view = await render(
      withProvider(
        db.coordinator,
        <PlotHost factory={factory} options={{ coordinator: other.coordinator }} />,
      ),
    );

    await waitFor(() => {
      expect(other.coordinator.clients.size).toBe(1);
    });
    expect(db.coordinator.clients.size).toBe(0);
    expect((received as VgPlotApi | null)?.context.coordinator).toBe(other.coordinator);

    await view.unmount();
    expect(other.coordinator.clients.size).toBe(0);
  });

  test('the coordinator option also works below a null provider boundary', async () => {
    const view = await render(
      withProvider(
        null,
        <PlotHost factory={athletesPlot} options={{ coordinator: db.coordinator }} />,
      ),
    );

    await waitFor(() => {
      expect(db.coordinator.clients.size).toBe(1);
    });

    await view.unmount();
    expect(db.coordinator.clients.size).toBe(0);
  });

  test('rebuilds against the new coordinator when the provider coordinator changes', async () => {
    const next = await createAthletesDb();
    const received: Array<VgPlotApi> = [];
    const factory = (api: VgPlotApi) => {
      received.push(api);
      return athletesPlot(api);
    };

    const view = await render(withProvider(db.coordinator, <PlotHost factory={factory} />));
    await waitFor(() => {
      expect(db.coordinator.clients.size).toBe(1);
    });

    // No explicit deps: the resolved coordinator is an implicit one.
    await view.rerender(withProvider(next.coordinator, <PlotHost factory={factory} />));

    await waitFor(() => {
      expect(next.coordinator.clients.size).toBe(1);
    });
    expect(db.coordinator.clients.size).toBe(0);
    expect(received.at(-1)?.context.coordinator).toBe(next.coordinator);
    expect(document.querySelectorAll('.plot')).toHaveLength(1);

    await view.unmount();
    expect(next.coordinator.clients.size).toBe(0);
  });

  test('zero-argument factories keep working', async () => {
    // The pre-`api` shape: the consumer builds its own context.
    const api = vg.createAPIContext({ coordinator: db.coordinator });
    const zeroArg = (): HTMLElement =>
      api.plot(api.dot(api.from('athletes'), { x: 'weight', y: 'id' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const view = await render(withProvider(db.coordinator, <PlotHost factory={zeroArg} />));

    await waitFor(() => {
      expect(db.coordinator.clients.size).toBe(1);
    });
    // Its marks agree with the provider, so there is nothing to warn about.
    expect(warn).not.toHaveBeenCalled();

    await view.unmount();
    expect(db.coordinator.clients.size).toBe(0);
  });

  test('warns once in development when the marks bind to a different coordinator', async () => {
    const other = await createAthletesDb();
    // Simulates a bare `vg.plot(...)` under a provider: marks land on a
    // coordinator other than the one the hook resolved.
    const foreign = vg.createAPIContext({ coordinator: other.coordinator });
    const mismatched = () => athletesPlot(foreign);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const view = await render(withProvider(db.coordinator, <PlotHost factory={mismatched} />), {
      reactStrictMode: true,
    });

    await waitFor(() => {
      expect(other.coordinator.clients.size).toBe(1);
    });
    // StrictMode builds twice; the hook still warns only once.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/\[react-mosaic\] useVgPlot: 1 of the plot's marks/);

    await view.unmount();
    expect(other.coordinator.clients.size).toBe(0);
  });

  test('does not warn about a deliberate binding passed as the coordinator option', async () => {
    const other = await createAthletesDb();
    const foreign = vg.createAPIContext({ coordinator: other.coordinator });
    const bound = () => athletesPlot(foreign);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const view = await render(
      withProvider(
        db.coordinator,
        <PlotHost factory={bound} options={{ coordinator: other.coordinator }} />,
      ),
    );

    await waitFor(() => {
      expect(other.coordinator.clients.size).toBe(1);
    });
    expect(warn).not.toHaveBeenCalled();

    await view.unmount();
  });

  test('does not warn in production builds', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const other = await createAthletesDb();
    const foreign = vg.createAPIContext({ coordinator: other.coordinator });
    const mismatched = () => athletesPlot(foreign);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const view = await render(withProvider(db.coordinator, <PlotHost factory={mismatched} />));

    await waitFor(() => {
      expect(other.coordinator.clients.size).toBe(1);
    });
    expect(warn).not.toHaveBeenCalled();

    await view.unmount();
  });

  test('deps rebind the plot to the live topology after a StrictMode remount', async () => {
    const config: TopologyConfig = { brush: { type: 'single' } };

    // Record what each factory invocation closed over and which topology the
    // component resolved last — the ones the surviving plot must agree with.
    const captured: Array<Selection> = [];
    let liveTopology: Topology | null = null;

    function TopologyPlotHost() {
      const topology = useTopology(config);
      // oxlint-disable-next-line react/globals -- the test records the last render's topology
      liveTopology = topology;
      const brush = topology.resolve('brush');
      const plotRef = useVgPlot(
        (api) => {
          captured.push(brush);
          return athletesPlot(api);
        },
        [brush],
      );
      return <div data-testid="host" ref={plotRef} />;
    }

    const view = await render(withProvider(db.coordinator, <TopologyPlotHost />), {
      reactStrictMode: true,
    });

    // StrictMode's simulated remount re-attaches the plot BEFORE the revived
    // topology's re-render, so an attach-time build captures the destroyed
    // topology's Selection. The deps rebuild must run afterwards, leaving the
    // surviving plot bound to the Selection the live topology resolves.
    await waitFor(() => {
      const topology = liveTopology;
      expect(topology).not.toBeNull();
      expect(captured.at(-1)).toBe(topology?.resolve('brush'));
    });
    // The rebuild replaced the stale plot rather than stacking a second one.
    expect(db.coordinator.clients.size).toBe(1);
    expect(document.querySelectorAll('.plot')).toHaveLength(1);

    await view.unmount();
    expect(db.coordinator.clients.size).toBe(0);
  });

  test('types the factory api', () => {
    expectTypeOf<VgPlotApi['plot']>().returns.toEqualTypeOf<HTMLElement>();
    expectTypeOf<VgPlotApi['coordinator']>().returns.toEqualTypeOf<Coordinator>();
    expectTypeOf<VgPlotApi['context']['coordinator']>().toEqualTypeOf<Coordinator>();
    expectTypeOf<VgPlotApi['Selection']>().toEqualTypeOf<typeof vg.Selection>();
    // Package-level exports are not part of an API context object.
    expectTypeOf<VgPlotApi>().not.toHaveProperty('createAPIContext');
    expectTypeOf<VgPlotApi>().not.toHaveProperty('Coordinator');
    // A zero-argument factory is still a valid factory.
    expectTypeOf<() => HTMLElement>().toExtend<VgPlotFactory>();
  });
});

/**
 * Mirrors `ModuleOnlyExport` in `src/vgplot/api-context.ts`. The type-level
 * assertion below ties the two together; the runtime assertion catches an
 * installed vgplot whose API context no longer matches that list.
 */
const moduleOnlyExports = [
  'Coordinator',
  'MosaicClient',
  'RestConnector',
  'SocketConnector',
  'DuckDBWASMConnector',
  'restConnector',
  'socketConnector',
  'wasmConnector',
  'namedPlots',
  'requestNamedPlot',
  'connect',
  'createAPIContext',
  'attributeDirectives',
  'markDirectives',
  'interactorDirectives',
  'legendDirectives',
  'coordinator',
] as const;

describe('VgPlotApi drift guard', () => {
  test('the typed surface is the vgplot module minus the module-only exports', () => {
    expectTypeOf<Exclude<keyof VgPlotApi, 'coordinator' | 'context'>>().toEqualTypeOf<
      Exclude<keyof typeof vg, (typeof moduleOnlyExports)[number]>
    >();
  });

  test("createAPIContext's keys match the typed surface of the installed vgplot", () => {
    const moduleOnly = new Set<string>(moduleOnlyExports);
    const expected = Object.keys(vg)
      .filter((key) => !moduleOnly.has(key))
      .concat(['coordinator', 'context'])
      .sort();
    const actual = Object.keys(vg.createAPIContext({ coordinator: db.coordinator })).sort();

    expect(actual).toEqual(expected);
  });
});
