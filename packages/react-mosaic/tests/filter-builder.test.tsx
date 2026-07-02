/**
 * Port of the legacy filter-builder React suite
 * (packages/mosaic-tanstack-react-table/tests/filter-builder.test.tsx at
 * 337eddd) onto the rebuilt @nozzleio/react-mosaic package.
 *
 * Differences from the legacy suite:
 * - Everything imports from '../src/index' (the package re-exports the core
 *   filter-builder API).
 * - SelectionRegistryProvider / useSelectionRegistry are gone (the registry
 *   returns in Phase 6): provider wrappers are dropped, and the
 *   registry-driven "reset all" is replaced with a direct Selection.reset().
 * - useFilterFacet rides the real facet data client, so the facet test runs
 *   against the DuckDB test harness instead of a mocked facet hook.
 */
import * as React from 'react';
import { act } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  MULTISELECT_ARRAY_CONDITIONS,
  MULTISELECT_SCALAR_CONDITIONS,
  MosaicProvider,
  SELECT_CONDITIONS,
  TEXT_CONDITIONS,
  applyFilterSelection,
  useFilterBinding,
  useFilterFacet,
  useMosaicFilters,
} from '../src/index';
import { actWaitFor, createAthletesDb, render, renderHook } from './test-utils';

import type {
  FilterBinding,
  FilterDefinition,
  FilterRuntime,
} from '../src/index';

/** Legacy-harness effect flush: microtasks plus a macrotask, inside act. */
async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

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
        operators: [TEXT_CONDITIONS.CONTAINS],
        defaultOperator: TEXT_CONDITIONS.CONTAINS,
      },
      {
        id: 'sport',
        label: 'Sport',
        column: 'sport',
        valueKind: 'facet-single',
        operators: [SELECT_CONDITIONS.IS],
        defaultOperator: SELECT_CONDITIONS.IS,
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

    const view = await render(<Probe nextDefinitions={definitions} />);
    await flushEffects();

    const firstScope = scopes.at(-1)!;
    expect(firstScope.getFilter('name')?.selection).toBe(
      firstScope.selections.name,
    );
    expect(firstScope.getFilter('sport')?.selection).toBe(
      firstScope.selections.sport,
    );

    await view.rerender(<Probe nextDefinitions={[...definitions]} />);
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

    await view.rerender(<EmptyProbe />);
    await flushEffects();

    expect(emptyScopes.at(-1)?.context).toBeDefined();
    await view.unmount();
  });

  test('useMosaicFilters scope context stays reactive under StrictMode', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'sport',
        label: 'Sport',
        column: 'sport',
        valueKind: 'facet-single',
        operators: [SELECT_CONDITIONS.IS],
        defaultOperator: SELECT_CONDITIONS.IS,
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

    const view = await render(<Probe />, { strict: true });
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

    await view.unmount();
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
      runtime?: FilterRuntime;
    } = {};

    function Probe() {
      const scope = useMosaicFilters({
        scopeId: 'page',
        definitions,
      });
      const runtime = scope.getFilter('created_at');
      const binding = useFilterBinding(runtime!);

      React.useEffect(() => {
        probeState.binding = binding;
        probeState.runtime = runtime;
      }, [binding, runtime]);

      return null;
    }

    const view = await render(<Probe />);
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

    // Ported: the registry-driven resetAll() is gone with the selection
    // registry (returns in Phase 6). The closest equivalent global reset is
    // resetting the filter's Selection directly — Selection.reset() removes
    // all clauses and emits a value event the binding must sync back from.
    act(() => {
      probeState.runtime?.selection.reset();
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
    await view.unmount();
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

    const view = await render(<Probe />);
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

    await view.unmount();
  });

  test('useFilterFacet adapts facet definitions and keeps selected values visible', async () => {
    // Ported: the legacy suite mocked the (now removed) useMosaicTableFacetMenu
    // hook and asserted the forwarded config. The rebuilt useFilterFacet rides
    // the real facet data client, so this runs against the DuckDB harness:
    // the facet config (from/sortMode/limit) is verified through the actual
    // options it produces, and search/loadMore through their observable
    // effects on the option window.
    const db = await createAthletesDb();

    const definitions: Array<FilterDefinition> = [
      {
        id: 'sport',
        label: 'Sport',
        column: 'sport',
        valueKind: 'facet-multi',
        operators: [MULTISELECT_SCALAR_CONDITIONS.IS_ANY_OF],
        defaultOperator: MULTISELECT_SCALAR_CONDITIONS.IS_ANY_OF,
        facet: {
          from: 'athletes',
          sortMode: 'count',
          limit: 1,
        },
      },
    ];

    const hook = await renderHook(
      () => {
        const scope = useMosaicFilters({
          scopeId: 'page',
          definitions,
        });
        const runtime = scope.getFilter('sport')!;
        const facet = useFilterFacet({
          filter: runtime,
          filterBy: scope.context,
          enabled: true,
        });
        return { facet, runtime };
      },
      {
        initialProps: {},
        wrapper: (children) => (
          <MosaicProvider coordinator={db.coordinator}>
            {children}
          </MosaicProvider>
        ),
      },
    );

    // sortMode 'count' orders by frequency; limit 1 cuts the window off.
    await actWaitFor(() => {
      expect(hook.result.current.facet.options).toEqual([
        { value: 'swim', count: 4 },
      ]);
    });
    expect(hook.result.current.facet.hasMore).toBe(true);

    // loadMore widens the window by the configured page size.
    act(() => {
      hook.result.current.facet.loadMore();
    });
    await actWaitFor(() => {
      expect(hook.result.current.facet.options).toEqual([
        { value: 'swim', count: 4 },
        { value: 'run', count: 2 },
      ]);
    });

    act(() => {
      hook.result.current.facet.loadMore();
    });
    await actWaitFor(() => {
      expect(hook.result.current.facet.hasMore).toBe(false);
    });

    // Toggles publish through the filter clause path (stored value + alias).
    act(() => {
      hook.result.current.facet.toggle('run');
    });
    await actWaitFor(() => {
      expect(hook.result.current.runtime.selection.value).toMatchObject({
        mode: 'CONDITION',
        operator: 'is_any_of',
        value: ['run'],
      });
    });
    await actWaitFor(() => {
      expect(hook.result.current.facet.selectedValues).toEqual(['run']);
    });

    // A selected value missing from the cascaded option window is merged in
    // (without a count) so the UI can always render what is selected.
    act(() => {
      hook.result.current.facet.toggle('cycling');
    });
    await actWaitFor(() => {
      expect(hook.result.current.facet.selectedValues).toEqual([
        'run',
        'cycling',
      ]);
    });
    await actWaitFor(() => {
      expect(hook.result.current.facet.options).toEqual([
        { value: 'run', count: 2 },
        { value: 'cycling' },
      ]);
    });

    // Search flows into the facet query; selected values stay visible even
    // when the search filters every database option away.
    act(() => {
      hook.result.current.facet.setSearchTerm('cyc');
    });
    expect(hook.result.current.facet.searchTerm).toBe('cyc');
    await actWaitFor(() => {
      expect(hook.result.current.facet.options).toEqual([
        { value: 'run' },
        { value: 'cycling' },
      ]);
    });

    act(() => {
      hook.result.current.facet.setSearchTerm('');
    });
    await flushEffects();

    act(() => {
      hook.result.current.facet.clear();
    });
    await actWaitFor(() => {
      expect(hook.result.current.runtime.selection.value ?? null).toBeNull();
      expect(hook.result.current.facet.selectedValues).toEqual([]);
    });

    await hook.unmount();
  });

  test('useFilterBinding supports new text condition ids and preserves the stored operator id', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'nickname',
        label: 'Nickname',
        column: 'nickname',
        valueKind: 'text',
        operators: [
          TEXT_CONDITIONS.DOES_NOT_CONTAIN,
          TEXT_CONDITIONS.IS_EXACTLY,
        ],
        defaultOperator: TEXT_CONDITIONS.DOES_NOT_CONTAIN,
      },
    ];
    const probeState: {
      binding?: FilterBinding;
      runtime?: FilterRuntime;
    } = {};

    function Probe() {
      const scope = useMosaicFilters({
        scopeId: 'page',
        definitions,
      });
      const runtime = scope.getFilter('nickname');
      const binding = useFilterBinding(runtime!);

      React.useEffect(() => {
        probeState.binding = binding;
        probeState.runtime = runtime;
      }, [binding, runtime]);

      return null;
    }

    const view = await render(<Probe />);
    await flushEffects();

    act(() => {
      probeState.binding?.setValue('100%_real');
    });
    await flushEffects();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.value).toMatchObject({
      operator: 'does_not_contain',
      value: '100%_real',
    });
    expect(probeState.runtime?.selection.predicate(null)?.toString()).toContain(
      "NOT ILIKE '%100\\%\\_real%'",
    );

    act(() => {
      probeState.binding?.setOperator(TEXT_CONDITIONS.IS_EXACTLY);
    });
    await flushEffects();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.value).toMatchObject({
      operator: 'is_exactly',
      value: '100%_real',
    });
    expect(probeState.runtime?.selection.predicate(null)?.toString()).toContain(
      "= '100%_real'",
    );

    await view.unmount();
  });

  test('useFilterBinding supports scalar multiselect aliases and type-aware empty semantics', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'country',
        label: 'Country',
        column: 'country',
        valueKind: 'facet-multi',
        operators: [
          MULTISELECT_SCALAR_CONDITIONS.IS_ANY_OF,
          MULTISELECT_SCALAR_CONDITIONS.IS_NOT_ANY_OF,
          MULTISELECT_SCALAR_CONDITIONS.IS_EMPTY,
        ],
        defaultOperator: MULTISELECT_SCALAR_CONDITIONS.IS_ANY_OF,
        dataType: 'string',
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
      const runtime = scope.getFilter('country');
      const binding = useFilterBinding(runtime!);

      React.useEffect(() => {
        probeState.binding = binding;
        probeState.runtime = runtime;
      }, [binding, runtime]);

      return null;
    }

    const view = await render(<Probe />);
    await flushEffects();

    act(() => {
      probeState.binding?.setValue(['NZL', 'USA']);
    });
    await flushEffects();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.value).toMatchObject({
      operator: 'is_any_of',
      value: ['NZL', 'USA'],
    });
    expect(probeState.runtime?.selection.predicate(null)?.toString()).toContain(
      'IN',
    );

    act(() => {
      probeState.binding?.setOperator(
        MULTISELECT_SCALAR_CONDITIONS.IS_NOT_ANY_OF,
      );
    });
    await flushEffects();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.value).toMatchObject({
      operator: 'is_not_any_of',
      value: ['NZL', 'USA'],
    });
    expect(probeState.runtime?.selection.predicate(null)?.toString()).toContain(
      'NOT IN',
    );

    act(() => {
      probeState.binding?.setOperator(MULTISELECT_SCALAR_CONDITIONS.IS_EMPTY);
    });
    await flushEffects();

    act(() => {
      probeState.binding?.setValue([]);
    });
    await flushEffects();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.predicate(null)?.toString()).toContain(
      'IS NULL OR',
    );
    expect(probeState.runtime?.selection.predicate(null)?.toString()).toContain(
      "= ''",
    );

    await view.unmount();
  });

  test('useFilterBinding supports array multiselect collection operators', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'tags',
        label: 'Tags',
        column: 'tags',
        valueKind: 'facet-multi',
        columnType: 'array',
        operators: [
          MULTISELECT_ARRAY_CONDITIONS.IS_ANY_OF,
          MULTISELECT_ARRAY_CONDITIONS.INCLUDES_ALL,
          MULTISELECT_ARRAY_CONDITIONS.EXCLUDES_ALL,
          MULTISELECT_ARRAY_CONDITIONS.IS_EMPTY,
        ],
        defaultOperator: MULTISELECT_ARRAY_CONDITIONS.IS_ANY_OF,
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
      const runtime = scope.getFilter('tags');
      const binding = useFilterBinding(runtime!);

      React.useEffect(() => {
        probeState.binding = binding;
        probeState.runtime = runtime;
      }, [binding, runtime]);

      return null;
    }

    const view = await render(<Probe />);
    await flushEffects();

    act(() => {
      probeState.binding?.setValue(['alpha', 'beta']);
    });
    await flushEffects();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.predicate(null)?.toString()).toContain(
      'list_has_any',
    );

    act(() => {
      probeState.binding?.setOperator(
        MULTISELECT_ARRAY_CONDITIONS.INCLUDES_ALL,
      );
    });
    await flushEffects();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.predicate(null)?.toString()).toContain(
      'list_has_all',
    );

    act(() => {
      probeState.binding?.setOperator(
        MULTISELECT_ARRAY_CONDITIONS.EXCLUDES_ALL,
      );
    });
    await flushEffects();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.predicate(null)?.toString()).toContain(
      'NOT (list_has_any',
    );

    act(() => {
      probeState.binding?.setOperator(MULTISELECT_ARRAY_CONDITIONS.IS_EMPTY);
    });
    await flushEffects();

    act(() => {
      probeState.binding?.setValue([]);
    });
    await flushEffects();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(probeState.runtime?.selection.predicate(null)?.toString()).toContain(
      'array_length',
    );

    await view.unmount();
  });

  test('useFilterBinding hydrates from committed selection state before consulting the binding persister', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'name',
        label: 'Name',
        column: 'name',
        valueKind: 'text',
        operators: [TEXT_CONDITIONS.CONTAINS],
        defaultOperator: TEXT_CONDITIONS.CONTAINS,
      },
    ];
    const bindingPersister = {
      read: vi.fn(() => ({
        operator: TEXT_CONDITIONS.CONTAINS,
        value: 'persisted',
        valueTo: null,
      })),
      write: vi.fn(),
    };
    const probeState: {
      binding?: FilterBinding;
      runtime?: FilterRuntime;
    } = {};

    function BindingProbe({ runtime }: { runtime: FilterRuntime }) {
      const binding = useFilterBinding(runtime, {
        persister: bindingPersister,
      });

      React.useEffect(() => {
        probeState.binding = binding;
      }, [binding]);

      return null;
    }

    function Probe({ bind }: { bind: boolean }) {
      const scope = useMosaicFilters({
        scopeId: 'page',
        definitions,
      });
      const runtime = scope.getFilter('name');

      React.useEffect(() => {
        probeState.runtime = runtime;
      }, [runtime]);

      return bind && runtime ? <BindingProbe runtime={runtime} /> : null;
    }

    const view = await render(<Probe bind={false} />);
    await flushEffects();

    act(() => {
      applyFilterSelection(probeState.runtime!, {
        operator: TEXT_CONDITIONS.CONTAINS,
        value: 'committed',
        valueTo: null,
      });
    });
    await flushEffects();

    await view.rerender(<Probe bind />);
    await flushEffects();

    expect(bindingPersister.read).not.toHaveBeenCalled();
    expect(probeState.binding?.value).toBe('committed');
    expect(probeState.runtime?.selection.value).toMatchObject({
      operator: TEXT_CONDITIONS.CONTAINS,
      value: 'committed',
    });

    await view.unmount();
  });

  test('binding persister seeds the committed selection when it starts empty', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'name',
        label: 'Name',
        column: 'name',
        valueKind: 'text',
        operators: [TEXT_CONDITIONS.CONTAINS],
        defaultOperator: TEXT_CONDITIONS.CONTAINS,
      },
    ];
    const bindingPersister = {
      read: vi.fn(() => ({
        operator: TEXT_CONDITIONS.CONTAINS,
        value: 'persisted',
        valueTo: null,
      })),
      write: vi.fn(),
    };
    const probeState: {
      binding?: FilterBinding;
      runtime?: FilterRuntime;
    } = {};

    function Probe() {
      const scope = useMosaicFilters({
        scopeId: 'page',
        definitions,
      });
      const runtime = scope.getFilter('name');
      const binding = useFilterBinding(runtime!, {
        persister: bindingPersister,
      });

      React.useEffect(() => {
        probeState.binding = binding;
        probeState.runtime = runtime;
      }, [binding, runtime]);

      return null;
    }

    const view = await render(<Probe />);
    await flushEffects();

    expect(bindingPersister.read).toHaveBeenCalledTimes(1);
    expect(bindingPersister.write).not.toHaveBeenCalled();
    expect(probeState.binding?.value).toBe('persisted');
    expect(probeState.runtime?.selection.value).toMatchObject({
      operator: TEXT_CONDITIONS.CONTAINS,
      value: 'persisted',
    });

    await view.unmount();
  });

  test('scope persister seeds multiple empty filters from a sparse snapshot', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'name',
        label: 'Name',
        column: 'name',
        valueKind: 'text',
        operators: [TEXT_CONDITIONS.CONTAINS],
        defaultOperator: TEXT_CONDITIONS.CONTAINS,
      },
      {
        id: 'sport',
        label: 'Sport',
        column: 'sport',
        valueKind: 'facet-single',
        operators: [SELECT_CONDITIONS.IS],
        defaultOperator: SELECT_CONDITIONS.IS,
      },
    ];
    const scopePersister = {
      read: vi.fn(() => ({
        name: {
          operator: TEXT_CONDITIONS.CONTAINS,
          value: 'persisted',
          valueTo: null,
        },
        sport: {
          operator: SELECT_CONDITIONS.IS,
          value: 'Basketball',
          valueTo: null,
        },
      })),
      write: vi.fn(),
    };
    const probeState: {
      scope?: ReturnType<typeof useMosaicFilters>;
    } = {};

    function Probe() {
      const scope = useMosaicFilters({
        scopeId: 'page',
        definitions,
        persister: scopePersister,
      });

      React.useEffect(() => {
        probeState.scope = scope;
      }, [scope]);

      return null;
    }

    const view = await render(<Probe />);
    await flushEffects();

    expect(scopePersister.read).toHaveBeenCalledTimes(1);
    expect(scopePersister.write).not.toHaveBeenCalled();
    expect(probeState.scope?.getFilter('name')?.selection.value).toMatchObject({
      operator: TEXT_CONDITIONS.CONTAINS,
      value: 'persisted',
    });
    expect(probeState.scope?.getFilter('sport')?.selection.value).toMatchObject(
      {
        operator: SELECT_CONDITIONS.IS,
        value: 'Basketball',
      },
    );

    await view.unmount();
  });

  test('useFilterBinding reflects scope hydration on the initial mount', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'name',
        label: 'Name',
        column: 'name',
        valueKind: 'text',
        operators: [TEXT_CONDITIONS.CONTAINS],
        defaultOperator: TEXT_CONDITIONS.CONTAINS,
      },
    ];
    const scopePersister = {
      read: vi.fn(() => ({
        name: {
          operator: TEXT_CONDITIONS.CONTAINS,
          value: 'persisted',
          valueTo: null,
        },
      })),
      write: vi.fn(),
    };
    const probeState: {
      binding?: FilterBinding;
      runtime?: FilterRuntime;
    } = {};

    function Probe() {
      const scope = useMosaicFilters({
        scopeId: 'page',
        definitions,
        persister: scopePersister,
      });
      const runtime = scope.getFilter('name');
      const binding = useFilterBinding(runtime!);

      React.useEffect(() => {
        probeState.binding = binding;
        probeState.runtime = runtime;
      }, [binding, runtime]);

      return null;
    }

    const view = await render(<Probe />);
    await flushEffects();

    expect(scopePersister.read).toHaveBeenCalledTimes(1);
    expect(scopePersister.write).not.toHaveBeenCalled();
    expect(probeState.binding?.value).toBe('persisted');
    expect(probeState.runtime?.selection.value).toMatchObject({
      operator: TEXT_CONDITIONS.CONTAINS,
      value: 'persisted',
    });

    await view.unmount();
  });

  test('binding persister overrides scope hydration for the same filter', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'name',
        label: 'Name',
        column: 'name',
        valueKind: 'text',
        operators: [TEXT_CONDITIONS.CONTAINS],
        defaultOperator: TEXT_CONDITIONS.CONTAINS,
      },
    ];
    const bindingPersister = {
      read: vi.fn(() => ({
        operator: TEXT_CONDITIONS.CONTAINS,
        value: 'binding',
        valueTo: null,
      })),
      write: vi.fn(),
    };
    const scopePersister = {
      read: vi.fn(() => ({
        name: {
          operator: TEXT_CONDITIONS.CONTAINS,
          value: 'scope',
          valueTo: null,
        },
      })),
      write: vi.fn(),
    };
    const probeState: {
      binding?: FilterBinding;
      runtime?: FilterRuntime;
    } = {};

    function Probe() {
      const scope = useMosaicFilters({
        scopeId: 'page',
        definitions,
        persister: scopePersister,
      });
      const runtime = scope.getFilter('name');
      const binding = useFilterBinding(runtime!, {
        persister: bindingPersister,
      });

      React.useEffect(() => {
        probeState.binding = binding;
        probeState.runtime = runtime;
      }, [binding, runtime]);

      return null;
    }

    const view = await render(<Probe />);
    await flushEffects();

    expect(probeState.binding?.value).toBe('binding');
    expect(probeState.runtime?.selection.value).toMatchObject({
      operator: TEXT_CONDITIONS.CONTAINS,
      value: 'binding',
    });
    expect(bindingPersister.write).not.toHaveBeenCalled();
    expect(scopePersister.write).not.toHaveBeenCalled();

    await view.unmount();
  });

  test('persisters only write on committed changes and clear removes persisted state', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'name',
        label: 'Name',
        column: 'name',
        valueKind: 'text',
        operators: [TEXT_CONDITIONS.CONTAINS],
        defaultOperator: TEXT_CONDITIONS.CONTAINS,
      },
    ];
    const bindingPersister = {
      read: vi.fn(() => null),
      write: vi.fn(),
    };
    const scopePersister = {
      read: vi.fn(() => null),
      write: vi.fn(),
    };
    const probeState: {
      binding?: FilterBinding;
      runtime?: FilterRuntime;
    } = {};

    function Probe() {
      const scope = useMosaicFilters({
        scopeId: 'page',
        definitions,
        persister: scopePersister,
      });
      const runtime = scope.getFilter('name');
      const binding = useFilterBinding(runtime!, {
        persister: bindingPersister,
      });

      React.useEffect(() => {
        probeState.binding = binding;
        probeState.runtime = runtime;
      }, [binding, runtime]);

      return null;
    }

    const view = await render(<Probe />);
    await flushEffects();

    act(() => {
      probeState.binding?.setValue('draft');
    });
    await flushEffects();

    expect(bindingPersister.write).not.toHaveBeenCalled();
    expect(scopePersister.write).not.toHaveBeenCalled();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(bindingPersister.write).toHaveBeenLastCalledWith(
      {
        operator: TEXT_CONDITIONS.CONTAINS,
        value: 'draft',
        valueTo: null,
      },
      expect.objectContaining({
        filterId: 'name',
        scopeId: 'page',
        reason: 'apply',
      }),
    );
    expect(scopePersister.write).toHaveBeenLastCalledWith(
      {
        name: {
          operator: TEXT_CONDITIONS.CONTAINS,
          value: 'draft',
          valueTo: null,
        },
      },
      expect.objectContaining({
        filterId: 'name',
        scopeId: 'page',
        reason: 'apply',
      }),
    );

    act(() => {
      probeState.binding?.clear();
    });
    await flushEffects();

    expect(bindingPersister.write).toHaveBeenLastCalledWith(
      null,
      expect.objectContaining({
        filterId: 'name',
        scopeId: 'page',
        reason: 'clear',
      }),
    );
    expect(scopePersister.write).toHaveBeenLastCalledWith(
      {},
      expect.objectContaining({
        filterId: 'name',
        scopeId: 'page',
        reason: 'clear',
      }),
    );

    act(() => {
      applyFilterSelection(probeState.runtime!, {
        operator: TEXT_CONDITIONS.CONTAINS,
        value: 'external',
        valueTo: null,
      });
    });
    await flushEffects();

    expect(bindingPersister.write).toHaveBeenLastCalledWith(
      {
        operator: TEXT_CONDITIONS.CONTAINS,
        value: 'external',
        valueTo: null,
      },
      expect.objectContaining({
        filterId: 'name',
        scopeId: 'page',
        reason: 'external',
      }),
    );
    expect(scopePersister.write).toHaveBeenLastCalledWith(
      {
        name: {
          operator: TEXT_CONDITIONS.CONTAINS,
          value: 'external',
          valueTo: null,
        },
      },
      expect.objectContaining({
        filterId: 'name',
        scopeId: 'page',
        reason: 'external',
      }),
    );

    await view.unmount();
  });

  test('StrictMode hydration does not double-write persisted state', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'name',
        label: 'Name',
        column: 'name',
        valueKind: 'text',
        operators: [TEXT_CONDITIONS.CONTAINS],
        defaultOperator: TEXT_CONDITIONS.CONTAINS,
      },
    ];
    const bindingPersister = {
      read: vi.fn(() => ({
        operator: TEXT_CONDITIONS.CONTAINS,
        value: 'persisted',
        valueTo: null,
      })),
      write: vi.fn(),
    };
    const scopePersister = {
      read: vi.fn(() => ({
        name: {
          operator: TEXT_CONDITIONS.CONTAINS,
          value: 'scope',
          valueTo: null,
        },
      })),
      write: vi.fn(),
    };
    const probeState: {
      binding?: FilterBinding;
    } = {};

    function Probe() {
      const scope = useMosaicFilters({
        scopeId: 'page',
        definitions,
        persister: scopePersister,
      });
      const runtime = scope.getFilter('name');
      const binding = useFilterBinding(runtime!, {
        persister: bindingPersister,
      });

      React.useEffect(() => {
        probeState.binding = binding;
      }, [binding]);

      return null;
    }

    const view = await render(<Probe />, { strict: true });
    await flushEffects();

    expect(bindingPersister.write).not.toHaveBeenCalled();
    expect(scopePersister.write).not.toHaveBeenCalled();

    act(() => {
      probeState.binding?.setValue('applied');
    });
    await flushEffects();

    act(() => {
      probeState.binding?.apply();
    });
    await flushEffects();

    expect(bindingPersister.write).toHaveBeenCalledTimes(1);
    expect(scopePersister.write).toHaveBeenCalledTimes(1);

    await view.unmount();
  });

  test('useFilterBinding balances selection subscriptions under StrictMode', async () => {
    const definitions: Array<FilterDefinition> = [
      {
        id: 'sport',
        label: 'Sport',
        column: 'sport',
        valueKind: 'facet-single',
        operators: [SELECT_CONDITIONS.IS],
        defaultOperator: SELECT_CONDITIONS.IS,
      },
    ];
    const probeState: {
      runtime?: FilterRuntime;
    } = {};

    function BindingProbe({ runtime }: { runtime: FilterRuntime }) {
      useFilterBinding(runtime);
      return null;
    }

    function Probe({ showBinding }: { showBinding: boolean }) {
      const scope = useMosaicFilters({
        scopeId: 'page',
        definitions,
      });
      const runtime = scope.getFilter('sport');

      React.useEffect(() => {
        probeState.runtime = runtime;
      }, [runtime]);

      if (!showBinding || !runtime) {
        return null;
      }

      return <BindingProbe runtime={runtime} />;
    }

    const view = await render(<Probe showBinding={false} />, { strict: true });
    await flushEffects();

    const selection = probeState.runtime?.selection;
    expect(selection).toBeDefined();

    const addSpy = vi.spyOn(selection!, 'addEventListener');
    const removeSpy = vi.spyOn(selection!, 'removeEventListener');

    await view.rerender(<Probe showBinding={true} />);
    await flushEffects();

    await view.unmount();

    const addValueCalls = addSpy.mock.calls.filter(
      ([eventName]) => eventName === 'value',
    ).length;
    const removeValueCalls = removeSpy.mock.calls.filter(
      ([eventName]) => eventName === 'value',
    ).length;

    expect(addValueCalls).toBeGreaterThan(0);
    expect(removeValueCalls).toBe(addValueCalls);
  });
});
