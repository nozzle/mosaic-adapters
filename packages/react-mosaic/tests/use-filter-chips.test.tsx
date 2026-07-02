import { Selection, clauseMatch, clausePoints } from '@uwdata/mosaic-core';
import { describe, expect, test } from 'vitest';

import {
  createFilterRegistry,
  useFilterChips,
  useMosaicSelectionValue,
} from '../src/index';
import { actWaitFor, renderHook } from './test-utils';

describe('useFilterChips', () => {
  test('re-renders with the registry store and reflects chip removal', async () => {
    const registry = createFilterRegistry();
    registry.registerGroup({ id: 'global', label: 'Global', priority: 1 });
    const $phrase = Selection.intersect();
    registry.register($phrase, { group: 'global', label: 'Keyword' });

    const hook = await renderHook(() => useFilterChips(registry), {
      initialProps: {},
      strict: true,
    });
    expect(hook.result.current).toHaveLength(0);

    $phrase.update(clauseMatch('phrase', 'stove', { source: {} }));
    await actWaitFor(() => {
      expect(hook.result.current).toHaveLength(1);
    });
    expect(hook.result.current[0]!.label).toBe('Keyword');

    registry.removeChip(hook.result.current[0]!);
    await actWaitFor(() => {
      expect(hook.result.current).toHaveLength(0);
    });

    await hook.unmount();
    registry.destroy();
  });
});

describe('useMosaicSelectionValue', () => {
  test('tracks the published clause value, scoped by source', async () => {
    const $sel = Selection.intersect();
    const stableSource = {};

    const hook = await renderHook(
      () =>
        useMosaicSelectionValue<Array<Array<unknown>>>($sel, {
          source: stableSource,
        }),
      { initialProps: {}, strict: true },
    );
    expect(hook.result.current).toBeNull();

    $sel.update(
      clausePoints(['phrase'], [['gaz stove']], { source: stableSource }),
    );
    await actWaitFor(() => {
      expect(hook.result.current).toEqual([['gaz stove']]);
    });

    // A different source's clause never bleeds into the scoped read.
    $sel.update(clauseMatch('phrase', 'oven', { source: {} }));
    await actWaitFor(() => {
      expect($sel.clauses).toHaveLength(2);
    });
    expect(hook.result.current).toEqual([['gaz stove']]);

    // External reset clears the read-back.
    $sel.reset();
    await actWaitFor(() => {
      expect(hook.result.current).toBeNull();
    });

    await hook.unmount();
  });
});
