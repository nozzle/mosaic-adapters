import { useURLSearchParam } from '../hooks/useURLSearchParam';
import { BareTable } from './bare-table';
import type { Table } from '@tanstack/react-table';

const items = [{ id: 'bare', name: 'Bare table', Component: BareTable }];

export function RenderTable(props: { table: Table<unknown> }) {
  const [view, setView] = useURLSearchParam('table-view', 'bare');

  return (
    <>
      <div>
        {items.map(({ id, name }) => (
          <button key={id} onClick={() => setView(id)} disabled={view === id}>
            {name}
          </button>
        ))}
      </div>
      <div>
        {items.map(({ id, Component }) =>
          view === id ? <Component key={id} table={props.table} /> : null,
        )}
      </div>
    </>
  );
}
