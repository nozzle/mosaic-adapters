import { createAPIContext } from '@uwdata/vgplot';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  createAthletesDb,
  render,
  waitFor,
} from '@nozzleio/test-support/react';
import { useTopology, useVgPlot } from '../src/index';
import type { TestDb } from '@nozzleio/test-support/react';
import type { Selection } from '@uwdata/mosaic-core';
import type { Topology, TopologyConfig } from '../src/index';

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

describe('useVgPlot', () => {
  test('mounts a real vgplot element and disconnects its mark clients on unmount', async () => {
    // API context bound to the test coordinator — the same wiring an app
    // would use instead of the global default coordinator.
    const vg = createAPIContext({ coordinator: db.coordinator });

    function PlotHost() {
      const plotRef = useVgPlot(() =>
        vg.plot(
          vg.dot(vg.from('athletes'), { x: 'weight', y: 'id' }),
          vg.width(200),
          vg.height(120),
        ),
      );
      return <div data-testid="host" ref={plotRef} />;
    }

    const view = await render(<PlotHost />, { reactStrictMode: true });

    // The dot mark is a MosaicClient connected to the coordinator. StrictMode
    // detaches and re-attaches the ref, so the surviving plot is the second
    // one: exactly one mark client must be live.
    await waitFor(() => {
      expect(db.coordinator.clients.size).toBe(1);
    });
    expect(document.querySelector('.plot')).not.toBeNull();

    await view.unmount();
    expect(db.coordinator.clients.size).toBe(0);
    expect(document.querySelector('.plot')).toBeNull();
  });

  test('deps rebind the plot to the live topology after a StrictMode remount', async () => {
    const vg = createAPIContext({ coordinator: db.coordinator });
    const config: TopologyConfig = { brush: { type: 'single' } };

    // Record what each factory invocation closed over and which topology the
    // component resolved last — the ones the surviving plot must agree with.
    const captured: Array<Selection> = [];
    let liveTopology: Topology | null = null;

    function PlotHost() {
      const topology = useTopology(config);
      liveTopology = topology;
      const brush = topology.resolve('brush');
      const plotRef = useVgPlot(() => {
        captured.push(brush);
        return vg.plot(
          vg.dot(vg.from('athletes'), { x: 'weight', y: 'id' }),
          vg.width(200),
          vg.height(120),
        );
      }, [brush]);
      return <div data-testid="host" ref={plotRef} />;
    }

    const view = await render(<PlotHost />, { reactStrictMode: true });

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
});
