import { describe, expect, test, vi } from 'vitest';
import { clausePoint, Selection } from '@uwdata/mosaic-core';

import { useMosaicSelectionValue } from '../src/hooks/use-mosaic-selection-value';
import {
  useCascadingContexts,
  useMosaicSelections,
} from '../src/hooks/use-topology-helpers';
import {
  SelectionRegistryProvider,
  useSelectionRegistry,
} from '../src/selection-registry';
import { useRegisterSelections } from '../src/hooks/use-register-selections';
import { flushEffects, render } from './test-utils';

function updateSelection(selection: Selection, value: unknown, reset?: () => void) {
  selection.update(
    clausePoint('value', value, {
      source: reset ? { reset } : {},
    }),
  );
}

describe('selection hooks', () => {
  test('useMosaicSelectionValue switches snapshots when the selection instance changes', async () => {
    const first = Selection.intersect();
    const second = Selection.intersect();
    updateSelection(first, 'first');
    updateSelection(second, 'second');
    await flushEffects();

    const values: Array<string | null> = [];

    function Probe({ selection }: { selection: Selection }) {
      const value = useMosaicSelectionValue<string>(selection);
      values.push(value);
      return null;
    }

    const view = render(<Probe selection={first} />);
    view.rerender(<Probe selection={second} />);
    await flushEffects();

    expect(values.at(-1)).toBe('second');

    view.unmount();
  });

  test('useCascadingContexts rewires external selections when identities change with the same array length', async () => {
    const externalOne = Selection.intersect();
    const externalTwo = Selection.intersect();

    let currentContexts:
      | ReturnType<typeof useCascadingContexts<'left' | 'right'>>
      | undefined;

    function Probe({ external }: { external: Selection }) {
      const inputs = useMosaicSelections(['left', 'right'] as const);
      currentContexts = useCascadingContexts(inputs, [external]);
      return null;
    }

    const view = render(<Probe external={externalOne} />);

    updateSelection(externalOne, 'first-external');
    await flushEffects();
    expect(currentContexts?.left.value).toBe('first-external');

    view.rerender(<Probe external={externalTwo} />);

    updateSelection(externalTwo, 'second-external');
    await flushEffects();
    expect(currentContexts?.left.value).toBe('second-external');

    updateSelection(externalOne, 'stale-external');
    await flushEffects();
    expect(currentContexts?.left.value).toBe('second-external');

    view.unmount();
  });
});

describe('selection registry', () => {
  test('resetAll ignores selections that have been unregistered on unmount', () => {
    const selection = Selection.intersect();
    const resetSpy = vi.fn();
    let resetAll: (() => void) | undefined;

    function Controls() {
      resetAll = useSelectionRegistry().resetAll;
      return null;
    }

    function RegisteredSelection() {
      useRegisterSelections([selection]);
      return null;
    }

    const view = render(
      <SelectionRegistryProvider>
        <Controls />
        <RegisteredSelection />
      </SelectionRegistryProvider>,
    );

    updateSelection(selection, 'active', resetSpy);
    expect(selection.value).toBe('active');
    view.rerender(
      <SelectionRegistryProvider>
        <Controls />
      </SelectionRegistryProvider>,
    );

    resetAll?.();

    expect(resetSpy).not.toHaveBeenCalled();
    expect(selection.value).toBe('active');

    view.unmount();
  });
});
