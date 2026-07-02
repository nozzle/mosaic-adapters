import { Selection, clauseMatch, clausePoints } from '@uwdata/mosaic-core';
import { Query, count, gte } from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';

import {
  buildSubqueryPredicate,
  createFilterRegistry,
  createSubqueryClause,
  createValueClause,
} from '../src/index';
import { waitFor } from './test-utils';
import type { SelectionClause } from '@uwdata/mosaic-core';

const source = (descriptor?: Record<string, unknown>) => ({ ...descriptor });

// Selection value events dispatch async once listeners attach (the registry
// is a listener), so chip and clause assertions poll. `_resolved` is the
// synchronously-maintained clause list.
const resolved = (selection: Selection) => selection._resolved;

function pointsClause(
  src: object,
  values: Array<unknown>,
  field = 'phrase',
): SelectionClause {
  return clausePoints(
    [field],
    values.map((value) => [value]),
    { source: src },
  );
}

describe('createFilterRegistry', () => {
  test('normalizes clauses from registered selections into ordered chips', async () => {
    const registry = createFilterRegistry();
    registry.registerGroup({ id: 'global', label: 'Global', priority: 1 });
    registry.registerGroup({ id: 'summary', label: 'Summary', priority: 2 });

    const $phrase = Selection.intersect();
    const $selDomain = Selection.intersect();
    // Registration order is summary-first; group priority must win.
    registry.register($selDomain, {
      group: 'summary',
      label: 'Selected Domain',
      explodeValues: true,
    });
    registry.register($phrase, { group: 'global', label: 'Keyword' });

    $selDomain.update(pointsClause(source(), ['a.com', 'b.com'], 'domain'));
    $phrase.update(clauseMatch('phrase', 'stove', { source: source() }));

    await waitFor(() => {
      expect(
        registry.store.state.chips.map(
          (chip) => `${chip.label}: ${chip.formattedValue}`,
        ),
      ).toEqual([
        'Keyword: stove',
        'Selected Domain: a.com',
        'Selected Domain: b.com',
      ]);
    });

    registry.destroy();
  });

  test('labelMap keys on source column/id descriptors with * fallback', async () => {
    const registry = createFilterRegistry();
    registry.registerGroup({ id: 'detail', label: 'Detail', priority: 1 });

    const $detail = Selection.intersect();
    registry.register($detail, {
      group: 'detail',
      labelMap: { domain: 'Domain', '*': 'Detail filter' },
    });

    $detail.update(
      clauseMatch('domain', 'nozzle', { source: source({ column: 'domain' }) }),
    );
    $detail.update(
      clauseMatch('title', 'how to', { source: source({ column: 'title' }) }),
    );

    await waitFor(() => {
      const labels = registry.store.state.chips.map((chip) => chip.label);
      expect(labels).toContain('Domain');
      expect(labels).toContain('Detail filter');
    });

    registry.destroy();
  });

  test('unwraps filter-builder stored-value envelopes for display', async () => {
    const registry = createFilterRegistry();
    const $min = Selection.intersect();
    registry.register($min, { group: 'global', label: 'Min Domains' });

    const subquery = Query.select({ q: 'phrase' })
      .from('nozzle_paa')
      .groupby('phrase')
      .having(gte(count('domain').distinct(), 3));
    $min.update(
      createSubqueryClause({
        source: source({ id: 'filter-builder:paa:min-domains' }),
        value: {
          mode: 'SUBQUERY',
          operator: 'gte',
          value: 3,
          valueTo: null,
          filterId: 'min-domains',
          scopeId: 'paa',
        },
        predicate: buildSubqueryPredicate({
          column: 'phrase',
          query: subquery,
        }),
      }),
    );

    await waitFor(() => {
      expect(registry.store.state.chips).toHaveLength(1);
    });
    expect(registry.store.state.chips[0]!.formattedValue).toBe('3');

    registry.destroy();
  });

  test('removeChip clears whole clauses, and narrows exploded point lists when fields are registered', async () => {
    const registry = createFilterRegistry();
    const $sel = Selection.intersect();
    registry.register($sel, {
      group: 'summary',
      label: 'Selected Question',
      explodeValues: true,
      fields: ['related_phrase.phrase'],
    });

    const src = source();
    $sel.update(pointsClause(src, ['q1', 'q2', 'q3']));
    await waitFor(() => {
      expect(registry.store.state.chips).toHaveLength(3);
    });

    // Removing one chip narrows the clause to the remaining tuples with the
    // same source identity and a struct-access predicate.
    registry.removeChip(registry.store.state.chips[1]!);
    expect(resolved($sel)).toHaveLength(1);
    expect(resolved($sel)[0]!.source).toBe(src);
    expect(resolved($sel)[0]!.value).toEqual([['q1'], ['q3']]);
    expect(String(resolved($sel)[0]!.predicate)).toContain(
      '"related_phrase"."phrase"',
    );
    await waitFor(() => {
      expect(registry.store.state.chips).toHaveLength(2);
    });

    // Removing the remaining chips one by one ends with the clause cleared.
    registry.removeChip(registry.store.state.chips[0]!);
    await waitFor(() => {
      expect(registry.store.state.chips).toHaveLength(1);
    });
    registry.removeChip(registry.store.state.chips[0]!);
    expect(resolved($sel)).toHaveLength(0);
    await waitFor(() => {
      expect(registry.store.state.chips).toHaveLength(0);
    });

    registry.destroy();
  });

  test('removeChip without registered fields clears the whole exploded clause', async () => {
    const registry = createFilterRegistry();
    const $sel = Selection.intersect();
    registry.register($sel, {
      group: 'summary',
      label: 'Selected Keyword',
      explodeValues: true,
    });

    $sel.update(pointsClause(source(), ['a', 'b']));
    await waitFor(() => {
      expect(registry.store.state.chips).toHaveLength(2);
    });

    registry.removeChip(registry.store.state.chips[0]!);
    expect(resolved($sel)).toHaveLength(0);
    await waitFor(() => {
      expect(registry.store.state.chips).toHaveLength(0);
    });

    registry.destroy();
  });

  test('resetAll resets chip and reset-only selections', async () => {
    const registry = createFilterRegistry();
    const $chips = Selection.intersect();
    const $resetOnly = Selection.intersect();
    registry.register($chips, { group: 'global', label: 'Keyword' });
    registry.registerForReset($resetOnly);

    $chips.update(clauseMatch('phrase', 'stove', { source: source() }));
    $resetOnly.update(
      createValueClause({
        source: source(),
        value: '> 5',
        predicate: gte(count(), 5),
      }),
    );
    await waitFor(() => {
      expect(registry.store.state.chips).toHaveLength(1);
    });

    registry.resetAll();
    expect(resolved($chips)).toHaveLength(0);
    expect(resolved($resetOnly)).toHaveLength(0);
    await waitFor(() => {
      expect(registry.store.state.chips).toHaveLength(0);
    });

    registry.destroy();
  });

  test('unregister detaches the listener; destroy empties the store', async () => {
    const registry = createFilterRegistry();
    const $sel = Selection.intersect();
    const unregister = registry.register($sel, {
      group: 'global',
      label: 'Keyword',
    });

    $sel.update(clauseMatch('phrase', 'stove', { source: source() }));
    await waitFor(() => {
      expect(registry.store.state.chips).toHaveLength(1);
    });

    unregister();
    expect(registry.store.state.chips).toHaveLength(0);
    $sel.update(clauseMatch('phrase', 'oven', { source: source() }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(registry.store.state.chips).toHaveLength(0);

    registry.destroy();
    expect(registry.store.state.chips).toHaveLength(0);
  });
});
