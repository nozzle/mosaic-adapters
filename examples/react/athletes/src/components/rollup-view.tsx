import {
  columnVisibilityFeature,
  createExpandedRowModel,
  flexRender,
  rowExpandingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { Query, count, sum } from '@uwdata/mosaic-sql';
import { useMosaicRollup } from '@nozzleio/react-mosaic';
import { tableName } from '../page-context';
import type { ColumnDef, ExpandedState } from '@tanstack/react-table';
import type { RollupRow } from '@nozzleio/react-mosaic';

interface MedalRollup {
  sport: string | null;
  nationality: string | null;
  athletes: number | bigint;
  gold: number | bigint | null;
}

// A rollup row plus the children it parents. The flat rows arrive pre-ordered
// depth-first, so the tree assembles in a single pass; leaves keep an empty
// `subRows` and never become expandable.
interface RollupNode extends RollupRow<MedalRollup> {
  subRows: Array<RollupNode>;
}

const GROUP_BY = ['sport', 'nationality'];

function pathKey(path: Array<string>): string {
  return path.join('\u0000');
}

function rowId(row: RollupRow<MedalRollup>): string {
  return pathKey(row.groupPath) || '__total__';
}

const features = tableFeatures({
  rowExpandingFeature,
  columnVisibilityFeature,
  expandedRowModel: createExpandedRowModel(),
});

const columns: Array<ColumnDef<typeof features, RollupNode>> = [
  {
    id: 'group',
    header: 'Group',
    cell: (cell) => {
      const row = cell.row;
      const node = row.original;
      if (node.isLeaf) {
        return <span>{node.data.nationality}</span>;
      }
      return (
        <button
          type="button"
          className="flex items-center gap-1 font-medium"
          data-testid="rollup-toggle"
          onClick={row.getToggleExpandedHandler()}
          disabled={node.level === 0}
        >
          {node.level === 0 ? (
            'All athletes'
          ) : (
            <>
              <span className="text-xs text-slate-400">
                {row.getIsExpanded() ? '▼' : '▶'}
              </span>
              {node.data.sport}
            </>
          )}
        </button>
      );
    },
  },
  {
    id: 'athletes',
    header: 'Athletes',
    cell: (cell) =>
      Number(cell.row.original.data.athletes).toLocaleString('en-US'),
  },
  {
    id: 'gold',
    header: 'Gold medals',
    cell: (cell) =>
      Number(cell.row.original.data.gold ?? 0).toLocaleString('en-US'),
  },
];

/**
 * Hierarchical grouping as one SQL query: `GROUP BY ROLLUP(sport,
 * nationality)` returns the whole tree — grand total, per-sport subtotals,
 * and leaves — level-tagged and pre-ordered. Expanding a row is pure UI
 * visibility over the flat rows via TanStack Table's `rowExpandingFeature`; no
 * query runs.
 */
export function RollupView() {
  const rollup = useMosaicRollup<MedalRollup>({
    query: ({ where }) =>
      Query.from(tableName)
        .select({ athletes: count(), gold: sum('gold') })
        .where(where),
    groupBy: GROUP_BY,
  });

  // Rebuild the nested tree from the flat, pre-ordered rows: each row nests
  // under the last-seen ancestor one level shallower. The roots (the grand
  // total, level 0) feed the table as `data`; `getSubRows` walks the rest.
  const data = buildTree(rollup.rows);

  // The grand total (root) stays expanded and its toggle stays disabled, so
  // the sport subtotals are always visible — matching the prior behavior.
  const table = useTable({
    features,
    data,
    columns,
    getSubRows: (row) => row.subRows,
    getRowId: (row) => rowId(row),
    initialState: { expanded: { __total__: true } satisfies ExpandedState },
  });

  return (
    <section className="space-y-2">
      <p className="text-sm text-slate-500">
        One <code>GROUP BY ROLLUP</code> query fetched the entire tree (
        {rollup.rows.length.toLocaleString('en-US')} rows); expansion is pure
        visibility.
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm" data-testid="rollup-table">
          <thead className="bg-slate-50 text-left">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-3 py-2 font-medium">
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody data-testid="rollup-table-body">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-t border-slate-100"
                data-testid="rollup-row"
                data-level={row.original.level}
              >
                {row.getVisibleCells().map((cell, index) => (
                  <td
                    key={cell.id}
                    className={
                      index === 0 ? 'px-3 py-1.5' : 'px-3 py-1.5 tabular-nums'
                    }
                    style={
                      index === 0
                        ? {
                            paddingLeft: `${12 + row.original.level * 20}px`,
                          }
                        : undefined
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

function buildTree(rows: Array<RollupRow<MedalRollup>>): Array<RollupNode> {
  const roots: Array<RollupNode> = [];
  // Last-seen node at each level; a row attaches to the node at `level - 1`.
  const parents: Array<RollupNode> = [];
  for (const row of rows) {
    const node: RollupNode = { ...row, subRows: [] };
    if (row.level === 0) {
      roots.push(node);
    } else {
      parents[row.level - 1]?.subRows.push(node);
    }
    parents[row.level] = node;
  }
  return roots;
}
