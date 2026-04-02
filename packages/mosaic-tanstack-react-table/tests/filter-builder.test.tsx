import * as React from 'react';
import { act } from 'react';
import {
  SelectionRegistryProvider,
  useSelectionRegistry,
} from '@nozzleio/react-mosaic';
import { afterEach, describe, expect, test, vi } from 'vitest';

import * as facetHookModule from '../src/facet-hook';
import {
  useFilterBinding,
  useFilterFacet,
  useMosaicFilters,
} from '../src/index';
import { flushEffects, render } from './test-utils';

import type {
  FilterBinding,
  FilterDefinition,
  FilterRuntime,
} from '../src/index';

describe('filter builder hooks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('useMosaicFilters creates per-filter selections and composes scope context', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'name',
        label: 'Name',
        column: 'name',
        valueKind: 'text',
        operators: ['contains'],
        defaultOperator: 'contains',
      },
      {
        id: 'sport',
        label: 'Sport',
        column: 'sport',
        valueKind: 'facet-single',
        operators: ['is'],
        defaultOperator: 'is',
      },
    ];
    const scopes: Array<ReturnType<typeof useMosaicFilters>> = [];

    function Probe({
      nextDefinitions,
    }: {
      nextDefinitions: Array<FilterDefinition>;
    }) {
      const scope = useMosaicFilters({
        scopeId: 'page',
        definitions: nextDefinitions,
      });

      scopes.push(scope);
      return null;
    }

    const view = render(
      <SelectionRegistryProvider>
        <Probe nextDefinitions={definitions} />
      </SelectionRegistryProvider>,
    );
    await flushEffects();

    const firstScope = scopes.at(-1)!;
    expect(firstScope.getFilter('name')?.selection).toBe(
      firstScope.selections.name,
    );
    expect(firstScope.getFilter('sport')?.selection).toBe(
      firstScope.selections.sport,
    );

    view.rerender(
      <SelectionRegistryProvider>
        <Probe nextDefinitions={[...definitions]} />
      </SelectionRegistryProvider>,
    );
    await flushEffects();

    const secondScope = scopes.at(-1)!;
    expect(secondScope.selections.name).toBe(firstScope.selections.name);
    expect(secondScope.selections.sport).toBe(firstScope.selections.sport);
    expect(secondScope.context).toBe(firstScope.context);
    const predicate = secondScope.context.predicate(null);
    expect(predicate).toEqual([]);

    const emptyScopes: Array<ReturnType<typeof useMosaicFilters>> = [];

    function EmptyProbe() {
      const scope = useMosaicFilters({
        scopeId: 'empty',
        definitions: [],
      });

      emptyScopes.push(scope);
      return null;
    }

    view.rerender(
      <SelectionRegistryProvider>
        <EmptyProbe />
      </SelectionRegistryProvider>,
    );
    await flushEffects();

    expect(emptyScopes.at(-1)?.context).toBeDefined();
    view.unmount();
  });

  test('useMosaicFilters scope context stays reactive under StrictMode', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'sport',
        label: 'Sport',
        column: 'sport',
        valueKind: 'facet-single',
        operators: ['is'],
        defaultOperator: 'is',
      },
    ];
    const probeState: {
      binding?: FilterBinding;
      contextSelection?: ReturnType<typeof useMosaicFilters>['context'];
      runtime?: FilterRuntime;
    } = {};

    function Probe() {
      const scope = useMosaicFilters({
        scopeId: 'page',
        definitions,
      });
      const runtime = scope.getFilter('sport');
      const binding = useFilterBinding(runtime!);

      React.useEffect(() => {
        probeState.binding = binding;
        probeState.contextSelection = scope.context;
        probeState.runtime = runtime;
      }, [binding, runtime, scope.context]);

      return null;
    }

    const view = render(
      <React.StrictMode>
        <SelectionRegistryProvider>
          <Probe />
        </SelectionRegistryProvider>
      </React.StrictMode>,
    );
    await flushEffects();

    act(() => {
      probeState.binding?.setValue('basketball');
    });
    await flushEffects();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.value).toMatchObject({
      mode: 'CONDITION',
      operator: 'is',
      value: 'basketball',
    });
    expect(probeState.contextSelection?.predicate(null)?.toString()).toContain(
      'sport',
    );

    view.unmount();
  });

  test('useFilterBinding applies conditions and syncs with global reset', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'created_at',
        label: 'Created',
        column: 'created_at',
        valueKind: 'date-range',
        operators: ['between', 'before', 'after', 'is_empty'],
        defaultOperator: 'between',
        dataType: 'date',
      },
    ];
    const probeState: {
      binding?: FilterBinding;
      resetAll?: () => void;
      runtime?: FilterRuntime;
    } = {};

    function RegistryProbe() {
      const resetAll = useSelectionRegistry().resetAll;
      const scope = useMosaicFilters({
        scopeId: 'page',
        definitions,
      });
      const runtime = scope.getFilter('created_at');
      const binding = useFilterBinding(runtime!);

      React.useEffect(() => {
        probeState.binding = binding;
        probeState.resetAll = resetAll;
        probeState.runtime = runtime;
      }, [binding, resetAll, runtime]);

      return null;
    }

    const view = render(
      <SelectionRegistryProvider>
        <RegistryProbe />
      </SelectionRegistryProvider>,
    );
    await flushEffects();

    act(() => {
      probeState.binding?.setValue(['2024-01-01', '2024-12-31']);
    });
    await flushEffects();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.value).toMatchObject({
      mode: 'CONDITION',
      operator: 'between',
      value: ['2024-01-01', '2024-12-31'],
    });
    expect(probeState.runtime?.selection.predicate(null)?.toString()).toContain(
      'created_at',
    );

    act(() => {
      probeState.resetAll?.();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.value ?? null).toBeNull();
    expect(probeState.binding?.value).toEqual([null, null]);

    act(() => {
      probeState.binding?.setOperator('is_empty');
    });
    await flushEffects();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.value).toMatchObject({
      mode: 'CONDITION',
      operator: 'is_empty',
    });

    act(() => {
      probeState.binding?.clear();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.value).toBeNull();
    view.unmount();
  });

  test('useFilterBinding keeps falsy comparable values when applying number ranges', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'gold',
        label: 'Gold',
        column: 'gold',
        valueKind: 'number-range',
        operators: ['between', 'after'],
        defaultOperator: 'between',
        dataType: 'number',
      },
    ];
    const probeState: {
      binding?: FilterBinding;
      runtime?: FilterRuntime;
    } = {};

    function Probe() {
      const scope = useMosaicFilters({
        scopeId: 'widget',
        definitions,
      });
      const runtime = scope.getFilter('gold');
      const binding = useFilterBinding(runtime!);

      React.useEffect(() => {
        probeState.binding = binding;
        probeState.runtime = runtime;
      }, [binding, runtime]);

      return null;
    }

    const view = render(
      <SelectionRegistryProvider>
        <Probe />
      </SelectionRegistryProvider>,
    );
    await flushEffects();

    act(() => {
      probeState.binding?.setValue([0, 5]);
    });
    await flushEffects();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.value).toMatchObject({
      mode: 'CONDITION',
      operator: 'between',
      value: [0, 5],
    });
    expect(probeState.runtime?.selection.predicate(null)?.toString()).toContain(
      'BETWEEN 0 AND 5',
    );

    act(() => {
      probeState.binding?.setOperator('after');
    });
    await flushEffects();

    act(() => {
      probeState.binding?.setValue([0, null]);
    });
    await flushEffects();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.value).toMatchObject({
      operator: 'after',
      value: [0, null],
    });
    expect(probeState.runtime?.selection.predicate(null)?.toString()).toContain(
      '> 0',
    );

    view.unmount();
  });

  test('useFilterFacet adapts facet definitions and keeps selected values visible', async () => {
    const setSearchTerm = vi.fn();
    const loadMore = vi.fn();
    const facetSpy = vi.spyOn(facetHookModule, 'useMosaicTableFacetMenu');
    facetSpy.mockReturnValue({
      options: ['Basketball'],
      displayOptions: ['Basketball'],
      loading: false,
      selectedValues: [],
      hasMore: true,
      setSearchTerm,
      toggle: vi.fn(),
      select: vi.fn(),
      clear: vi.fn(),
      loadMore,
      client: {} as never,
    });

    const definitions: Array<FilterDefinition> = [
      {
        id: 'sport',
        label: 'Sport',
        column: 'sport',
        valueKind: 'facet-multi',
        operators: ['is'],
        defaultOperator: 'is',
        facet: {
          table: 'athletes',
          sortMode: 'count',
          limit: 25,
        },
      },
    ];
    const probeState: {
      facet?: ReturnType<typeof useFilterFacet>;
      runtime?: FilterRuntime;
      scopeContext?: FilterRuntime['selection'];
    } = {};

    function Probe() {
      const scope = useMosaicFilters({
        scopeId: 'page',
        definitions,
      });
      const runtime = scope.getFilter('sport');
      const facet = useFilterFacet({
        filter: runtime!,
        filterBy: scope.context,
        enabled: true,
      });

      React.useEffect(() => {
        probeState.facet = facet;
        probeState.runtime = runtime;
        probeState.scopeContext = scope.context;
      }, [facet, runtime, scope.context]);

      return null;
    }

    const view = render(
      <SelectionRegistryProvider>
        <Probe />
      </SelectionRegistryProvider>,
    );
    await flushEffects();

    expect(facetSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'athletes',
        column: 'sport',
        selection: probeState.runtime?.selection,
        filterBy: probeState.scopeContext,
        enabled: true,
        sortMode: 'count',
        limit: 25,
      }),
    );

    act(() => {
      probeState.facet?.toggle('Cycling');
    });
    await flushEffects();

    expect(probeState.runtime?.selection.value).toMatchObject({
      mode: 'CONDITION',
      operator: 'is',
      value: ['Cycling'],
    });
    expect(probeState.facet?.selectedValues).toEqual(['Cycling']);
    expect(probeState.facet?.options).toEqual(['Basketball', 'Cycling']);

    act(() => {
      probeState.facet?.setSearchTerm('cyc');
      probeState.facet?.loadMore();
    });

    expect(setSearchTerm).toHaveBeenCalledWith('cyc');
    expect(loadMore).toHaveBeenCalledTimes(1);

    act(() => {
      probeState.facet?.toggle('Basketball');
    });
    await flushEffects();

    expect(probeState.runtime?.selection.value).toMatchObject({
      value: ['Cycling', 'Basketball'],
    });
    expect(probeState.facet?.selectedValues).toEqual([
      'Cycling',
      'Basketball',
    ]);

    act(() => {
      probeState.facet?.clear();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.value).toBeNull();
    expect(probeState.facet?.selectedValues).toEqual([]);
    view.unmount();
  });
});
