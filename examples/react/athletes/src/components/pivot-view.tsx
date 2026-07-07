import { useMemo } from 'react';
import { flexRender, tableFeatures, useTable } from '@tanstack/react-table';
import { useMosaicPivot } from '@nozzleio/react-mosaic';
import { tableName } from '../page-context';
import type { ColumnDef } from '@tanstack/react-table';

type PivotRow = Record<string, unknown>;

// The crosstab is fully manual: no sorting/pagination/visibility, so an empty
// feature set is all `useTable` needs.
const features = tableFeatures({});

/**
 * A true crosstab via DuckDB PIVOT: athletes per sport, one column per
 * gender. The pivot columns are dynamic — DuckDB derives them from the data
 * and the client surfaces them from the Arrow result schema — so the column
 * defs are built from `pivotColumns`, not from any hardcoded list.
 */
export function PivotView() {
  const pivot = useMosaicPivot<PivotRow>({
    from: tableName,
    on: 'sex',
    using: [{ agg: 'count' }],
    groupBy: ['sport'],
    inputs: { orderBy: [{ column: 'sport' }] },
  });

  // Columns are discovered at query time, so rebuild the defs whenever the
  // pivot column set changes: a fixed leading `sport` column plus one column
  // per dynamic pivot name. Each pivot cell reproduces the `—`/toLocaleString
  // formatting; `sport` renders as a plain string.
  const columns = useMemo<Array<ColumnDef<typeof features, PivotRow>>>(() => {
    return [
      {
        id: 'sport',
        accessorFn: (row) => row.sport,
        header: 'Sport',
        cell: (cell) => String(cell.row.original.sport),
      },
      ...pivot.pivotColumns.map<ColumnDef<typeof features, PivotRow>>(
        (column) => ({
          id: column,
          accessorFn: (row) => row[column],
          header: column,
          cell: (cell) => {
            const value = cell.getValue<unknown>();
            return value == null ? '—' : Number(value).toLocaleString('en-US');
          },
        }),
      ),
    ];
  }, [pivot.pivotColumns]);

  const table = useTable({
    features,
    data: pivot.rows,
    columns,
    getRowId: (row) => String(row.sport),
  });

  return (
    <section className="space-y-2">
      <p className="text-sm text-slate-500">
        <code>PIVOT athletes ON sex USING count(*) GROUP BY sport</code> — the
        gender columns come from the result schema, not the config.
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm" data-testid="pivot-table">
          <thead className="bg-slate-50 text-left">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-3 py-2 font-medium"
                    // Only the dynamic pivot columns carry the testid; the
                    // fixed `sport` header does not.
                    data-testid={
                      header.column.id === 'sport' ? undefined : 'pivot-column'
                    }
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody data-testid="pivot-table-body">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                {row.getAllCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={
                      cell.column.id === 'sport'
                        ? 'px-3 py-1.5 font-medium'
                        : 'px-3 py-1.5 tabular-nums'
                    }
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
