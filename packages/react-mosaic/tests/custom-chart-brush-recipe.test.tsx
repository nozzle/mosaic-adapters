/**
 * Pins the custom-chart brush recipe (docs/react/topology-recipes.md): a brush
 * drawn by a non-vgplot chart is an `interval` FilterSpec written with the
 * chart's own MosaicClient in `clients`, so it gets chips, persistence and
 * self-exclusion from the FilterSet. The helpers below mirror the recipe code
 * verbatim (app code — nothing here ships in a package).
 */
import { createTestDb, interact, renderHook, waitFor } from '@nozzleio/test-support/react';
import type { TestDb } from '@nozzleio/test-support/react';
import { Selection } from '@uwdata/mosaic-core';
import type { MosaicClient, SelectionClause } from '@uwdata/mosaic-core';
import { Query, count, dateBin, sql } from '@uwdata/mosaic-sql';
import { useEffect } from 'react';
import { beforeEach, describe, expect, test } from 'vitest';

import { createFilterSet, useFilterSetState, useMosaicRows, useMosaicValues } from '../src/index';
import type { FilterSet, FilterSpec } from '../src/index';

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await db.exec(`
    CREATE TABLE signups(id INTEGER, created_at TIMESTAMP, signup_day DATE);
    INSERT INTO signups VALUES
      (1, TIMESTAMP '2024-01-01 10:00:00', DATE '2024-01-01'),
      (2, TIMESTAMP '2024-01-02 09:00:00', DATE '2024-01-02'),
      (3, TIMESTAMP '2024-01-02 15:00:00', DATE '2024-01-02'),
      (4, TIMESTAMP '2024-01-03 12:00:00', DATE '2024-01-03'),
      (5, TIMESTAMP '2024-01-05 08:00:00', DATE '2024-01-05');
  `);
});

interface DayRow {
  day: Date;
  signups: number;
}

const BRUSH_ID = 'signup-date';

// ── Recipe code (docs/react/topology-recipes.md#custom-chart-brush) ─────────

/** Snapping is app policy: whole UTC days here. */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The brush's `[lo, hi]` ISO bounds, or `null` when no brush is active. */
function readBrush(specs: ReadonlyArray<FilterSpec>): [string, string] | null {
  const spec = specs.find((candidate) => candidate.id === BRUSH_ID);
  if (spec === undefined || !Array.isArray(spec.value)) {
    return null;
  }
  const [lo, hi] = spec.value as Array<unknown>;
  if (typeof lo !== 'string' || typeof hi !== 'string') {
    return null;
  }
  return [lo, hi];
}

/**
 * Across a remount the spec survives in the set, but its clause is still keyed
 * to the previous mount's (destroyed) client. Re-key it to the live client and
 * refetch once the re-keyed clause reaches `filterBy`.
 */
function useReattachBrush(
  filters: FilterSet,
  filterBy: Selection,
  client: { readonly mosaicClient: MosaicClient; refetch: () => Promise<void> },
  id: string,
): void {
  useEffect(() => {
    const spec = filters.store.state.specs.find((candidate) => candidate.id === id);
    if (spec === undefined) {
      return;
    }
    const mosaicClient = client.mosaicClient;
    let done = false;
    const refetchOnceSelfExcluded = (): void => {
      if (done) {
        return;
      }
      const selfExcluded = filterBy.clauses.some((clause) => clause.clients?.has(mosaicClient));
      if (!selfExcluded) {
        return;
      }
      done = true;
      filterBy.removeEventListener('value', refetchOnceSelfExcluded);
      void client.refetch();
    };
    filterBy.addEventListener('value', refetchOnceSelfExcluded);
    filters.set(spec, { clients: new Set([mosaicClient]) });
    refetchOnceSelfExcluded();
    return () => {
      done = true;
      filterBy.removeEventListener('value', refetchOnceSelfExcluded);
    };
  }, [filters, filterBy, client, id]);
}

function useSignupsChart(filters: FilterSet, $where: Selection) {
  const series = useMosaicRows<DayRow>({
    coordinator: db.coordinator,
    query: ({ where }) =>
      Query.from('signups')
        .select({ day: dateBin('created_at', 'day'), signups: count() })
        .where(where)
        .groupby('day')
        .orderby('day'),
    filterBy: $where,
    coerce: { day: 'date', signups: 'number' },
  });
  const { client } = series;

  // Read-back: hydrated, chip-removed and reset brushes all land here.
  const { specs } = useFilterSetState(filters);
  const brush = readBrush(specs);

  useReattachBrush(filters, $where, client, BRUSH_ID);

  const onBrushEnd = (extent: [Date, Date] | null): void => {
    if (extent === null) {
      filters.remove(BRUSH_ID);
      return;
    }
    const lo = startOfUtcDay(extent[0]);
    const hi = startOfUtcDay(extent[1]);
    filters.set(
      {
        id: BRUSH_ID,
        column: 'created_at',
        kind: 'interval',
        label: 'Signed up',
        value: [lo.toISOString(), hi.toISOString()],
      },
      { clients: new Set([client.mosaicClient]) },
    );
  };

  return { rows: series.rows, brush, onBrushEnd };
}

// ── Test harness ─────────────────────────────────────────────────────────────

function useTotal($where: Selection) {
  return useMosaicValues<{ n: number }>({
    coordinator: db.coordinator,
    query: ({ where }) => Query.from('signups').select({ n: count() }).where(where),
    filterBy: $where,
  });
}

function brushClauses($where: Selection): Array<SelectionClause> {
  return $where._resolved.filter((clause) => clause.predicate != null);
}

describe('custom-chart brush recipe', () => {
  test('set/remove with the chart client: chips, read-back, round-trip, self-exclusion', async () => {
    const $where = Selection.crossfilter();
    const filters = createFilterSet({ targets: { where: $where } });

    const hook = await renderHook(
      () => ({ chart: useSignupsChart(filters, $where), total: useTotal($where) }),
      { initialProps: {} },
    );
    await waitFor(() => {
      expect(hook.result.current.chart.rows).toHaveLength(4);
      expect(Number(hook.result.current.total.values?.n)).toBe(5);
    });

    // Brush 2024-01-02 → 2024-01-03 (snapped to whole days).
    await interact(() =>
      hook.result.current.chart.onBrushEnd([
        new Date('2024-01-02T07:30:00Z'),
        new Date('2024-01-03T23:59:00Z'),
      ]),
    );
    await waitFor(() => {
      // The sibling is filtered: rows 2, 3 (the 3rd is after the snapped hi).
      expect(Number(hook.result.current.total.values?.n)).toBe(2);
    });
    // The chart is NOT filtered by its own brush (crossfilter self-exclusion).
    expect(hook.result.current.chart.rows).toHaveLength(4);
    expect(hook.result.current.chart.brush).toEqual([
      '2024-01-02T00:00:00.000Z',
      '2024-01-03T00:00:00.000Z',
    ]);

    // A chip for free, formatted by the interval kind.
    const chips = filters.store.state.chips;
    expect(chips).toHaveLength(1);
    expect(chips[0]?.label).toBe('Signed up');
    expect(chips[0]?.formattedValue).toBe('2024-01-02T00:00:00.000Z – 2024-01-03T00:00:00.000Z');

    // Plain JSON: the persisted spec replays to the identical predicate.
    const before = String(brushClauses($where)[0]?.predicate);
    const persisted = JSON.parse(JSON.stringify(filters.store.state.specs)) as Array<FilterSpec>;
    const replayTarget = Selection.crossfilter();
    const replayed = createFilterSet({ targets: { where: replayTarget } });
    for (const spec of persisted) {
      replayed.set(spec);
    }
    expect(brushClauses(replayTarget)).toHaveLength(1);
    expect(String(brushClauses(replayTarget)[0]?.predicate)).toBe(before);
    replayed.destroy();

    // Clearing the brush is remove(id).
    await interact(() => hook.result.current.chart.onBrushEnd(null));
    await waitFor(() => {
      expect(Number(hook.result.current.total.values?.n)).toBe(5);
    });
    expect(hook.result.current.chart.brush).toBeNull();
    expect(filters.store.state.chips).toEqual([]);
    expect(brushClauses($where)).toEqual([]);

    await hook.unmount();
    filters.destroy();
  });

  test('chip removal and reset() flow back into the read-back', async () => {
    const $where = Selection.crossfilter();
    const filters = createFilterSet({ targets: { where: $where } });
    const hook = await renderHook(() => useSignupsChart(filters, $where), { initialProps: {} });
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(4);
    });

    await interact(() =>
      hook.result.current.onBrushEnd([new Date('2024-01-01Z'), new Date('2024-01-02Z')]),
    );
    expect(hook.result.current.brush).not.toBeNull();
    await interact(() => filters.removeChip(filters.store.state.chips[0]!));
    expect(hook.result.current.brush).toBeNull();

    await interact(() =>
      hook.result.current.onBrushEnd([new Date('2024-01-01Z'), new Date('2024-01-02Z')]),
    );
    await interact(() => filters.reset());
    expect(hook.result.current.brush).toBeNull();
    expect(brushClauses($where)).toEqual([]);

    await hook.unmount();
    filters.destroy();
  });

  test('a remounted chart re-keys the surviving brush and is not filtered by it', async () => {
    const $where = Selection.crossfilter();
    const filters = createFilterSet({ targets: { where: $where } });
    const total = await renderHook(() => useTotal($where), { initialProps: {} });

    const first = await renderHook(() => useSignupsChart(filters, $where), { initialProps: {} });
    await waitFor(() => {
      expect(first.result.current.rows).toHaveLength(4);
    });
    await interact(() =>
      first.result.current.onBrushEnd([new Date('2024-01-02Z'), new Date('2024-01-03Z')]),
    );
    await waitFor(() => {
      expect(Number(total.result.current.values?.n)).toBe(2);
    });
    // Unmount (an enlarge/return move): the spec survives in the set.
    await first.unmount();
    expect(filters.store.state.specs.map((spec) => spec.id)).toEqual([BRUSH_ID]);

    const second = await renderHook(() => useSignupsChart(filters, $where), {
      initialProps: {},
      reactStrictMode: true,
    });
    await waitFor(() => {
      // Full domain: the chart self-excludes the brush it re-adopted…
      expect(second.result.current.rows).toHaveLength(4);
      // …and its brush is read back from the set.
      expect(second.result.current.brush).toEqual([
        '2024-01-02T00:00:00.000Z',
        '2024-01-03T00:00:00.000Z',
      ]);
    });
    // One clause (stable FilterSet source), still filtering the sibling.
    expect(brushClauses($where)).toHaveLength(1);
    expect(Number(total.result.current.values?.n)).toBe(2);

    await second.unmount();
    await total.unmount();
    filters.destroy();
  });

  test('the re-key refetch waits for a queued (not yet emitted) clause update', async () => {
    const $where = Selection.crossfilter();
    const filters = createFilterSet({ targets: { where: $where } });
    const first = await renderHook(() => useSignupsChart(filters, $where), { initialProps: {} });
    await waitFor(() => {
      expect(first.result.current.rows).toHaveLength(4);
    });
    await interact(() =>
      first.result.current.onBrushEnd([new Date('2024-01-02Z'), new Date('2024-01-03Z')]),
    );
    await first.unmount();

    // Occupy $where's dispatch queue so the remount's re-key is enqueued rather
    // than emitted synchronously: `clauses` (what queries read) lags behind.
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const hold = (): Promise<void> => gate;
    $where.addEventListener('value', hold);
    $where.emit('value', $where.clauses);

    const second = await renderHook(() => useSignupsChart(filters, $where), { initialProps: {} });
    // While the re-key is queued, the fresh client still reads the stale clause.
    await waitFor(() => {
      expect(second.result.current.rows).toHaveLength(1);
    });

    await interact(() => releaseGate());
    await waitFor(() => {
      expect(second.result.current.rows).toHaveLength(4);
    });

    $where.removeEventListener('value', hold);
    await second.unmount();
    filters.destroy();
  });

  test('temporal bounds as ISO strings filter TIMESTAMP and DATE columns', async () => {
    const $where = Selection.crossfilter();
    const filters = createFilterSet({ targets: { where: $where } });
    const total = await renderHook(() => useTotal($where), { initialProps: {} });
    await waitFor(() => {
      expect(Number(total.result.current.values?.n)).toBe(5);
    });

    await interact(() =>
      filters.set({
        id: 'ts',
        column: 'created_at',
        kind: 'interval',
        value: ['2024-01-02T00:00:00.000Z', '2024-01-02T12:00:00.000Z'],
      }),
    );
    await waitFor(() => {
      expect(Number(total.result.current.values?.n)).toBe(1);
    });

    await interact(() => filters.remove('ts'));
    await interact(() =>
      filters.set({
        id: 'day',
        column: 'signup_day',
        kind: 'interval',
        value: ['2024-01-02', '2024-01-03'],
      }),
    );
    await waitFor(() => {
      expect(Number(total.result.current.values?.n)).toBe(3);
    });

    await total.unmount();
    filters.destroy();
  });
});

describe('raw Selection clauses need a stable source per entry', () => {
  /** Publishes a raw clause the way the param-bridge recipe does. */
  function useRawBrush($where: Selection, source: object, lo: number) {
    useEffect(() => {
      $where.update({
        source,
        value: lo,
        predicate: sql`"id" >= ${lo}`,
        // A raw SQL predicate holds no column nodes.
        fields: [],
      });
    }, [$where, source, lo]);
  }

  test('a per-mount source leaves a ghost clause after a remount', async () => {
    const $where = Selection.crossfilter();
    const first = await renderHook(() => useRawBrush($where, { id: 'brush' }, 2), {
      initialProps: {},
    });
    await first.unmount();
    // Remount with a fresh source object (useMemo/useRef/inline literal).
    const second = await renderHook(() => useRawBrush($where, { id: 'brush' }, 3), {
      initialProps: {},
    });
    // Both clauses survive: the first one is a ghost nothing owns any more.
    expect(brushClauses($where)).toHaveLength(2);
    await second.unmount();
  });

  test('a module-scope source replaces the clause in place', async () => {
    const $where = Selection.crossfilter();
    const BRUSH_SOURCE = { id: 'brush' };
    const first = await renderHook(() => useRawBrush($where, BRUSH_SOURCE, 2), {
      initialProps: {},
    });
    await first.unmount();
    const second = await renderHook(() => useRawBrush($where, BRUSH_SOURCE, 3), {
      initialProps: {},
    });
    expect(brushClauses($where)).toHaveLength(1);
    expect(brushClauses($where)[0]?.value).toBe(3);
    await second.unmount();
  });
});
