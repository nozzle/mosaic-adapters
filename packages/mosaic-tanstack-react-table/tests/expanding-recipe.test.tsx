/**
 * Pins the "Expanding (client-side children)" recipe
 * (docs/tanstack-table/integration.md): a `LIST(STRUCT)` column fetched with
 * each parent row becomes TanStack Table sub-rows through `getSubRows`, under
 * manual pagination, with stable `getRowId`s, `autoResetExpanded: false` and
 * expansion state keyed on the inputs. The table code mirrors the recipe.
 */
import { useMosaicRows } from '@nozzleio/react-mosaic';
import { createTestDb, interact, renderHook, waitFor } from '@nozzleio/test-support/react';
import type { TestDb } from '@nozzleio/test-support/react';
import {
  createExpandedRowModel,
  functionalUpdate,
  rowExpandingFeature,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import type { ColumnDef, ExpandedState, OnChangeFn, PaginationState } from '@tanstack/react-table';
import { Query } from '@uwdata/mosaic-sql';
import { useState } from 'react';
import { beforeEach, describe, expect, test } from 'vitest';

import { paginationToWindow } from '../src/index';

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await db.exec(`
    CREATE TABLE athletes(
      id INTEGER,
      name TEXT,
      medals STRUCT(event TEXT, won_on DATE, rank INTEGER)[]
    );
    INSERT INTO athletes VALUES
      (1, 'Ada', [{'event': '100m', 'won_on': DATE '2024-07-28', 'rank': 1}]),
      (2, 'Bo', [
        {'event': '200m', 'won_on': DATE '2024-07-30', 'rank': 2},
        {'event': 'relay', 'won_on': DATE '2024-08-02', 'rank': 1}
      ]),
      (3, 'Cy', []),
      (4, 'Di', NULL),
      (5, 'Ed', [{'event': 'long jump', 'won_on': DATE '2024-08-01', 'rank': 3}]),
      (6, 'Fi', [{'event': 'shot put', 'won_on': DATE '2024-08-03', 'rank': 2}]);
  `);
});

// ── Recipe code (docs/tanstack-table/integration.md#expanding-client-side-children)

interface MedalRow {
  event: string;
  wonOn: Date;
  rank: number;
}

interface AthleteRow {
  id: number;
  name: string;
  medals: Array<MedalRow>;
}

/** Parents and their LIST(STRUCT) children share one table row type. */
type TableRow = AthleteRow | MedalRow;

function isAthlete(row: TableRow): row is AthleteRow {
  return 'medals' in row;
}

interface RawMedal {
  event: string;
  won_on: number | string | Date;
  rank: number | bigint;
}

// `coerce` maps top-level columns only: the children are decoded here.
function toAthlete(raw: Record<string, unknown>): AthleteRow {
  const medals = (raw.medals ?? []) as Iterable<RawMedal>;
  return {
    id: Number(raw.id),
    name: String(raw.name),
    medals: Array.from(medals, (medal) => ({
      event: medal.event,
      wonOn: new Date(medal.won_on),
      rank: Number(medal.rank),
    })),
  };
}

const features = tableFeatures({
  rowPaginationFeature,
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
});

const columns: Array<ColumnDef<typeof features, TableRow>> = [
  {
    id: 'label',
    header: 'Athlete / event',
    accessorFn: (row) => (isAthlete(row) ? row.name : row.event),
  },
];

function useAthletesTable(options: { autoResetExpanded?: boolean } = { autoResetExpanded: false }) {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 3 });
  const inputs = { orderBy: [{ column: 'id' }], ...paginationToWindow(pagination) };

  const athletes = useMosaicRows<AthleteRow>({
    coordinator: db.coordinator,
    query: ({ where }) => Query.from('athletes').select('id', 'name', 'medals').where(where),
    inputs,
    rowCount: 'window',
    coerce: toAthlete,
  });

  // Expansion belongs to the inputs it was made under: new inputs show nothing
  // expanded, while a re-query under the same inputs keeps it.
  const inputsKey = JSON.stringify(inputs);
  const [expansion, setExpansion] = useState<{ key: string; expanded: ExpandedState }>({
    key: inputsKey,
    expanded: {},
  });
  const expanded = expansion.key === inputsKey ? expansion.expanded : {};
  const onExpandedChange: OnChangeFn<ExpandedState> = (updater) => {
    setExpansion({ key: inputsKey, expanded: functionalUpdate(updater, expanded) });
  };

  const table = useTable({
    features,
    data: athletes.rows,
    rowCount: athletes.totalRows,
    columns,
    state: { pagination, expanded },
    onPaginationChange: setPagination,
    onExpandedChange,
    manualPagination: true,
    getSubRows: (row) => (isAthlete(row) ? row.medals : undefined),
    // Parents by primary key; children by position under their parent.
    getRowId: (row, index, parent) => {
      if (parent !== undefined) {
        return `${parent.id}/${index}`;
      }
      return isAthlete(row) ? String(row.id) : String(index);
    },
    autoResetExpanded: options.autoResetExpanded,
  });

  return { athletes, table, expanded, setPagination };
}

function visibleIds(table: ReturnType<typeof useAthletesTable>['table']): Array<string> {
  return table.getRowModel().rows.map((row) => row.id);
}

describe('expanding LIST(STRUCT) children recipe', () => {
  test('getSubRows exposes children; expansion survives re-queries; inputs reset it', async () => {
    const hook = await renderHook(() => useAthletesTable(), { initialProps: {} });
    await waitFor(() => {
      expect(visibleIds(hook.result.current.table)).toEqual(['1', '2', '3']);
    });

    const bo = hook.result.current.table.getRow('2');
    expect(bo.getCanExpand()).toBe(true);
    // An empty list has no children to expand.
    expect(hook.result.current.table.getRow('3').getCanExpand()).toBe(false);

    await interact(() => hook.result.current.table.getRow('2').toggleExpanded(true));
    await waitFor(() => {
      expect(visibleIds(hook.result.current.table)).toEqual(['1', '2', '2/0', '2/1', '3']);
    });
    const child = hook.result.current.table.getRow('2/1').original;
    expect(child).toEqual({ event: 'relay', wonOn: new Date('2024-08-02'), rank: 1 });

    // A re-query hands the table a new `data` array: with autoResetExpanded
    // off, the expansion (keyed by the stable row id) survives.
    const before = hook.result.current.athletes.rows;
    await interact(() => hook.result.current.athletes.client.refetch());
    await waitFor(() => {
      expect(hook.result.current.athletes.rows).not.toBe(before);
    });
    expect(visibleIds(hook.result.current.table)).toEqual(['1', '2', '2/0', '2/1', '3']);

    // Paging is an input change: the keyed reset collapses.
    await interact(() => hook.result.current.setPagination({ pageIndex: 1, pageSize: 3 }));
    await waitFor(() => {
      expect(visibleIds(hook.result.current.table)).toEqual(['4', '5', '6']);
    });
    expect(hook.result.current.expanded).toEqual({});
    // NULL lists are leaves too.
    expect(hook.result.current.table.getRow('4').getCanExpand()).toBe(false);

    // Expanding under the new inputs replaces the remembered expansion, so the
    // first page comes back collapsed.
    await interact(() => hook.result.current.table.getRow('5').toggleExpanded(true));
    await waitFor(() => {
      expect(visibleIds(hook.result.current.table)).toEqual(['4', '5', '5/0', '6']);
    });
    await interact(() => hook.result.current.setPagination({ pageIndex: 0, pageSize: 3 }));
    await waitFor(() => {
      expect(visibleIds(hook.result.current.table)).toEqual(['1', '2', '3']);
    });

    await hook.unmount();
  });

  test('with the default autoResetExpanded a re-query collapses the rows', async () => {
    const hook = await renderHook(() => useAthletesTable({}), {
      initialProps: {},
    });
    await waitFor(() => {
      expect(visibleIds(hook.result.current.table)).toEqual(['1', '2', '3']);
    });
    await interact(() => hook.result.current.table.getRow('2').toggleExpanded(true));
    await waitFor(() => {
      expect(visibleIds(hook.result.current.table)).toEqual(['1', '2', '2/0', '2/1', '3']);
    });

    await interact(() => hook.result.current.athletes.client.refetch());
    await waitFor(() => {
      expect(visibleIds(hook.result.current.table)).toEqual(['1', '2', '3']);
    });

    await hook.unmount();
  });

  test('a coerce descriptor map does not recurse into the list children', async () => {
    const hook = await renderHook(
      () =>
        useMosaicRows<Record<string, unknown>>({
          coordinator: db.coordinator,
          query: ({ where }) => Query.from('athletes').select('id', 'medals').where(where),
          inputs: { orderBy: [{ column: 'id' }], limit: 1 },
          // Names a struct field, not a top-level column: children are untouched.
          coerce: { rank: 'string' },
        }),
      { initialProps: {} },
    );
    await waitFor(() => {
      expect(hook.result.current.rows).toHaveLength(1);
    });
    const medals = Array.from(
      hook.result.current.rows[0]!.medals as Iterable<Record<string, unknown>>,
    );
    expect(medals).toHaveLength(1);
    expect(medals[0]!.rank).toBe(1);

    await hook.unmount();
  });
});
