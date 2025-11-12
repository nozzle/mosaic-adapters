import { DataTableColumnHeader as ShadcnDataTableColumnHeader } from './shadcn-table';
import type { Column, RowData } from '@tanstack/react-table';

export function RenderTableHeader<TData extends RowData, TValue>({
  view,
  ...props
}: {
  column: Column<TData, TValue>;
  title: string;
  view: string | null;
}) {
  if (view === 'shadcn-1') {
    return <ShadcnDataTableColumnHeader {...props} />;
  }

  if (view === 'bare') {
    return <BareDataTableColumnHeader {...props} />;
  }

  return <>{props.title}</>;
}

function BareDataTableColumnHeader<TData extends RowData, TValue>({
  column,
  title,
}: {
  column: Column<TData, TValue>;
  title: string;
}) {
  return (
    <div className="flex flex-col items-start">
      <p>{title}</p>

      {/* Sorting UI */}
      <div className="flex gap-2 p-1">
        <button
          type="button"
          onClick={() => column.toggleSorting(false)}
          disabled={
            column.getCanSort() === false
              ? true
              : column.getIsSorted() === 'asc'
          }
          className="text-xs border rounded p-1 disabled:opacity-50"
        >
          ASC
        </button>
        <button
          type="button"
          onClick={() => column.toggleSorting(true)}
          disabled={
            column.getCanSort() === false
              ? true
              : column.getIsSorted() === 'desc'
          }
          className="text-xs border rounded p-1 disabled:opacity-50"
        >
          DESC
        </button>
        <button
          type="button"
          onClick={() => column.clearSorting()}
          disabled={
            column.getCanSort() === false ? true : !column.getIsSorted()
          }
          className="text-xs border rounded p-1 disabled:opacity-50"
        >
          NONE
        </button>
      </div>
    </div>
  );
}
