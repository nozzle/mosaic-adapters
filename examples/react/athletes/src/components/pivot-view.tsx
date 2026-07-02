import { useMosaicPivot } from '@nozzleio/react-mosaic';
import { tableName } from '../page-context';

/**
 * A true crosstab via DuckDB PIVOT: athletes per sport, one column per
 * gender. The pivot columns are dynamic — DuckDB derives them from the data
 * and the client surfaces them from the Arrow result schema — so the column
 * defs render from `pivotColumns`, not from any hardcoded list.
 */
export function PivotView() {
  const pivot = useMosaicPivot<Record<string, unknown>>({
    from: tableName,
    on: 'sex',
    using: [{ agg: 'count' }],
    groupBy: ['sport'],
    inputs: { orderBy: [{ column: 'sport' }] },
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
            <tr>
              <th className="px-3 py-2 font-medium">Sport</th>
              {pivot.pivotColumns.map((column) => (
                <th
                  key={column}
                  className="px-3 py-2 font-medium"
                  data-testid="pivot-column"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-testid="pivot-table-body">
            {pivot.rows.map((row) => (
              <tr key={String(row.sport)} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-medium">{String(row.sport)}</td>
                {pivot.pivotColumns.map((column) => (
                  <td key={column} className="px-3 py-1.5 tabular-nums">
                    {row[column] == null
                      ? '—'
                      : Number(row[column]).toLocaleString('en-US')}
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
