import * as React from 'react';
import { act } from 'react';
import { clausePoint, Selection } from '@uwdata/mosaic-core';
import { describe, expect, test } from 'vitest';

import {
  MosaicFilterProvider,
  useActiveFilters,
  useFilterRegistry,
  useRegisterFilterSource,
} from '../src/index';
import { flushEffects, render } from './test-utils';

function updateSelection(
  selection: Selection,
  source: { column: string },
  value: unknown,
) {
  selection.update(clausePoint(source.column, value, { source }));
}

describe('active filter hooks', () => {
  test('register selections and expose narrowed registry actions for removal and clearing', async () => {
    const citySelection = Selection.intersect();
    const statusSelection = Selection.intersect();
    const snapshots: Array<Array<{ label: string; value: unknown }>> = [];
    let registry: ReturnType<typeof useFilterRegistry> | undefined;
    let latestFilters: ReturnType<typeof useActiveFilters> = [];

    function Probe() {
      registry = useFilterRegistry();
      const activeFilters = useActiveFilters();

      latestFilters = activeFilters;
      snapshots.push(
        activeFilters.map((filter) => ({
          label: filter.label,
          value: filter.value,
        })),
      );

      useRegisterFilterSource(citySelection, 'global', {
        labelMap: { city: 'City' },
      });
      useRegisterFilterSource(statusSelection, 'global', {
        labelMap: { status: 'Status' },
      });

      React.useEffect(() => {
        registry?.registerGroup({
          id: 'global',
          label: 'Global',
          priority: 1,
        });
      }, [registry]);

      return null;
    }

    const view = render(
      <MosaicFilterProvider>
        <Probe />
      </MosaicFilterProvider>,
    );
    await flushEffects();

    await act(async () => {
      updateSelection(citySelection, { column: 'city' }, 'Auckland');
      updateSelection(statusSelection, { column: 'status' }, 'active');
    });
    await flushEffects();

    expect(snapshots.at(-1)).toEqual([
      { label: 'City', value: 'Auckland' },
      { label: 'Status', value: 'active' },
    ]);

    const cityFilter = latestFilters.find((filter) => filter.label === 'City');
    if (!cityFilter) {
      throw new Error('Expected the City filter to be active.');
    }

    await act(async () => {
      registry?.removeFilter(cityFilter);
    });
    await flushEffects();

    expect(citySelection.value).toBeNull();
    expect(latestFilters.map((filter) => filter.label)).toEqual(['Status']);

    await act(async () => {
      registry?.clearGroup('global');
    });
    await flushEffects();

    expect(statusSelection.value).toBeNull();
    expect(latestFilters).toEqual([]);

    view.unmount();
  });
});
