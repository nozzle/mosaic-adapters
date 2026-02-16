/**
 * Reusable renderer for grouped table markup.
 *
 * Handles group rows (expandable with metrics) and leaf rows
 * (individual data displayed in a flat flex layout).
 */
import * as React from 'react';
import type { Row, Table } from '@tanstack/react-table';
import type {
  GroupLevel,
  ServerGroupedRow,
} from '@nozzleio/mosaic-tanstack-react-table';
import { cn } from '@/lib/utils';

export interface LeafColStyle {
  label?: string;
  width?: number;
  className?: string;
  render?: (val: unknown) => string;
}

export interface GroupedTableRendererProps {
  table: Table<ServerGroupedRow>;
  levels: Array<GroupLevel>;
  toggleExpand: (row: Row<ServerGroupedRow>) => void;
  loadingGroupIds: Array<string>;
  leafColStyles?: Record<string, LeafColStyle>;
  metricColumns: Array<{ id: string; label: string }>;
  footerText?: string;
}

export function GroupedTableRenderer({
  table,
  levels,
  toggleExpand,
  loadingGroupIds,
  leafColStyles = {},
  metricColumns,
  footerText,
}: GroupedTableRendererProps) {
  const colSpan = 1 + metricColumns.length;

  return (
    <div className="border rounded overflow-auto max-h-[600px]">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 sticky top-0 z-10">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Group</th>
            {metricColumns.map((mc) => (
              <th key={mc.id} className="text-right px-3 py-2 font-medium">
                {mc.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, flatIndex) => {
            const original = row.original;

            // Leaf rows
            if (original.type === 'leaf') {
              const lv = original.values;
              const indent = (row.depth + 1) * 20 + 12;
              const keys = Object.keys(lv);

              const prevRow =
                flatIndex > 0
                  ? table.getRowModel().rows[flatIndex - 1]
                  : undefined;
              const isFirstLeaf =
                !prevRow || prevRow.original.type !== 'leaf';

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

            // Group rows
            const isExpanded = row.getIsExpanded();
            const indent = row.depth * 20;
            const levelLabel = levels[row.depth]?.label ?? '';
            const isLoading = loadingGroupIds.includes(row.id);

            return (
              <tr
                key={row.id}
                className={cn(
                  'border-t cursor-pointer hover:bg-slate-50 transition-colors',
                  row.depth === 0 && 'font-medium',
                )}
                onClick={() => toggleExpand(row)}
              >
                <td
                  className="px-3 py-1.5"
                  style={{ paddingLeft: `${indent + 12}px` }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-xs text-slate-400 w-4 inline-block">
                      {isLoading ? '...' : isExpanded ? '▼' : '▶'}
                    </span>
                    <span>{original.groupValue || '(empty)'}</span>
                    <span className="text-xs text-slate-400">
                      ({levelLabel})
                    </span>
                  </span>
                </td>
                {metricColumns.map((mc) => (
                  <td
                    key={mc.id}
                    className="text-right px-3 py-1.5 tabular-nums"
                  >
                    {original.metrics[mc.id]?.toLocaleString() ?? '—'}
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
