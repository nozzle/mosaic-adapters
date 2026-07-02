import { Selection } from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';

import {
  DATE_RANGE_CONDITIONS,
  FilterBindingController,
  MULTISELECT_ARRAY_CONDITIONS,
  MULTISELECT_SCALAR_CONDITIONS,
  NUMBER_CONDITIONS,
  NUMBER_RANGE_CONDITIONS,
  SELECT_CONDITIONS,
  TEXT_CONDITIONS,
  applyFilterSelection,
  clearFilterSelection,
  createEmptyFilterBindingState,
  getFacetSelectedValues,
  normalizeFilterBindingState,
  readFilterSelectionState,
  reapplyCommittedFilterSelection,
} from '../src/filter-builder/index';

import type {
  FilterBindingState,
  FilterDefinition,
  FilterRuntime,
} from '../src/filter-builder/index';

const textDefinition: FilterDefinition = {
  id: 'name',
  label: 'Name',
  column: 'name',
  valueKind: 'text',
  operators: [
    TEXT_CONDITIONS.CONTAINS,
    TEXT_CONDITIONS.DOES_NOT_CONTAIN,
    TEXT_CONDITIONS.IS_EXACTLY,
    TEXT_CONDITIONS.IS_EMPTY,
  ],
  defaultOperator: TEXT_CONDITIONS.CONTAINS,
};

const facetSingleDefinition: FilterDefinition = {
  id: 'sport',
  label: 'Sport',
  column: 'sport',
  valueKind: 'facet-single',
  operators: [SELECT_CONDITIONS.IS],
  defaultOperator: SELECT_CONDITIONS.IS,
};

const scalarFacetDefinition: FilterDefinition = {
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
};

const arrayFacetDefinition: FilterDefinition = {
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
};

const dateRangeDefinition: FilterDefinition = {
  id: 'created_at',
  label: 'Created',
  column: 'created_at',
  valueKind: 'date-range',
  operators: [
    DATE_RANGE_CONDITIONS.BETWEEN,
    DATE_RANGE_CONDITIONS.AFTER,
    DATE_RANGE_CONDITIONS.BEFORE,
  ],
  defaultOperator: DATE_RANGE_CONDITIONS.BETWEEN,
  dataType: 'date',
};

const numberRangeDefinition: FilterDefinition = {
  id: 'gold',
  label: 'Gold',
  column: 'gold',
  valueKind: 'number-range',
  operators: [NUMBER_RANGE_CONDITIONS.BETWEEN, NUMBER_RANGE_CONDITIONS.AFTER],
  defaultOperator: NUMBER_RANGE_CONDITIONS.BETWEEN,
  dataType: 'number',
};

function createRuntime(
  definition: FilterDefinition,
  scopeId = 'scope',
): FilterRuntime {
  return {
    definition,
    scopeId,
    selection: Selection.intersect(),
  };
}

function setStoredSelection(runtime: FilterRuntime, state: FilterBindingState) {
  applyFilterSelection(runtime, state);
}

function getPredicateText(runtime: FilterRuntime) {
  return runtime.selection.predicate(null)?.toString() ?? '';
}

async function flushMicrotask() {
  await Promise.resolve();
}

function getTestPredicate() {
  return mSql.eq(mSql.literal(1), mSql.literal(1));
}

function createForeignSource(id: string) {
  return { id } as never;
}

function createFilterBuilderSource(runtime: FilterRuntime) {
  return {
    id: `filter-builder:${runtime.scopeId}:${runtime.definition.id}`,
    column: runtime.definition.column,
    debugName: `filter-builder:${runtime.scopeId}:${runtime.definition.id}`,
    filterId: runtime.definition.id,
    scopeId: runtime.scopeId,
  } as never;
}

describe('filter-builder helpers', () => {
  test('normalizeFilterBindingState returns default state for null and undefined selection values', () => {
    expect(normalizeFilterBindingState(textDefinition, null)).toEqual(
      createEmptyFilterBindingState(textDefinition),
    );
    expect(normalizeFilterBindingState(textDefinition, undefined)).toEqual(
      createEmptyFilterBindingState(textDefinition),
    );
  });

  test('stored CONDITION values are rehydrated across supported definition shapes', () => {
    expect(
      normalizeFilterBindingState(textDefinition, {
        mode: 'CONDITION',
        operator: TEXT_CONDITIONS.DOES_NOT_CONTAIN,
        value: 'ali',
        filterId: textDefinition.id,
        scopeId: 'scope',
      }),
    ).toEqual({
      operator: TEXT_CONDITIONS.DOES_NOT_CONTAIN,
      value: 'ali',
      valueTo: null,
    });

    expect(
      normalizeFilterBindingState(facetSingleDefinition, {
        mode: 'CONDITION',
        operator: SELECT_CONDITIONS.IS,
        value: ['basketball'],
        filterId: facetSingleDefinition.id,
        scopeId: 'scope',
      }),
    ).toEqual({
      operator: SELECT_CONDITIONS.IS,
      value: 'basketball',
      valueTo: null,
    });

    expect(
      normalizeFilterBindingState(scalarFacetDefinition, {
        mode: 'CONDITION',
        operator: MULTISELECT_SCALAR_CONDITIONS.IS_ANY_OF,
        value: 'NZL',
        filterId: scalarFacetDefinition.id,
        scopeId: 'scope',
      }),
    ).toEqual({
      operator: MULTISELECT_SCALAR_CONDITIONS.IS_ANY_OF,
      value: ['NZL'],
      valueTo: null,
    });

    expect(
      normalizeFilterBindingState(dateRangeDefinition, {
        mode: 'CONDITION',
        operator: DATE_RANGE_CONDITIONS.BETWEEN,
        value: ['2024-01-01', '2024-12-31'],
        valueTo: '2024-12-31',
        filterId: dateRangeDefinition.id,
        scopeId: 'scope',
      }),
    ).toEqual({
      operator: DATE_RANGE_CONDITIONS.BETWEEN,
      value: ['2024-01-01', '2024-12-31'],
      valueTo: '2024-12-31',
    });

    expect(
      normalizeFilterBindingState(numberRangeDefinition, {
        mode: 'CONDITION',
        operator: NUMBER_RANGE_CONDITIONS.BETWEEN,
        value: [3, 9],
        valueTo: 9,
        filterId: numberRangeDefinition.id,
        scopeId: 'scope',
      }),
    ).toEqual({
      operator: NUMBER_RANGE_CONDITIONS.BETWEEN,
      value: [3, 9],
      valueTo: 9,
    });
  });

  test('range normalization preserves falsy comparable values such as 0', () => {
    expect(
      normalizeFilterBindingState(numberRangeDefinition, {
        mode: 'CONDITION',
        operator: NUMBER_RANGE_CONDITIONS.AFTER,
        value: [0, null],
        valueTo: null,
        filterId: numberRangeDefinition.id,
        scopeId: 'scope',
      }),
    ).toEqual({
      operator: NUMBER_RANGE_CONDITIONS.AFTER,
      value: [0, null],
      valueTo: null,
    });
  });

  test('stored values with unsupported modes are not coerced into condition values', () => {
    // Forward-compat: stored values written by future filter families must
    // hydrate as "empty", never as a condition.
    const futureStoredValue = {
      mode: 'FUTURE_MODE',
      operator: 'in',
      value: { threshold: 100 },
      filterId: textDefinition.id,
      scopeId: 'scope',
    };

    expect(
      normalizeFilterBindingState(textDefinition, futureStoredValue),
    ).toEqual(createEmptyFilterBindingState(textDefinition));
  });

  test('clauses storing unsupported modes read back as uncommitted state', () => {
    const runtime = createRuntime(textDefinition);

    runtime.selection.update({
      source: createFilterBuilderSource(runtime),
      value: {
        mode: 'FUTURE_MODE',
        operator: 'in',
        value: { threshold: 100 },
        filterId: runtime.definition.id,
        scopeId: runtime.scopeId,
      },
      predicate: getTestPredicate(),
    });

    expect(readFilterSelectionState(runtime)).toEqual(
      createEmptyFilterBindingState(textDefinition),
    );
  });

  test.each<
    [
      string,
      FilterDefinition,
      FilterBindingState,
      Partial<Record<'operator' | 'value', unknown>>,
      Array<string>,
    ]
  >([
    [
      'text contains',
      textDefinition,
      {
        operator: TEXT_CONDITIONS.CONTAINS,
        value: 'ali',
        valueTo: null,
      },
      { operator: TEXT_CONDITIONS.CONTAINS, value: 'ali' },
      ['ILIKE', '%ali%'],
    ],
    [
      'text does_not_contain',
      textDefinition,
      {
        operator: TEXT_CONDITIONS.DOES_NOT_CONTAIN,
        value: 'ali',
        valueTo: null,
      },
      { operator: TEXT_CONDITIONS.DOES_NOT_CONTAIN, value: 'ali' },
      ['NOT ILIKE', '%ali%'],
    ],
    [
      'text is_exactly',
      textDefinition,
      {
        operator: TEXT_CONDITIONS.IS_EXACTLY,
        value: 'alice',
        valueTo: null,
      },
      { operator: TEXT_CONDITIONS.IS_EXACTLY, value: 'alice' },
      ["= 'alice'"],
    ],
    [
      'date-range between',
      dateRangeDefinition,
      {
        operator: DATE_RANGE_CONDITIONS.BETWEEN,
        value: ['2024-01-01', '2024-12-31'],
        valueTo: '2024-12-31',
      },
      {
        operator: DATE_RANGE_CONDITIONS.BETWEEN,
        value: ['2024-01-01', '2024-12-31'],
      },
      ['BETWEEN', 'created_at'],
    ],
    [
      'date-range after',
      dateRangeDefinition,
      {
        operator: DATE_RANGE_CONDITIONS.AFTER,
        value: ['2024-01-01', null],
        valueTo: null,
      },
      {
        operator: DATE_RANGE_CONDITIONS.AFTER,
        value: ['2024-01-01', null],
      },
      ['> ', 'created_at'],
    ],
    [
      'date-range before',
      dateRangeDefinition,
      {
        operator: DATE_RANGE_CONDITIONS.BEFORE,
        value: ['2024-12-31', null],
        valueTo: null,
      },
      {
        operator: DATE_RANGE_CONDITIONS.BEFORE,
        value: ['2024-12-31', null],
      },
      ['< ', 'created_at'],
    ],
    [
      'number-range between',
      numberRangeDefinition,
      {
        operator: NUMBER_RANGE_CONDITIONS.BETWEEN,
        value: [0, 5],
        valueTo: 5,
      },
      { operator: NUMBER_RANGE_CONDITIONS.BETWEEN, value: [0, 5] },
      ['BETWEEN 0 AND 5'],
    ],
    [
      'number-range after with [0, null]',
      numberRangeDefinition,
      {
        operator: NUMBER_RANGE_CONDITIONS.AFTER,
        value: [0, null],
        valueTo: null,
      },
      { operator: NUMBER_RANGE_CONDITIONS.AFTER, value: [0, null] },
      ['> 0'],
    ],
    [
      'scalar multiselect any-of',
      scalarFacetDefinition,
      {
        operator: MULTISELECT_SCALAR_CONDITIONS.IS_ANY_OF,
        value: ['NZL', 'USA'],
        valueTo: null,
      },
      {
        operator: MULTISELECT_SCALAR_CONDITIONS.IS_ANY_OF,
        value: ['NZL', 'USA'],
      },
      ['IN', "'NZL'", "'USA'"],
    ],
    [
      'scalar multiselect not-any-of',
      scalarFacetDefinition,
      {
        operator: MULTISELECT_SCALAR_CONDITIONS.IS_NOT_ANY_OF,
        value: ['NZL', 'USA'],
        valueTo: null,
      },
      {
        operator: MULTISELECT_SCALAR_CONDITIONS.IS_NOT_ANY_OF,
        value: ['NZL', 'USA'],
      },
      ['NOT IN', "'NZL'", "'USA'"],
    ],
    [
      'array multiselect includes-all',
      arrayFacetDefinition,
      {
        operator: MULTISELECT_ARRAY_CONDITIONS.INCLUDES_ALL,
        value: ['alpha', 'beta'],
        valueTo: null,
      },
      {
        operator: MULTISELECT_ARRAY_CONDITIONS.INCLUDES_ALL,
        value: ['alpha', 'beta'],
      },
      ['list_has_all', "'alpha'", "'beta'"],
    ],
    [
      'array multiselect excludes-all',
      arrayFacetDefinition,
      {
        operator: MULTISELECT_ARRAY_CONDITIONS.EXCLUDES_ALL,
        value: ['alpha', 'beta'],
        valueTo: null,
      },
      {
        operator: MULTISELECT_ARRAY_CONDITIONS.EXCLUDES_ALL,
        value: ['alpha', 'beta'],
      },
      ['NOT (list_has_any', "'alpha'", "'beta'"],
    ],
    [
      'empty semantics for string scalar columns',
      textDefinition,
      {
        operator: TEXT_CONDITIONS.IS_EMPTY,
        value: null,
        valueTo: null,
      },
      { operator: TEXT_CONDITIONS.IS_EMPTY },
      ['IS NULL OR', "= ''"],
    ],
    [
      'empty semantics for array columns',
      arrayFacetDefinition,
      {
        operator: MULTISELECT_ARRAY_CONDITIONS.IS_EMPTY,
        value: [],
        valueTo: null,
      },
      { operator: MULTISELECT_ARRAY_CONDITIONS.IS_EMPTY, value: [] },
      ['array_length', 'IS NULL'],
    ],
  ])(
    'applyFilterSelection emits the expected stored value and predicate for %s',
    (_, definition, state, expectedValue, predicateIncludes) => {
      const runtime = createRuntime(definition);

      applyFilterSelection(runtime, state);

      expect(runtime.selection.value).toMatchObject({
        mode: 'CONDITION',
        ...expectedValue,
      });

      const predicateText = getPredicateText(runtime);
      predicateIncludes.forEach((fragment) => {
        expect(predicateText).toContain(fragment);
      });
    },
  );

  test('clearFilterSelection clears both value and predicate', () => {
    const runtime = createRuntime(textDefinition);

    applyFilterSelection(runtime, {
      operator: TEXT_CONDITIONS.CONTAINS,
      value: 'ali',
      valueTo: null,
    });

    clearFilterSelection(runtime);

    expect(runtime.selection.value).toBeNull();
    expect(runtime.selection.predicate(null)).toEqual([]);
  });

  test('getFacetSelectedValues returns expected selected values for single and multi facet filters', () => {
    expect(
      getFacetSelectedValues(facetSingleDefinition, {
        operator: SELECT_CONDITIONS.IS,
        value: 'basketball',
        valueTo: null,
      }),
    ).toEqual(['basketball']);

    expect(
      getFacetSelectedValues(scalarFacetDefinition, {
        operator: MULTISELECT_SCALAR_CONDITIONS.IS_ANY_OF,
        value: ['NZL', 'USA'],
        valueTo: null,
      }),
    ).toEqual(['NZL', 'USA']);
  });

  test('readFilterSelectionState prefers the matching filter-builder source over the active foreign clause', () => {
    const runtime = createRuntime(textDefinition);

    runtime.selection.update({
      source: createFilterBuilderSource(runtime),
      value: {
        mode: 'CONDITION',
        operator: TEXT_CONDITIONS.IS_EXACTLY,
        value: 'published',
        filterId: runtime.definition.id,
        scopeId: runtime.scopeId,
      },
      predicate: getTestPredicate(),
    });
    runtime.selection.update({
      source: createForeignSource('external-search'),
      value: 'draft',
      predicate: getTestPredicate(),
    });

    expect(runtime.selection.value).toBe('draft');
    expect(readFilterSelectionState(runtime)).toEqual({
      operator: TEXT_CONDITIONS.IS_EXACTLY,
      value: 'published',
      valueTo: null,
    });
  });

  test('readFilterSelectionState hydrates from a sole foreign clause when it normalizes cleanly', () => {
    const runtime = createRuntime(textDefinition);

    runtime.selection.update({
      source: createForeignSource('external-search'),
      value: 'alice',
      predicate: getTestPredicate(),
    });

    expect(readFilterSelectionState(runtime)).toEqual({
      operator: TEXT_CONDITIONS.CONTAINS,
      value: 'alice',
      valueTo: null,
    });
  });

  test('readFilterSelectionState refuses ambiguous foreign multi-clause state', () => {
    const runtime = createRuntime(textDefinition);

    runtime.selection.update({
      source: createForeignSource('external-search'),
      value: 'alice',
      predicate: getTestPredicate(),
    });
    runtime.selection.update({
      source: createForeignSource('external-chip'),
      value: 'bob',
      predicate: getTestPredicate(),
    });

    expect(readFilterSelectionState(runtime)).toEqual(
      createEmptyFilterBindingState(textDefinition),
    );
  });
});

const subqueryDefinition: FilterDefinition = {
  id: 'popular',
  label: 'Popular questions',
  column: 'question',
  valueKind: 'number',
  operators: [NUMBER_CONDITIONS.GTE],
  defaultOperator: NUMBER_CONDITIONS.GTE,
  dataType: 'number',
  subquery: ({ state, contextPredicate }) => {
    if (state.value === null || state.value === undefined) {
      return null;
    }

    const query = mSql.Query.select('question')
      .from('data')
      .groupby('question')
      .having(mSql.gte(mSql.count(), Number(state.value)));

    if (contextPredicate) {
      query.where(contextPredicate);
    }

    return query;
  },
};

describe('subquery filters', () => {
  test('apply publishes an IN-subquery predicate with a SUBQUERY stored value', () => {
    const runtime = createRuntime(subqueryDefinition);

    applyFilterSelection(runtime, {
      operator: NUMBER_CONDITIONS.GTE,
      value: 100,
      valueTo: null,
    });

    expect(getPredicateText(runtime)).toBe(
      '("question" IN (SELECT "question" FROM "data" GROUP BY "question" HAVING (count(*) >= 100)))',
    );

    const [clause] = runtime.selection.clauses;
    expect(clause?.value).toMatchObject({
      mode: 'SUBQUERY',
      operator: NUMBER_CONDITIONS.GTE,
      value: 100,
      filterId: subqueryDefinition.id,
    });
    expect(clause?.meta).toBeUndefined();
  });

  test('committed subquery state reads back and clears like value filters', () => {
    const runtime = createRuntime(subqueryDefinition);

    applyFilterSelection(runtime, {
      operator: NUMBER_CONDITIONS.GTE,
      value: 3,
      valueTo: null,
    });

    expect(readFilterSelectionState(runtime)).toEqual({
      operator: NUMBER_CONDITIONS.GTE,
      value: 3,
      valueTo: null,
    });

    clearFilterSelection(runtime);
    expect(runtime.selection.clauses).toHaveLength(0);
  });

  test('empty values clear the clause instead of invoking the factory', () => {
    const runtime = createRuntime(subqueryDefinition);

    applyFilterSelection(runtime, {
      operator: NUMBER_CONDITIONS.GTE,
      value: 2,
      valueTo: null,
    });
    applyFilterSelection(runtime, {
      operator: NUMBER_CONDITIONS.GTE,
      value: null,
      valueTo: null,
    });

    expect(runtime.selection.clauses).toHaveLength(0);
  });

  test('persisted state rebuilds the same predicate through the factory', () => {
    const runtime = createRuntime(subqueryDefinition);
    applyFilterSelection(runtime, {
      operator: NUMBER_CONDITIONS.GTE,
      value: 5,
      valueTo: null,
    });

    // Simulate persister round-trip: JSON-serialize the stored clause value.
    const persisted = JSON.parse(
      JSON.stringify(runtime.selection.clauses[0]?.value),
    );

    const rehydrated = createRuntime(subqueryDefinition);
    applyFilterSelection(
      rehydrated,
      normalizeFilterBindingState(subqueryDefinition, persisted),
    );

    expect(getPredicateText(rehydrated)).toBe(getPredicateText(runtime));
  });

  test("factories receive sibling context and exclude the filter's own clause", () => {
    const context = Selection.intersect();
    const runtime: FilterRuntime = {
      ...createRuntime(subqueryDefinition),
      context,
    };

    context.update({
      source: createForeignSource('country-filter'),
      value: 'NZL',
      predicate: mSql.eq(mSql.column('country'), mSql.literal('NZL')),
    });

    applyFilterSelection(runtime, {
      operator: NUMBER_CONDITIONS.GTE,
      value: 2,
      valueTo: null,
    });

    expect(getPredicateText(runtime)).toContain('WHERE ("country" = \'NZL\')');

    // A context mirroring the filter's own clause contributes nothing.
    const selfBase = createRuntime(subqueryDefinition);
    const selfRuntime: FilterRuntime = {
      ...selfBase,
      context: selfBase.selection,
    };

    applyFilterSelection(selfRuntime, {
      operator: NUMBER_CONDITIONS.GTE,
      value: 2,
      valueTo: null,
    });

    expect(getPredicateText(selfRuntime)).not.toContain('WHERE');

    // Reapplying with the own clause now present must not embed it either.
    expect(reapplyCommittedFilterSelection(selfRuntime)).toBe(false);
    expect(getPredicateText(selfRuntime)).not.toContain('WHERE');
  });

  test('reapplyCommittedFilterSelection republishes only when the predicate changed', () => {
    const context = Selection.intersect();
    const runtime: FilterRuntime = {
      ...createRuntime(subqueryDefinition),
      context,
    };

    applyFilterSelection(runtime, {
      operator: NUMBER_CONDITIONS.GTE,
      value: 2,
      valueTo: null,
    });
    expect(getPredicateText(runtime)).not.toContain('NZL');

    // No context change -> no republish.
    expect(reapplyCommittedFilterSelection(runtime)).toBe(false);

    context.update({
      source: createForeignSource('country-filter'),
      value: 'NZL',
      predicate: mSql.eq(mSql.column('country'), mSql.literal('NZL')),
    });

    expect(reapplyCommittedFilterSelection(runtime)).toBe(true);
    expect(getPredicateText(runtime)).toContain("'NZL'");

    // Converged -> further reapplies are no-ops (loop guard).
    expect(reapplyCommittedFilterSelection(runtime)).toBe(false);
  });

  test('reapplyCommittedFilterSelection ignores filters without committed state', () => {
    const runtime: FilterRuntime = {
      ...createRuntime(subqueryDefinition),
      context: Selection.intersect(),
    };

    expect(reapplyCommittedFilterSelection(runtime)).toBe(false);
    expect(runtime.selection.clauses).toHaveLength(0);
  });

  test('reapplyCommittedFilterSelection terminates when its republish relays back through the scope context', () => {
    // Mirror the production topology: the filter's own selection relays its
    // clauses into a shared scope context, and a listener on that context
    // rebuilds the subquery whenever sibling filters change. Mosaic relays an
    // update to derived selections *before* committing its own value, so the
    // republish re-enters this listener synchronously while
    // `runtime.selection.clauses` still reports the stale predicate — which
    // previously caused unbounded recursion.
    const scopeContext = Selection.intersect();
    const runtime: FilterRuntime = {
      ...createRuntime(subqueryDefinition),
      context: scopeContext,
    };

    // Relay the filter selection into the scope context, exactly as
    // `useFilterScopeContext` wires it via Mosaic's `_relay`.
    (runtime.selection as unknown as { _relay: Set<Selection> })._relay.add(
      scopeContext,
    );

    applyFilterSelection(runtime, {
      operator: NUMBER_CONDITIONS.GTE,
      value: 2,
      valueTo: null,
    });

    let listenerCalls = 0;
    scopeContext.addEventListener('value', () => {
      listenerCalls += 1;
      if (listenerCalls > 50) {
        throw new Error('reapply listener did not converge');
      }

      reapplyCommittedFilterSelection(runtime);
    });

    // A sibling filter publishes into the scope context, driving the rebuild.
    expect(() => {
      scopeContext.update({
        source: createForeignSource('country-filter'),
        value: 'NZL',
        predicate: mSql.eq(mSql.column('country'), mSql.literal('NZL')),
      });
    }).not.toThrow();

    // The rebuilt predicate embeds the sibling context and the loop settled.
    expect(getPredicateText(runtime)).toContain("'NZL'");
  });

  test('FilterBindingController rebuilds committed subquery predicates on context changes', async () => {
    const context = Selection.intersect();
    const runtime: FilterRuntime = {
      ...createRuntime(subqueryDefinition),
      context,
    };
    const controller = new FilterBindingController(runtime);
    controller.connect();

    applyFilterSelection(runtime, {
      operator: NUMBER_CONDITIONS.GTE,
      value: 2,
      valueTo: null,
    });

    context.update({
      source: createForeignSource('country-filter'),
      value: 'NZL',
      predicate: mSql.eq(mSql.column('country'), mSql.literal('NZL')),
    });

    for (let i = 0; i < 10 && !getPredicateText(runtime).includes('NZL'); i++) {
      await flushMicrotask();
    }

    expect(getPredicateText(runtime)).toContain("'NZL'");
    controller.dispose();
  });
});

describe('FilterBindingController', () => {
  test('initializes from the matching committed selection state even when a foreign clause is active', () => {
    const runtime = createRuntime(textDefinition);

    runtime.selection.update({
      source: createFilterBuilderSource(runtime),
      value: {
        mode: 'CONDITION',
        operator: TEXT_CONDITIONS.IS_EXACTLY,
        value: 'published',
        filterId: runtime.definition.id,
        scopeId: runtime.scopeId,
      },
      predicate: getTestPredicate(),
    });
    runtime.selection.update({
      source: createForeignSource('external-search'),
      value: 'draft',
      predicate: getTestPredicate(),
    });

    const controller = new FilterBindingController(runtime);

    expect(controller.getSnapshot()).toEqual({
      operator: TEXT_CONDITIONS.IS_EXACTLY,
      value: 'published',
      valueTo: null,
    });

    controller.dispose();
  });

  test('initializes from the current selection value', () => {
    const runtime = createRuntime(textDefinition);
    setStoredSelection(runtime, {
      operator: TEXT_CONDITIONS.DOES_NOT_CONTAIN,
      value: 'ali',
      valueTo: null,
    });

    const controller = new FilterBindingController(runtime);

    expect(controller.getSnapshot()).toEqual({
      operator: TEXT_CONDITIONS.DOES_NOT_CONTAIN,
      value: 'ali',
      valueTo: null,
    });

    controller.dispose();
  });

  test('setOperator, setValue, and setValueTo update the store without mutating the Selection', () => {
    const runtime = createRuntime(numberRangeDefinition);
    const controller = new FilterBindingController(runtime);

    controller.setOperator(NUMBER_RANGE_CONDITIONS.AFTER);
    controller.setValue([0, 5]);
    controller.setValueTo(null);

    expect(controller.getSnapshot()).toEqual({
      operator: NUMBER_RANGE_CONDITIONS.AFTER,
      value: [0, null],
      valueTo: null,
    });
    expect(runtime.selection.value ?? null).toBeNull();

    controller.dispose();
  });

  test('apply() writes the current store snapshot into the Selection', () => {
    const runtime = createRuntime(textDefinition);
    const controller = new FilterBindingController(runtime);

    controller.setValue('ali');
    controller.apply();

    expect(runtime.selection.value).toMatchObject({
      mode: 'CONDITION',
      operator: TEXT_CONDITIONS.CONTAINS,
      value: 'ali',
    });
    expect(controller.getSnapshot()).toEqual({
      operator: TEXT_CONDITIONS.CONTAINS,
      value: 'ali',
      valueTo: null,
    });

    controller.dispose();
  });

  test('clear() clears through the Selection', async () => {
    const runtime = createRuntime(textDefinition);
    const controller = new FilterBindingController(runtime);
    controller.connect();

    controller.setValue('ali');
    controller.apply();
    await flushMicrotask();
    controller.clear();
    await flushMicrotask();

    expect(runtime.selection.value).toBeNull();
    expect(controller.getSnapshot()).toEqual(
      createEmptyFilterBindingState(textDefinition),
    );

    controller.dispose();
  });

  test('re-syncs after an external selection.update(...)', async () => {
    const runtime = createRuntime(textDefinition);
    const controller = new FilterBindingController(runtime);
    controller.connect();

    controller.setValue('draft');
    setStoredSelection(runtime, {
      operator: TEXT_CONDITIONS.IS_EXACTLY,
      value: 'published',
      valueTo: null,
    });
    await flushMicrotask();

    expect(controller.getSnapshot()).toEqual({
      operator: TEXT_CONDITIONS.IS_EXACTLY,
      value: 'published',
      valueTo: null,
    });

    controller.dispose();
  });

  test('dispose() unsubscribes cleanly and is idempotent', async () => {
    const runtime = createRuntime(textDefinition);
    const controller = new FilterBindingController(runtime);
    controller.connect();

    controller.setValue('draft');
    const snapshotBeforeDispose = controller.getSnapshot();

    controller.dispose();
    controller.dispose();

    setStoredSelection(runtime, {
      operator: TEXT_CONDITIONS.IS_EXACTLY,
      value: 'published',
      valueTo: null,
    });
    await flushMicrotask();

    expect(controller.getSnapshot()).toEqual(snapshotBeforeDispose);
  });
});
