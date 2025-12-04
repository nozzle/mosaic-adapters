import { BareTable } from './bare-table';
import { ShadcnTable } from './shadcn-table';
import type { ColumnDef, RowData, Table } from '@tanstack/react-table';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';
import { Button } from '@/components/ui/button';

const items = [
  { id: 'shadcn-1', name: 'Shadcn table', Component: ShadcnTable },
  { id: 'bare', name: 'Bare table', Component: BareTable },
];

export function RenderTable<TData extends RowData, TValue>(props: {
  table: Table<TData>;
  columns: Array<ColumnDef<TData, TValue>>;
}) {
  const [view, setView] = useURLSearchParam('table-view', 'shadcn-1');

  return (
    <>
      <div className="mb-4 flex gap-2">
        {items.map(({ id, name }) => (
          <Button
            key={id}
            size="sm"
            onClick={() => setView(id)}
            disabled={view === id}
          >
            {name}
          </Button>
        ))}
      </div>
      {items.map(({ id, Component }) =>
        view === id ? (
          <Component key={id} table={props.table} columns={props.columns} />
        ) : null,
      )}
    </>
  );
}
