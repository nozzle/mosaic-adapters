import { createAPIContext } from '@uwdata/vgplot';
import { beforeEach, describe, expect, test } from 'vitest';

import { useVgPlot } from '../src/index';
import { actWaitFor, createAthletesDb, render } from './test-utils';
import type { TestDb } from './test-utils';

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

    const view = await render(<PlotHost />, { strict: true });

    // The dot mark is a MosaicClient connected to the coordinator. StrictMode
    // detaches and re-attaches the ref, so the surviving plot is the second
    // one: exactly one mark client must be live.
    await actWaitFor(() => {
      expect(db.coordinator.clients.size).toBe(1);
    });
    expect(document.querySelector('.plot')).not.toBeNull();

    await view.unmount();
    expect(db.coordinator.clients.size).toBe(0);
    expect(document.querySelector('.plot')).toBeNull();
  });
});
