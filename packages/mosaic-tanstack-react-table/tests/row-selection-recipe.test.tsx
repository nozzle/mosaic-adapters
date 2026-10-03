import { useMosaicRows } from '@nozzleio/react-mosaic';
import { createAthletesDb, interact, renderHook, waitFor } from '@nozzleio/test-support/react';
import type { TestDb } from '@nozzleio/test-support/react';
import {
  functionalUpdate,
  rowPaginationFeature,
  rowSelectionFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import type {
  ColumnDef,
  OnChangeFn,
  PaginationState,
  RowSelectionState,
} from '@tanstack/react-table';
import { Selection } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { useMemo, useState } from 'react';
import { beforeEach, describe, expect, test } from 'vitest';

import { paginationToWindow } from '../src/index';

interface AthleteRow {
  id: number;
  name: string;
}

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

const features = tableFeatures({ rowPaginationFeature, rowSelectionFeature });

const columns: Array<ColumnDef<typeof features, AthleteRow>> = [
  { accessorKey: 'id', header: 'Id' },
  { accessorKey: 'name', header: 'Name' },
];

// The recipe's consumer-supplied glue (docs/tanstack-table/integration.md).
const toId = (tuple: ReadonlyArray<unknown>) => String(tuple[0]);
const toTuple = (row: AthleteRow) => [row.id];

describe('rowSelection ↔ rows-client selected recipe', () => {
  test('row toggles publish, off-page picks survive paging, external clears flow back', async () => {
    const $picked = Selection.crossfilter();

    const hook = await renderHook(
      () => {
        const [pagination, setPagination] = useState<PaginationState>({
          pageIndex: 0,
          pageSize: 3,
        });
        const athletes = useMosaicRows<AthleteRow>({
          coordinator: db.coordinator,
          query: ({ where }) => Query.from('athletes').select('id', 'name').where(where),
          inputs: {
            orderBy: [{ column: 'id' }],
            ...paginationToWindow(pagination),
          },
          publish: { select: { as: $picked, columns: ['id'] } },
        });
        const { selected, rows, client } = athletes;

        const rowSelection = useMemo<RowSelectionState>(
          () => Object.fromEntries(selected.map((tuple) => [toId(tuple), true])),
          [selected],
        );

        const onRowSelectionChange: OnChangeFn<RowSelectionState> = (updater) => {
          const next = functionalUpdate(updater, rowSelection);
          const byId = new Map<string, ReadonlyArray<unknown>>();
          for (const tuple of selected) {
            byId.set(toId(tuple), tuple);
          }
          for (const row of rows) {
            const tuple = toTuple(row);
            byId.set(toId(tuple), tuple);
          }
          const tuples = Object.keys(next).flatMap((id) => {
            const tuple = byId.get(id);
            if (tuple === undefined) {
              return [];
            }
            return [tuple];
          });
          client.setSelectedValues(tuples);
        };

        const table = useTable({
          features,
          data: rows,
          columns,
          state: { pagination, rowSelection },
          onPaginationChange: setPagination,
          onRowSelectionChange,
          getRowId: (row) => toId(toTuple(row)),
          manualPagination: true,
        });
        return { athletes, rowSelection, table, setPagination };
      },
      { initialProps: {} },
    );

    await waitFor(() => {
      expect(hook.result.current.athletes.rows.map((row) => row.id)).toEqual([1, 2, 3]);
    });

    await interact(() => hook.result.current.table.getRow('2').toggleSelected(true));
    await waitFor(() => {
      expect(hook.result.current.athletes.selected).toEqual([[2]]);
    });
    expect(hook.result.current.rowSelection).toEqual({ '2': true });
    expect($picked._resolved[0]?.value).toEqual([[2]]);

    // Page forward and add a row there: the off-page pick is kept.
    await interact(() => hook.result.current.setPagination({ pageIndex: 1, pageSize: 3 }));
    await waitFor(() => {
      expect(hook.result.current.athletes.rows.map((row) => row.id)).toEqual([4, 5, 6]);
    });
    await interact(() => hook.result.current.table.getRow('5').toggleSelected(true));
    await waitFor(() => {
      expect(hook.result.current.athletes.selected).toEqual([[2], [5]]);
    });
    expect(hook.result.current.rowSelection).toEqual({ '2': true, '5': true });

    // Deselecting on this page leaves the other page's pick alone.
    await interact(() => hook.result.current.table.getRow('5').toggleSelected(false));
    await waitFor(() => {
      expect(hook.result.current.athletes.selected).toEqual([[2]]);
    });

    // An external clear (chip bar, global reset) reaches rowSelection too.
    await interact(() => {
      $picked.reset();
    });
    await waitFor(() => {
      expect(hook.result.current.rowSelection).toEqual({});
    });

    // Replay: the readonly `selected` shape feeds setSelectedValues directly.
    const replay = [[1], [6]] as const;
    await interact(() => hook.result.current.athletes.client.setSelectedValues(replay));
    await waitFor(() => {
      expect(hook.result.current.rowSelection).toEqual({ '1': true, '6': true });
    });

    await hook.unmount();
  });
});
