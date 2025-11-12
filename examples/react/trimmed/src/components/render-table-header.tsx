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
  console.debug(
    'Rendering BareDataTableColumnHeader',
    { title },
    column.getIsSorted(),
  );
  return (
    <div>
      <p>{title}</p>
      {column.getCanSort() ? (
        <div className="flex gap-2 p-1">
          <button
            type="button"
            onClick={() => column.toggleSorting(false)}
            disabled={column.getIsSorted() === 'asc'}
            className="text-xs border rounded p-1 disabled:opacity-50"
          >
            ASC
          </button>
          <button
            type="button"
            onClick={() => column.toggleSorting(true)}
            disabled={column.getIsSorted() === 'desc'}
            className="text-xs border rounded p-1 disabled:opacity-50"
          >
            DESC
          </button>
          <button
            type="button"
            onClick={() => column.clearSorting()}
            disabled={!column.getIsSorted()}
            className="text-xs border rounded p-1 disabled:opacity-50"
          >
            NONE
          </button>
        </div>
      ) : null}
    </div>
  );
}
