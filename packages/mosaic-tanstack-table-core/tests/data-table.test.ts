import * as mSql from '@uwdata/mosaic-sql';
import { Selection } from '@uwdata/mosaic-core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  buildCollectionPredicate,
  buildConditionPredicate,
  buildEmptyValuePredicate,
} from '../src/condition-predicate';
import { MosaicDataTable } from '../src/data-table';
import { TotalCountStrategy } from '../src/facet-strategies';
import { GROUP_ID_SEPARATOR } from '../src/grouped/types';
import { SidecarClient } from '../src/sidecar-client';
import type { MosaicDataTableOptions, PrimitiveSqlValue } from '../src/types';

const { queryFieldInfoMock } = vi.hoisted(() => ({
  queryFieldInfoMock: vi.fn(),
}));

vi.mock('@uwdata/mosaic-core', async (importOriginal) => {
  const actual = await importOriginal();

  return Object.assign({}, actual, {
    queryFieldInfo: queryFieldInfoMock,
  });
});

type AthleteRow = {
  id: string;
  name: string;
  age: number;
  country: string;
  status: string;
};

type QueryMatcher = RegExp | string | ((sql: string) => boolean);

function createArrowTable(rows: Array<Record<string, unknown>>) {
  return {
    numRows: rows.length,
    get(index: number) {
      return rows[index] ?? null;
    },
    getChild() {
      return null;
    },
    toArray() {
      return rows;
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

class FakeCoordinator {
  readonly requestLog: Array<{ kind: 'requestQuery' | 'query'; sql: string }> =
    [];
  #responses: Array<{
    matcher: QueryMatcher;
    value: unknown | ((sql: string) => unknown | Promise<unknown>);
  }> = [];

  connect(client: {
    coordinator: FakeCoordinator | null;
    initialize: () => void;
  }) {
    client.coordinator = this;
    client.initialize();
  }

  disconnect(client: { coordinator: FakeCoordinator | null }) {
    client.coordinator = null;
  }

  enqueueResponse(
    matcher: QueryMatcher,
    value: unknown | ((sql: string) => unknown | Promise<unknown>),
  ) {
    this.#responses.push({ matcher, value });
  }

  async requestQuery(
    client: {
      queryPending: () => void;
      queryResult: (data: unknown) => void;
      update: () => void;
    },
    query: unknown,
  ) {
    const sql = toSqlString(query);
    this.requestLog.push({ kind: 'requestQuery', sql });

    if (!query) {
      client.update();
      return Promise.resolve(client);
    }

    client.queryPending();
    const result = await this.#resolve(sql);
    client.queryResult(result);
    client.update();
    return Promise.resolve(client);
  }

  query(query: unknown) {
    const sql = toSqlString(query);
    this.requestLog.push({ kind: 'query', sql });
    return this.#resolve(sql);
  }

  #resolve(sql: string) {
    const index = this.#responses.findIndex(({ matcher }) =>
      typeof matcher === 'string'
        ? sql.includes(matcher)
        : matcher instanceof RegExp
          ? matcher.test(sql)
          : matcher(sql),
    );

    if (index < 0) {
      return createArrowTable([]);
    }

    const entry = this.#responses.splice(index, 1)[0];
    if (!entry) {
      return createArrowTable([]);
    }

    return typeof entry.value === 'function' ? entry.value(sql) : entry.value;
  }
}

function toSqlString(query: unknown) {
  if (typeof query === 'string') {
    return query;
  }
  if (query && typeof query === 'object' && 'toString' in query) {
    return String(query.toString());
  }
  return String(query ?? '');
}

async function waitFor(assertion: () => void) {
  const timeoutAt = Date.now() + 2_000;
  let lastError: unknown;

  while (Date.now() < timeoutAt) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  throw lastError;
}

function createFlatClient(
  overrides: Partial<
    MosaicDataTableOptions<AthleteRow, PrimitiveSqlValue>
  > = {},
) {
  const coordinator =
    (overrides.coordinator as FakeCoordinator | undefined) ??
    new FakeCoordinator();

  const client = new MosaicDataTable<AthleteRow>({
    table: 'athletes',
    coordinator: coordinator as never,
    columns: [
      { accessorKey: 'id', header: 'ID' },
      { accessorKey: 'name', header: 'Name' },
      { accessorKey: 'age', header: 'Age' },
      { accessorKey: 'country', header: 'Country' },
      { accessorKey: 'status', header: 'Status' },
    ],
    mapping: {
      id: { sqlColumn: 'id', type: 'VARCHAR' },
      name: {
        sqlColumn: 'athlete_name',
        type: 'VARCHAR',
        filterType: 'PARTIAL_ILIKE',
      },
      age: {
        sqlColumn: 'profile.age',
        type: 'INTEGER',
        filterType: 'RANGE',
      },
      country: {
        sqlColumn: 'country',
        type: 'VARCHAR',
        filterType: 'EQUALS',
      },
      status: {
        sqlColumn: 'status',
        type: 'VARCHAR',
        filterType: 'EQUALS',
      },
    },
    __debugName: 'TestTable',
    ...overrides,
  });

  return { client, coordinator };
}

beforeEach(() => {
  queryFieldInfoMock.mockReset();
  queryFieldInfoMock.mockResolvedValue([]);
});

describe('MosaicDataTable characterization', () => {
  test('builds mapped queries and mirrors internal filters into tableFilterSelection', () => {
    const tableFilterSelection = new Selection();
    const { client } = createFlatClient({
      tableFilterSelection,
      totalRowsMode: 'window',
    });

    client.store.setState((prev) => ({
      ...prev,
      tableState: {
        ...prev.tableState,
        pagination: { pageIndex: 2, pageSize: 25 },
        sorting: [{ id: 'age', desc: true }],
        columnFilters: [
          { id: 'name', value: 'alex' },
          { id: 'age', value: ['10', '30'] },
        ],
      },
    }));

    const sql = client
      .query(mSql.eq(mSql.column('status'), mSql.literal('active')))
      ?.toString();

    expect(sql).toContain('FROM "athletes"');
    expect(sql).toContain('"athlete_name" AS "name"');
    expect(sql).toContain('COUNT(*) OVER()');
    expect(sql).toContain('"status" = \'active\'');
    expect(sql).toContain('"athlete_name" ILIKE \'%alex%\'');
    expect(sql).toContain(
      'TRY_CAST("profile"."age" AS DOUBLE) BETWEEN 10 AND 30',
    );
    expect(sql).toContain('ORDER BY "profile"."age" DESC');
    expect(sql).toContain('LIMIT 25');
    expect(sql).toContain('OFFSET 50');

    expect(tableFilterSelection.valueFor(client)).toEqual([
      { id: 'name', value: 'alex' },
      { id: 'age', value: ['10', '30'] },
    ]);
    const tableFilterPredicate = tableFilterSelection.active.predicate;
    expect(tableFilterPredicate).not.toBeNull();
    expect(tableFilterPredicate!.toString()).toContain(
      '"athlete_name" ILIKE \'%alex%\'',
    );
    expect(tableFilterPredicate!.toString()).toContain(
      'TRY_CAST("profile"."age" AS DOUBLE) BETWEEN 10 AND 30',
    );
  });

  test('continues to support legacy mosaicDataTable metadata', () => {
    const client = new MosaicDataTable<AthleteRow>({
      table: 'athletes',
      columns: [
        {
          accessorKey: 'name',
          header: 'Name',
          meta: {
            mosaicDataTable: {
              sqlColumn: 'athlete_name',
              sqlFilterType: 'PARTIAL_ILIKE',
            },
          },
        },
      ],
    });

    client.store.setState((prev) => ({
      ...prev,
      tableState: {
        ...prev.tableState,
        columnFilters: [{ id: 'name', value: 'alex' }],
      },
    }));

    const sql = client.query()?.toString();

    expect(sql).toContain('"athlete_name" AS "name"');
    expect(sql).toContain('"athlete_name" ILIKE \'%alex%\'');
  });

  test('prefers meta.mosaic over legacy metadata when both are present', () => {
    const client = new MosaicDataTable<AthleteRow>({
      table: 'athletes',
      columns: [
        {
          accessorKey: 'name',
          header: 'Name',
          meta: {
            mosaicDataTable: {
              sqlColumn: 'legacy_name',
              sqlFilterType: 'LIKE',
            },
            mosaic: {
              sqlColumn: 'modern_name',
              sqlFilterType: 'PARTIAL_ILIKE',
            },
          },
        },
      ],
    });

    client.store.setState((prev) => ({
      ...prev,
      tableState: {
        ...prev.tableState,
        columnFilters: [{ id: 'name', value: 'alex' }],
      },
    }));

    const sql = client.query()?.toString();

    expect(sql).toContain('"modern_name" AS "name"');
    expect(sql).toContain('"modern_name" ILIKE \'%alex%\'');
    expect(sql).not.toContain('legacy_name');
  });

  test('projects metadata fields required by visibility, sorting, filters, global filters, and row selection', () => {
    const rowSelection = new Selection();
    const client = new MosaicDataTable<AthleteRow>({
      table: 'athletes',
      columns: [
        { accessorKey: 'id', header: 'ID' },
        {
          id: 'displayName',
          header: 'Display Name',
          accessorFn: (row) => row.name,
          meta: {
            mosaic: {
              fields: ['first_name', 'last_name'],
              sortBy: 'last_name',
              globalFilterBy: ['first_name', 'last_name'],
            },
          },
        },
        {
          accessorKey: 'age',
          header: 'Age',
          meta: {
            mosaic: {
              sqlColumn: 'age_display',
              filterBy: 'age_years',
              sqlFilterType: 'RANGE',
            },
          },
        },
        {
          accessorKey: 'country',
          header: 'Country',
          meta: {
            mosaic: {
              sqlColumn: 'country_name',
              sqlFilterType: 'EQUALS',
            },
          },
        },
      ],
      rowSelection: {
        selection: rowSelection,
        column: 'id',
      },
    });

    client.store.setState((prev) => ({
      ...prev,
      tableState: {
        ...prev.tableState,
        columnVisibility: {
          age: false,
          country: false,
        },
        sorting: [{ id: 'displayName', desc: false }],
        columnFilters: [{ id: 'age', value: ['20', '40'] }],
        globalFilter: 'alex',
      },
    }));

    const sql = client.query()?.toString();

    expect(sql).toContain('"id"');
    expect(sql).toContain('"first_name"');
    expect(sql).toContain('"last_name"');
    expect(sql).toContain('"age_years"');
    expect(sql).not.toContain('"country_name"');
    expect(sql).toContain('ORDER BY "last_name" ASC');
    expect(sql).toContain('TRY_CAST("age_years" AS DOUBLE) BETWEEN 20 AND 40');
    expect(sql).toContain('"first_name" ILIKE \'%alex%\'');
    expect(sql).toContain('"last_name" ILIKE \'%alex%\'');
  });

  test('configures stable TanStack row ids from rowId and projects hidden row id fields', () => {
    const { client } = createFlatClient({
      rowId: 'id',
    });

    client.store.setState((prev) => ({
      ...prev,
      tableState: {
        ...prev.tableState,
        columnVisibility: {
          id: false,
        },
      },
    }));

    const tableOptions = client.getTableOptions(client.store.state);
    const rowId = tableOptions.getRowId?.(
      {
        id: 'athlete-7',
        name: 'Alice',
        age: 31,
        country: 'NZ',
        status: 'active',
      },
      0,
    );
    const sql = client.query()?.toString();

    expect(rowId).toBe('athlete-7');
    expect(sql).toContain('"id"');
  });

  test('uses rowId fields for row selection predicates after pagination changes', () => {
    const rowSelection = new Selection();
    const { client } = createFlatClient({
      rowId: 'id',
      rowSelection: {
        selection: rowSelection,
        column: 'country',
      },
    });

    client.store.setState((prev) => ({
      ...prev,
      rows: [
        { id: 'u1', name: 'Alice', age: 31, country: 'NZ', status: 'active' },
        { id: 'u2', name: 'Bob', age: 28, country: 'AU', status: 'active' },
      ],
      tableState: {
        ...prev.tableState,
        pagination: { pageIndex: 3, pageSize: 10 },
      },
    }));

    client.getTableOptions(client.store.state).onRowSelectionChange?.({
      u2: true,
    });

    expect(rowSelection.valueFor(client)).toEqual(['u2']);
    expect(rowSelection.active.predicate?.toString()).toContain(
      '"id" = \'u2\'',
    );
    expect(rowSelection.active.predicate?.toString()).not.toContain(
      '"country"',
    );
  });

  test('supports row-values selection fallback using current row values', () => {
    const rowSelection = new Selection();
    const { client } = createFlatClient({
      rowSelectionMode: 'row-values',
      rowSelection: {
        selection: rowSelection,
        column: 'country',
      },
    });

    client.store.setState((prev) => ({
      ...prev,
      rows: [
        { id: 'u1', name: 'Alice', age: 31, country: 'NZ', status: 'active' },
        { id: 'u2', name: 'Bob', age: 28, country: 'AU', status: 'active' },
      ],
    }));

    client.getTableOptions(client.store.state).onRowSelectionChange?.({
      '1': true,
    });

    expect(rowSelection.active.predicate?.toString()).toContain(
      '"country" IN (\'AU\')',
    );
  });

  test('uses facetBy metadata for sidecar facet queries', async () => {
    const coordinator = new FakeCoordinator();
    const client = new MosaicDataTable<AthleteRow>({
      table: 'athletes',
      coordinator: coordinator as never,
      columns: [
        {
          accessorKey: 'country',
          header: 'Country',
          meta: {
            mosaic: {
              sqlColumn: 'country_name',
              facetBy: 'country_code',
              facet: 'unique',
              facetSortMode: 'count',
            },
          },
        },
      ],
    });

    coordinator.enqueueResponse('FROM "athletes"', createArrowTable([]));
    coordinator.enqueueResponse(
      (sql) => sql.includes('GROUP BY "country_code"'),
      createArrowTable([{ country_code: 'NZ' }]),
    );

    client.connect();
    await client.pending;

    client.requestFacet('country', 'unique');

    await waitFor(() => {
      expect(client.getFacetValue<Array<unknown>>('country')).toEqual(['NZ']);
    });

    expect(
      coordinator.requestLog.some(
        ({ sql }) =>
          sql.includes('GROUP BY "country_code"') &&
          sql.includes('ORDER BY') &&
          sql.includes('DESC'),
      ),
    ).toBe(true);
  });

  test('resets pagination and requeries when an external filter selection changes', async () => {
    const filterBy = new Selection();
    const { client, coordinator } = createFlatClient({ filterBy });

    coordinator.enqueueResponse(
      'FROM "athletes"',
      createArrowTable([
        { id: '1', name: 'Alice', age: 31, country: 'NZ', status: 'active' },
      ]),
    );

    client.connect();
    await client.pending;

    client.store.setState((prev) => ({
      ...prev,
      tableState: {
        ...prev.tableState,
        pagination: { pageIndex: 4, pageSize: 10 },
      },
    }));

    filterBy.update({
      source: {},
      value: 'NZ',
      predicate: mSql.eq(mSql.column('country'), mSql.literal('NZ')),
    });

    await waitFor(() => {
      expect(client.store.state.tableState.pagination.pageIndex).toBe(0);
      expect(
        coordinator.requestLog.some(
          ({ sql }) =>
            sql.includes('"country" = \'NZ\'') &&
            sql.includes('FROM "athletes"'),
        ),
      ).toBe(true);
    });
  });

  test('pushes TanStack row selection changes into the Mosaic selection predicate', () => {
    const rowSelection = new Selection();
    const { client } = createFlatClient({
      rowSelection: {
        selection: rowSelection,
        column: 'id',
      },
    });

    const tableOptions = client.getTableOptions(client.store.state);
    tableOptions.onRowSelectionChange?.({ '2': true, '7': true });

    expect(client.store.state.tableState.rowSelection).toEqual({
      '2': true,
      '7': true,
    });
    expect(client.rowSelectionColumn).toBe('id');
    expect(rowSelection.valueFor(client)).toEqual(['2', '7']);
    const rowSelectionPredicate = rowSelection.active.predicate;
    expect(rowSelectionPredicate).not.toBeNull();
    expect(rowSelectionPredicate!.toString()).toContain("\"id\" IN ('2', '7')");
  });

  test('does not project row selection fallback fields from query factory sources', () => {
    const rowSelection = new Selection();
    const client = new MosaicDataTable<Record<string, string | number>>({
      table: () =>
        mSql.Query.from('athletes')
          .select({ key: mSql.column('country'), metric: mSql.count() })
          .groupby('country'),
      columns: [
        { accessorKey: 'key', header: 'Country' },
        { accessorKey: 'metric', header: 'Count' },
      ],
      rowSelection: {
        selection: rowSelection,
        column: 'country',
      },
      tableOptions: {
        getRowId: (row) => String(row.key),
      },
      manualHighlight: true,
    });

    const sql = client.query()?.toString();

    expect(sql).toContain('SELECT "key", "metric" FROM');
    expect(sql).not.toContain('SELECT "key", "metric", "country" FROM');

    client.getTableOptions(client.store.state).onRowSelectionChange?.({
      NZ: true,
    });

    expect(rowSelection.valueFor(client)).toEqual(['NZ']);
    expect(rowSelection.active.predicate?.toString()).toContain(
      '"country" = \'NZ\'',
    );
  });

  test('projects configured manual highlight fields even when hidden', () => {
    const client = new MosaicDataTable<Record<string, string | number | null>>({
      table: () =>
        mSql.Query.from('athletes')
          .select({
            key: mSql.column('country'),
            metric: mSql.count(),
            __is_highlighted: mSql.literal(1),
          })
          .groupby('country'),
      columns: [
        { accessorKey: 'key', header: 'Country' },
        { accessorKey: 'metric', header: 'Count' },
        { accessorKey: '__is_highlighted', header: 'Highlighted' },
      ],
      manualHighlight: true,
      tableOptions: {
        initialState: {
          columnVisibility: { __is_highlighted: false },
        },
      },
    });

    const sql = client.query()?.toString();

    expect(sql).toContain('SELECT "key", "metric", "__is_highlighted" FROM');
  });

  test('refreshes manual highlight queries when row selection changes or clears', () => {
    const rowSelection = new Selection();
    const { client } = createFlatClient({
      manualHighlight: true,
      rowSelection: {
        selection: rowSelection,
        column: 'id',
      },
    });

    client.connect();
    const requestUpdateSpy = vi
      .spyOn(client, 'requestUpdate')
      .mockImplementation(() => client as never);
    const tableOptions = client.getTableOptions(client.store.state);

    tableOptions.onRowSelectionChange?.({ '2': true });
    tableOptions.onRowSelectionChange?.({});

    expect(requestUpdateSpy).toHaveBeenCalledTimes(2);
  });

  test('hydrates row selection from a shared selection for remounted table clients', async () => {
    const rowSelection = new Selection();
    const coordinator = new FakeCoordinator();
    const originalClient = new MosaicDataTable<AthleteRow>({
      table: 'athletes',
      coordinator: coordinator as never,
      columns: [
        { accessorKey: 'id', header: 'ID' },
        { accessorKey: 'name', header: 'Name' },
      ],
      rowSelection: {
        selection: rowSelection,
        column: 'id',
      },
    });

    originalClient.connect();
    originalClient
      .getTableOptions(originalClient.store.state)
      .onRowSelectionChange?.({ '7': true });

    const fullscreenClient = new MosaicDataTable<AthleteRow>({
      table: 'athletes',
      coordinator: coordinator as never,
      columns: [
        { accessorKey: 'id', header: 'ID' },
        { accessorKey: 'name', header: 'Name' },
      ],
      rowSelection: {
        selection: rowSelection,
        column: 'id',
      },
    });

    fullscreenClient.connect();

    await waitFor(() => {
      expect(fullscreenClient.store.state.tableState.rowSelection).toEqual({
        '7': true,
      });
    });
  });

  test('keeps row selection visuals in sync across clients sharing one selection', async () => {
    const rowSelection = new Selection();
    const coordinator = new FakeCoordinator();
    const dashboardClient = new MosaicDataTable<AthleteRow>({
      table: 'athletes',
      coordinator: coordinator as never,
      columns: [
        { accessorKey: 'id', header: 'ID' },
        { accessorKey: 'name', header: 'Name' },
      ],
      rowSelection: {
        selection: rowSelection,
        column: 'id',
      },
    });
    const fullscreenClient = new MosaicDataTable<AthleteRow>({
      table: 'athletes',
      coordinator: coordinator as never,
      columns: [
        { accessorKey: 'id', header: 'ID' },
        { accessorKey: 'name', header: 'Name' },
      ],
      rowSelection: {
        selection: rowSelection,
        column: 'id',
      },
    });

    dashboardClient.connect();
    fullscreenClient.connect();

    dashboardClient
      .getTableOptions(dashboardClient.store.state)
      .onRowSelectionChange?.({ '2': true });

    await waitFor(() => {
      expect(dashboardClient.store.state.tableState.rowSelection).toEqual({
        '2': true,
      });
      expect(fullscreenClient.store.state.tableState.rowSelection).toEqual({
        '2': true,
      });
    });

    fullscreenClient
      .getTableOptions(fullscreenClient.store.state)
      .onRowSelectionChange?.({ '9': true });

    await waitFor(() => {
      expect(dashboardClient.store.state.tableState.rowSelection).toEqual({
        '9': true,
      });
      expect(fullscreenClient.store.state.tableState.rowSelection).toEqual({
        '9': true,
      });
      expect(rowSelection.clauses).toHaveLength(1);
      expect(rowSelection.active?.source).toBe(fullscreenClient);
      expect(rowSelection.value).toEqual(['9']);
    });
  });

  test('replaces stale row selection clauses when a remounted client updates the selection', async () => {
    const rowSelection = new Selection();
    const coordinator = new FakeCoordinator();
    const dashboardClient = new MosaicDataTable<AthleteRow>({
      table: 'athletes',
      coordinator: coordinator as never,
      columns: [
        { accessorKey: 'id', header: 'ID' },
        { accessorKey: 'name', header: 'Name' },
      ],
      rowSelection: {
        selection: rowSelection,
        column: 'id',
      },
    });

    dashboardClient.connect();
    dashboardClient
      .getTableOptions(dashboardClient.store.state)
      .onRowSelectionChange?.({ '2': true, '7': true });

    const fullscreenClient = new MosaicDataTable<AthleteRow>({
      table: 'athletes',
      coordinator: coordinator as never,
      columns: [
        { accessorKey: 'id', header: 'ID' },
        { accessorKey: 'name', header: 'Name' },
      ],
      rowSelection: {
        selection: rowSelection,
        column: 'id',
      },
    });

    fullscreenClient.connect();
    fullscreenClient
      .getTableOptions(fullscreenClient.store.state)
      .onRowSelectionChange?.({ '2': true, '7': true, '9': true });

    await waitFor(() => {
      expect(rowSelection.clauses).toHaveLength(1);
      expect(rowSelection.active?.source).toBe(fullscreenClient);
      expect(rowSelection.value).toEqual(['2', '7', '9']);
      expect(rowSelection.active?.predicate?.toString()).toContain(
        "\"id\" IN ('2', '7', '9')",
      );
    });
  });

  test('clears a shared row selection from a remounted client without leaving stale clauses behind', async () => {
    const rowSelection = new Selection();
    const coordinator = new FakeCoordinator();
    const dashboardClient = new MosaicDataTable<AthleteRow>({
      table: 'athletes',
      coordinator: coordinator as never,
      columns: [
        { accessorKey: 'id', header: 'ID' },
        { accessorKey: 'name', header: 'Name' },
      ],
      rowSelection: {
        selection: rowSelection,
        column: 'id',
      },
    });

    dashboardClient.connect();
    dashboardClient
      .getTableOptions(dashboardClient.store.state)
      .onRowSelectionChange?.({ '2': true, '7': true });

    const fullscreenClient = new MosaicDataTable<AthleteRow>({
      table: 'athletes',
      coordinator: coordinator as never,
      columns: [
        { accessorKey: 'id', header: 'ID' },
        { accessorKey: 'name', header: 'Name' },
      ],
      rowSelection: {
        selection: rowSelection,
        column: 'id',
      },
    });

    fullscreenClient.connect();
    fullscreenClient
      .getTableOptions(fullscreenClient.store.state)
      .onRowSelectionChange?.({});

    await waitFor(() => {
      expect(rowSelection.clauses).toHaveLength(0);
      expect(rowSelection.value).toBeNull();
      expect(dashboardClient.store.state.tableState.rowSelection).toEqual({});
      expect(fullscreenClient.store.state.tableState.rowSelection).toEqual({});
    });
  });

  test('queries pinned rows by stable row id and keeps them available across pages', async () => {
    const { client, coordinator } = createFlatClient({
      rowId: 'id',
    });

    client.store.setState((prev) => ({
      ...prev,
      rows: [
        { id: 'u1', name: 'Alice', age: 31, country: 'NZ', status: 'active' },
      ],
    }));

    coordinator.enqueueResponse(
      (sql) => sql.includes('"id" IN (\'u2\')') && !sql.includes('LIMIT'),
      createArrowTable([
        { id: 'u2', name: 'Bob', age: 28, country: 'AU', status: 'active' },
      ]),
    );

    client.getTableOptions(client.store.state).onRowPinningChange?.({
      top: ['u2'],
      bottom: [],
    });

    await waitFor(() => {
      expect(client.store.state.pinnedRows.top).toEqual([
        { id: 'u2', name: 'Bob', age: 28, country: 'AU', status: 'active' },
      ]);
    });

    client.store.setState((prev) => ({
      ...prev,
      rows: [
        { id: 'u3', name: 'Cara', age: 24, country: 'US', status: 'active' },
      ],
    }));

    const tableOptions = client.getTableOptions(client.store.state);
    expect(tableOptions.data).toEqual([
      { id: 'u2', name: 'Bob', age: 28, country: 'AU', status: 'active' },
      { id: 'u3', name: 'Cara', age: 24, country: 'US', status: 'active' },
    ]);
  });

  test('ignores stale main row query responses after a newer query starts', async () => {
    const { client, coordinator } = createFlatClient();
    const first = createDeferred<ReturnType<typeof createArrowTable>>();

    coordinator.enqueueResponse('FROM "athletes"', first.promise);
    coordinator.enqueueResponse(
      'FROM "athletes"',
      createArrowTable([
        { id: 'new', name: 'New', age: 20, country: 'NZ', status: 'active' },
      ]),
    );

    const firstRequest = client.requestQuery();
    const secondRequest = client.requestQuery();
    await secondRequest;

    expect(client.store.state.rows).toEqual([
      { id: 'new', name: 'New', age: 20, country: 'NZ', status: 'active' },
    ]);

    first.resolve(
      createArrowTable([
        { id: 'old', name: 'Old', age: 40, country: 'AU', status: 'active' },
      ]),
    );
    await firstRequest;

    expect(client.store.state.rows).toEqual([
      { id: 'new', name: 'New', age: 20, country: 'NZ', status: 'active' },
    ]);
  });

  test('ignores stale sidecar responses after a newer sidecar query starts', async () => {
    const coordinator = new FakeCoordinator();
    const first = createDeferred<ReturnType<typeof createArrowTable>>();
    const results: Array<number> = [];
    const sidecar = new SidecarClient(
      {
        source: 'athletes',
        column: 'count',
        getFilters: () => [],
        onResult: (count: number) => {
          results.push(count);
        },
      },
      TotalCountStrategy,
    );

    sidecar.setCoordinator(coordinator as never);
    coordinator.enqueueResponse('FROM "athletes"', first.promise);
    coordinator.enqueueResponse(
      'FROM "athletes"',
      createArrowTable([{ count: 12 }]),
    );

    const firstRequest = sidecar.requestQuery();
    const secondRequest = sidecar.requestQuery();
    await secondRequest;

    first.resolve(createArrowTable([{ count: 3 }]));
    await firstRequest;

    expect(results).toEqual([12]);
  });

  test('ignores stale pinned row query responses after pinning changes', async () => {
    const { client, coordinator } = createFlatClient({
      rowId: 'id',
    });
    const first = createDeferred<ReturnType<typeof createArrowTable>>();

    coordinator.enqueueResponse(
      (sql) => sql.includes('"id" IN (\'u2\')'),
      first.promise,
    );
    coordinator.enqueueResponse(
      (sql) => sql.includes('"id" IN (\'u3\')'),
      createArrowTable([
        { id: 'u3', name: 'Cara', age: 24, country: 'US', status: 'active' },
      ]),
    );

    const tableOptions = client.getTableOptions(client.store.state);
    tableOptions.onRowPinningChange?.({ top: ['u2'], bottom: [] });
    tableOptions.onRowPinningChange?.({ top: ['u3'], bottom: [] });

    await waitFor(() => {
      expect(client.store.state.pinnedRows.top).toEqual([
        { id: 'u3', name: 'Cara', age: 24, country: 'US', status: 'active' },
      ]);
    });

    first.resolve(
      createArrowTable([
        { id: 'u2', name: 'Bob', age: 28, country: 'AU', status: 'active' },
      ]),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.store.state.pinnedRows.top).toEqual([
      { id: 'u3', name: 'Cara', age: 24, country: 'US', status: 'active' },
    ]);
  });

  test('only reacts to meaningful table state changes and refreshes sidecars on filter changes', () => {
    const { client } = createFlatClient();
    const requestUpdateSpy = vi
      .spyOn(client, 'requestUpdate')
      .mockImplementation(() => client as never);
    const refreshAllSpy = vi
      .spyOn(client.sidecarManager, 'refreshAll')
      .mockImplementation(() => undefined);

    const tableOptions = client.getTableOptions(client.store.state);

    tableOptions.onStateChange?.((previousState) => previousState);

    expect(requestUpdateSpy).not.toHaveBeenCalled();
    expect(refreshAllSpy).not.toHaveBeenCalled();

    tableOptions.onStateChange?.((previousState) => ({
      ...previousState,
      pagination: { ...previousState.pagination, pageIndex: 1 },
    }));

    expect(requestUpdateSpy).toHaveBeenCalledTimes(1);
    expect(refreshAllSpy).not.toHaveBeenCalled();

    tableOptions.onStateChange?.((previousState) => ({
      ...previousState,
      columnFilters: [{ id: 'status', value: 'active' }],
    }));

    expect(requestUpdateSpy).toHaveBeenCalledTimes(2);
    expect(refreshAllSpy).toHaveBeenCalledTimes(1);
  });

  test('excludes the active facet column from sidecar queries and stores returned facet values', async () => {
    const { client, coordinator } = createFlatClient();

    client.store.setState((prev) => ({
      ...prev,
      tableState: {
        ...prev.tableState,
        columnFilters: [
          { id: 'country', value: 'NZ' },
          { id: 'status', value: 'active' },
        ],
      },
    }));

    coordinator.enqueueResponse('FROM "athletes"', createArrowTable([]));
    coordinator.enqueueResponse(
      (sql) =>
        sql.includes('GROUP BY "country"') &&
        sql.includes('"status" = \'active\''),
      createArrowTable([{ country: 'NZ' }, { country: 'AU' }]),
    );

    client.connect();
    await client.pending;

    client.requestFacet('country', 'unique');

    await waitFor(() => {
      expect(client.getFacetValue<Array<unknown>>('country')).toEqual([
        'NZ',
        'AU',
      ]);
    });

    const facetQuery = coordinator.requestLog.find(
      ({ sql }) =>
        sql.includes('GROUP BY "country"') &&
        sql.includes('"status" = \'active\''),
    )?.sql;

    expect(facetQuery).toBeDefined();
    expect(facetQuery).not.toContain('"country" = \'NZ\'');
    expect(client.getFacetValue<Array<unknown>>('country')).toEqual([
      'NZ',
      'AU',
    ]);
  });

  test('loads grouped children lazily, shows leaf columns, and clears descendant selection on collapse', async () => {
    const rowSelection = new Selection();
    const coordinator = new FakeCoordinator();

    coordinator.enqueueResponse(
      (sql) =>
        sql.includes('GROUP BY "country"') && !sql.includes('GROUP BY "sport"'),
      createArrowTable([{ country: 'USA', count: 2 }]),
    );
    coordinator.enqueueResponse(
      (sql) => sql.includes('GROUP BY "sport"') && sql.includes("'USA'"),
      createArrowTable([{ sport: 'Swimming', count: 2 }]),
    );
    coordinator.enqueueResponse(
      (sql) =>
        sql.includes('"unique_key"') &&
        sql.includes('"name"') &&
        sql.includes("'USA'") &&
        sql.includes("'Swimming'"),
      createArrowTable([
        { unique_key: 'u1', name: 'Alice' },
        { unique_key: 'u2', name: 'Bob' },
      ]),
    );

    const client = new MosaicDataTable({
      table: 'athletes',
      coordinator: coordinator as never,
      columns: [
        { accessorKey: 'country', header: 'Country' },
        { accessorKey: 'sport', header: 'Sport' },
        { accessorKey: 'count', header: 'Count' },
      ],
      rowSelection: {
        selection: rowSelection,
        column: 'id',
      },
      groupBy: {
        levels: [{ column: 'country' }, { column: 'sport' }],
        metrics: [{ id: 'count', expression: mSql.count(), label: 'Count' }],
        leafColumns: [
          { column: 'unique_key', label: 'Key' },
          { column: 'name', label: 'Name' },
        ],
      },
    });

    client.connect();
    await client.pending;

    expect(client.store.state.rows).toHaveLength(1);
    expect(client.groupedState.totalRootRows).toBe(1);

    const tableOptions = client.getTableOptions(client.store.state);
    tableOptions.onExpandedChange?.({ USA: true });

    await waitFor(() => {
      const root = client.store.state.rows[0] as {
        subRows?: Array<Record<string, unknown>>;
      };
      expect(root.subRows).toHaveLength(1);
    });

    const childId = `USA${GROUP_ID_SEPARATOR}Swimming`;
    tableOptions.onExpandedChange?.({
      USA: true,
      [childId]: true,
    });

    await waitFor(() => {
      const root = client.store.state.rows[0] as {
        subRows?: Array<{
          subRows?: Array<Record<string, unknown>>;
        }>;
      };
      expect(root.subRows?.[0]?.subRows).toHaveLength(2);
    });

    const groupedOptions = client.getTableOptions(client.store.state);
    expect(groupedOptions.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accessorKey: 'name', header: 'Name' }),
      ]),
    );
    expect(groupedOptions.state).toMatchObject({
      columnVisibility: { name: true, unique_key: true },
    });

    rowSelection.update({
      source: {},
      value: [`${childId}${GROUP_ID_SEPARATOR}_leaf_u1`],
      predicate: null,
    });

    tableOptions.onExpandedChange?.({});

    await waitFor(() => {
      expect(client.groupedState.expanded).toEqual({});
      expect(rowSelection.value).toBeUndefined();
    });
  });

  test('continues to hard-code __total_rows even when totalRowsColumnName is provided', () => {
    const { client } = createFlatClient({
      totalRowsMode: 'window',
      totalRowsColumnName: 'custom_total_rows',
    });

    const sql = client.query()?.toString();
    expect(sql).toContain('__total_rows');
    expect(sql).not.toContain('custom_total_rows');

    client.queryResult(
      createArrowTable([
        {
          id: '1',
          name: 'Alice',
          age: 31,
          country: 'NZ',
          status: 'active',
          __total_rows: 7,
          custom_total_rows: 99,
        },
      ]),
    );

    expect(client.store.state.totalRows).toBe(7);
  });

  test('re-subscribes when filterBy identity changes', async () => {
    const firstFilter = Selection.intersect();
    const secondFilter = Selection.intersect();
    const coordinator = new FakeCoordinator();

    const client = new MosaicDataTable({
      table: 'athletes',
      coordinator: coordinator as never,
      columns: [{ accessorKey: 'name', header: 'Name' }],
      filterBy: firstFilter,
    });

    client.connect();
    await client.pending;

    client.updateOptions({
      table: 'athletes',
      coordinator: coordinator as never,
      columns: [{ accessorKey: 'name', header: 'Name' }],
      filterBy: secondFilter,
    });

    await waitFor(() => {
      expect(client.filterBy).toBe(secondFilter);
    });

    expect(client.filterBy).toBe(secondFilter);
  });

  test('buildConditionPredicate preserves falsy comparable values', () => {
    const equalsZero = buildConditionPredicate({
      column: 'gold',
      operator: 'eq',
      value: 0,
      dataType: 'number',
    });
    const betweenZeroAndFive = buildConditionPredicate({
      column: 'gold',
      operator: 'between',
      value: 0,
      valueTo: 5,
      dataType: 'number',
    });
    const equalsFalse = buildConditionPredicate({
      column: 'active',
      operator: 'eq',
      value: false,
      dataType: 'boolean',
    });

    expect(equalsZero?.toString()).toContain('= 0');
    expect(betweenZeroAndFive?.toString()).toContain('BETWEEN 0 AND 5');
    expect(equalsFalse?.toString()).toMatch(/=\s*(FALSE|false)/);
  });

  test('buildConditionPredicate escapes wildcard characters for text operators', () => {
    const containsEscaped = buildConditionPredicate({
      column: 'nickname',
      operator: 'contains',
      value: '100%_real',
    });
    const notContainsEscaped = buildConditionPredicate({
      column: 'nickname',
      operator: 'not_contains',
      value: '100%_real',
    });

    expect(containsEscaped?.toString()).toContain(
      "ILIKE '%100\\%\\_real%' ESCAPE '\\'",
    );
    expect(notContainsEscaped?.toString()).toContain(
      "NOT ILIKE '%100\\%\\_real%' ESCAPE '\\'",
    );
  });

  test('buildEmptyValuePredicate applies type-aware semantics for scalar and array columns', () => {
    const textEmpty = buildEmptyValuePredicate({
      column: 'country',
      dataType: 'string',
    });
    const stringNotEmpty = buildEmptyValuePredicate({
      column: 'country',
      dataType: 'string',
      negate: true,
    });
    const numberEmpty = buildEmptyValuePredicate({
      column: 'gold',
      dataType: 'number',
    });
    const arrayEmpty = buildEmptyValuePredicate({
      column: 'tags',
      columnType: 'array',
    });

    expect(textEmpty.toString()).toContain('IS NULL OR');
    expect(textEmpty.toString()).toContain("= ''");
    expect(stringNotEmpty.toString()).toContain('IS NOT NULL AND');
    expect(stringNotEmpty.toString()).toContain("!= ''");
    expect(numberEmpty.toString()).toContain('IS NULL');
    expect(arrayEmpty.toString()).toContain('array_length');
  });

  test('buildCollectionPredicate supports scalar and array collection semantics', () => {
    const scalarAny = buildCollectionPredicate({
      column: 'country',
      values: ['NZL', 'USA'],
      match: 'any',
    });
    const scalarNotAny = buildCollectionPredicate({
      column: 'country',
      values: ['NZL', 'USA'],
      match: 'any',
      negate: true,
    });
    const arrayAny = buildCollectionPredicate({
      column: 'tags',
      values: ['alpha', 'beta'],
      columnType: 'array',
      match: 'any',
    });
    const arrayAll = buildCollectionPredicate({
      column: 'tags',
      values: ['alpha', 'beta'],
      columnType: 'array',
      match: 'all',
    });
    const arrayExcludes = buildCollectionPredicate({
      column: 'tags',
      values: ['alpha', 'beta'],
      columnType: 'array',
      match: 'any',
      negate: true,
    });

    expect(scalarAny?.toString()).toContain('IN');
    expect(scalarNotAny?.toString()).toContain('NOT IN');
    expect(arrayAny?.toString()).toContain('list_has_any');
    expect(arrayAll?.toString()).toContain('list_has_all');
    expect(arrayExcludes?.toString()).toContain('NOT (list_has_any');
  });
});
