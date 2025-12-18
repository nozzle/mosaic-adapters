import { BareTable } from './bare-table';
import { ShadcnTable } from './shadcn-table';
import type { ColumnDef, Row, RowData, Table } from '@tanstack/react-table';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';
import { Button } from '@/components/ui/button';

const items = [
  { id: 'shadcn-1', name: 'Shadcn table', Component: ShadcnTable },
  { id: 'bare', name: 'Bare table', Component: BareTable },
];

export function RenderTable<TData extends RowData, TValue>(props: {
  table: Table<TData>;
  columns: Array<ColumnDef<TData, TValue>>;
  onRowClick?: (row: Row<TData>) => void;
}) {
  const [view] = useURLSearchParam('table-view', 'shadcn-1');

  return (
    <>
      {items.map(({ id, Component }) =>
        view === id ? (
          <Component
            key={id}
            table={props.table}
            columns={props.columns}
            onRowClick={props.onRowClick}
          />
        ) : null,
      )}
    </>
  );
}

export function TableStyleSwitcher() {
  const [view, setView] = useURLSearchParam('table-view', 'shadcn-1');

  return (
    <div className="flex border bg-neutral-100 rounded-lg px-1.5 py-1">
      {items.map(({ id, name }) => (
        <Button
          key={id}
          size="sm"
          variant={view === id ? 'outline' : 'ghost'}
          onClick={() => setView(id)}
        >
          {name}
        </Button>
      ))}
    </div>
  );
}
