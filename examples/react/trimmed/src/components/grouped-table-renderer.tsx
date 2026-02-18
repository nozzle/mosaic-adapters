/**
 * Reusable renderer for grouped table markup.
 *
 * Uses TanStack's rendering pipeline: `flexRender` for headers and group cells,
 * `row.toggleExpanded()` for expand/collapse, and `row.getVisibleCells()` for
 * group row rendering. Leaf rows are the only special-case: they span the full
 * width with a flat flex layout (unavoidable with mixed row types).
 */
import * as React from 'react';
import { flexRender } from '@tanstack/react-table';
import type { Table } from '@tanstack/react-table';
import type { ServerGroupedRow } from '@nozzleio/mosaic-tanstack-react-table';
import { cn } from '@/lib/utils';

export interface LeafColStyle {
  label?: string;
  width?: number;
  className?: string;
  render?: (val: unknown) => string;
}

export interface GroupedTableRendererProps {
  table: Table<ServerGroupedRow>;
  loadingGroupIds: Array<string>;
  leafColStyles?: Record<string, LeafColStyle>;
  footerText?: string;
}

export function GroupedTableRenderer({
  table,
  loadingGroupIds,
  leafColStyles = {},
  footerText,
}: GroupedTableRendererProps) {
  const headerGroups = table.getHeaderGroups();
  const colSpan = headerGroups[0]?.headers.length ?? 1;

  return (
    <div className="border rounded overflow-auto max-h-[600px]">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 sticky top-0 z-10">
          {headerGroups.map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={cn(
                    'px-3 py-2 font-medium',
                    (header.column.columnDef.meta as any)?.align === 'right'
                      ? 'text-right'
                      : 'text-left',
                  )}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, flatIndex) => {
            const original = row.original;

            // Leaf rows — special-cased (full-width flex layout)
            if (original.type === 'leaf') {
              const lv = original.values;
              const indent = (row.depth + 1) * 20 + 12;
              const keys = Object.keys(lv);

              const prevRow =
                flatIndex > 0
                  ? table.getRowModel().rows[flatIndex - 1]
                  : undefined;
              const isFirstLeaf = !prevRow || prevRow.original.type !== 'leaf';

              return (
                <React.Fragment key={row.id}>
                  {isFirstLeaf && (
                    <tr className="bg-slate-50/80">
                      <td
                        colSpan={colSpan}
                        style={{ paddingLeft: `${indent}px` }}
                      >
                        <div className="flex gap-1 text-[10px] font-medium text-slate-400 uppercase tracking-wider py-1 px-1">
                          {keys.map((key) => {
                            const style = leafColStyles[key];
                            return (
                              <span
                                key={key}
                                className="truncate"
                                style={{
                                  minWidth: style?.width ?? 60,
                                  flex: style?.width
                                    ? `0 0 ${style.width}px`
                                    : '1 1 0',
                                }}
                              >
                                {style?.label ?? key}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                  <tr className="border-t border-slate-100 text-xs hover:bg-slate-50/50">
                    <td
                      colSpan={colSpan}
                      style={{ paddingLeft: `${indent}px` }}
                    >
                      <div className="flex gap-1 py-0.5 px-1">
                        {keys.map((key) => {
                          const val = lv[key];
                          const style = leafColStyles[key];
                          const rendered = style?.render
                            ? style.render(val)
                            : String(val ?? '—');
                          return (
                            <span
                              key={key}
                              className={cn(
                                'truncate',
                                style?.className ?? 'text-slate-500',
                              )}
                              style={{
                                minWidth: style?.width ?? 60,
                                flex: style?.width
                                  ? `0 0 ${style.width}px`
                                  : '1 1 0',
                              }}
                            >
                              {rendered}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              );
            }

            // Group rows — use TanStack's rendering pipeline
            const isLoading = loadingGroupIds.includes(row.id);

            return (
              <tr
                key={row.id}
                className={cn(
                  'border-t cursor-pointer hover:bg-slate-50 transition-colors',
                  row.depth === 0 && 'font-medium',
                )}
                onClick={() => row.toggleExpanded()}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cn(
                      'px-3 py-1.5',
                      (cell.column.columnDef.meta as any)?.align === 'right' &&
                        'text-right tabular-nums',
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, {
                      ...cell.getContext(),
                      // Pass loading state via context for the group cell
                      ...(cell.column.id === 'group' ? { isLoading } : {}),
                    })}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {footerText && (
        <div className="text-xs text-slate-400 px-3 py-2 border-t bg-slate-50">
          {footerText}
        </div>
      )}
    </div>
  );
}
