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
  const multiSort = column.getCanMultiSort();

  return (
    <>
      <p className="w-min">{title}</p>

      {/* Sorting UI */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => column.toggleSorting(false, multiSort)}
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
          onClick={() => column.toggleSorting(true, multiSort)}
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
    </>
  );
}
