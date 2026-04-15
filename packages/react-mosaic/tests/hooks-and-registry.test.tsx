import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { MosaicClient, Selection, clausePoint } from '@uwdata/mosaic-core';

import { useMosaicSelectionValue } from '../src/hooks/use-mosaic-selection-value';
import {
  useCascadingContexts,
  useComposedSelection,
  useMosaicSelections,
} from '../src/hooks/use-topology-helpers';
import {
  SelectionRegistryProvider,
  useSelectionRegistry,
} from '../src/selection-registry';
import { useRegisterSelections } from '../src/hooks/use-register-selections';
import { flushEffects, render } from './test-utils';

function updateSelection(
  selection: Selection,
  value: unknown,
  reset?: () => void,
) {
  selection.update(
    clausePoint('value', value, {
      source: reset ? { reset } : {},
    }),
  );
}

class TestClient extends MosaicClient {
  override query() {
    return null;
  }
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

  test('useMosaicSelectionValue reads a source-scoped snapshot when provided', async () => {
    const selection = Selection.intersect();
    const firstSource = new TestClient();
    const secondSource = new TestClient();
    const values: Array<string | null> = [];

    selection.update(
      clausePoint('value', 'first-scoped', { source: firstSource }),
    );
    selection.update(
      clausePoint('value', 'second-scoped', { source: secondSource }),
    );
    await flushEffects();

    function Probe({ source }: { source: MosaicClient }) {
      const value = useMosaicSelectionValue<string>(selection, { source });
      values.push(value);
      return null;
    }

    const view = render(<Probe source={firstSource} />);
    view.rerender(<Probe source={secondSource} />);
    await flushEffects();

    expect(values.at(-1)).toBe('second-scoped');

    view.unmount();
  });

  test('useCascadingContexts rewires external selections when identities change with the same array length', async () => {
    const externalOne = Selection.intersect();
    const externalTwo = Selection.intersect();

    const probeState: {
      currentContexts?: ReturnType<
        typeof useCascadingContexts<'left' | 'right'>
      >;
    } = {};

    function Probe({ external }: { external: Selection }) {
      const inputs = useMosaicSelections(['left', 'right'] as const);
      const contexts = useCascadingContexts(inputs, [external]);

      React.useEffect(() => {
        probeState.currentContexts = contexts;
      }, [contexts]);

      return null;
    }

    const view = render(<Probe external={externalOne} />);

    updateSelection(externalOne, 'first-external');
    await flushEffects();
    expect(probeState.currentContexts?.left.value).toBe('first-external');

    view.rerender(<Probe external={externalTwo} />);

    updateSelection(externalTwo, 'second-external');
    await flushEffects();
    expect(probeState.currentContexts?.left.value).toBe('second-external');

    updateSelection(externalOne, 'stale-external');
    await flushEffects();
    expect(probeState.currentContexts?.left.value).toBe('second-external');
    expect(
      probeState.currentContexts?.left.clauses.map((clause) => clause.value),
    ).toEqual(['second-external']);

    view.unmount();
  });

  test('useCascadingContexts stays attached under StrictMode effect replay', async () => {
    const probeState: {
      contexts?: ReturnType<typeof useCascadingContexts<'left' | 'right'>>;
      inputs?: ReturnType<typeof useMosaicSelections<'left' | 'right'>>;
    } = {};

    function Probe() {
      const inputs = useMosaicSelections(['left', 'right'] as const);
      const contexts = useCascadingContexts(inputs);

      React.useEffect(() => {
        probeState.contexts = contexts;
        probeState.inputs = inputs;
      }, [contexts, inputs]);

      return null;
    }

    const view = render(
      <React.StrictMode>
        <Probe />
      </React.StrictMode>,
    );
    await flushEffects();

    updateSelection(probeState.inputs!.right, 'strict-mode');
    await flushEffects();

    expect(probeState.contexts?.left.value).toBe('strict-mode');

    view.unmount();
  });

  test('useComposedSelection seeds already-active upstream selections on mount', async () => {
    const page = Selection.intersect();
    const widget = Selection.intersect();
    const probeState: {
      context?: Selection;
    } = {};

    updateSelection(page, 'page-active');
    updateSelection(widget, 'widget-active');

    function Probe() {
      const context = useComposedSelection([page, widget]);

      React.useEffect(() => {
        probeState.context = context;
      }, [context]);

      return null;
    }

    const view = render(<Probe />);
    await flushEffects();

    expect(probeState.context?.clauses.map((clause) => clause.value)).toEqual([
      'page-active',
      'widget-active',
    ]);

    view.unmount();
  });
});

describe('selection registry', () => {
  test('resetAll ignores selections that have been unregistered on unmount', () => {
    const selection = Selection.intersect();
    const resetSpy = vi.fn();
    const controlsState: {
      resetAll?: () => void;
    } = {};

    function Controls() {
      const { resetAll } = useSelectionRegistry();

      React.useEffect(() => {
        controlsState.resetAll = resetAll;
      }, [resetAll]);

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

    controlsState.resetAll?.();

    expect(resetSpy).not.toHaveBeenCalled();
    expect(selection.value).toBe('active');

    view.unmount();
  });
});
