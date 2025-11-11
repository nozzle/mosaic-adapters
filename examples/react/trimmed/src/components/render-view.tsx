import * as React from 'react';
import * as vg from '@uwdata/vgplot';
import { Button } from '@/components/ui/button';
import { AthletesView } from '@/components/views/athletes';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';

const wasmConnector = vg.wasmConnector({ log: false });
vg.coordinator().databaseConnector(wasmConnector);

const views = [
  {
    id: 'athletes',
    title: 'Athletes Dashboard',
    Component: AthletesView,
  },
  {
    id: 'other',
    title: 'Other View',
    Component: () => <div>Other view content goes here.</div>,
  },
];

export function RenderView() {
  const [view, setView] = useURLSearchParam('dashboard', 'athletes', {
    reloadOnChange: true,
  });

  return (
    <>
      <div className="mb-4 flex gap-2">
        {views.map(({ id, title }) => (
          <Button
            key={`${id}-button`}
            size="sm"
            onClick={() => setView(id)}
            disabled={view === id}
          >
            {title}
          </Button>
        ))}
      </div>
      {views.map(({ id, title, Component }) =>
        view === id ? (
          <React.Fragment key={`${id}-component`}>
            <h2 className="text-xl mb-4 font-medium">{title}</h2>
            <hr className="my-4" />
            <Component key={id} />
          </React.Fragment>
        ) : null,
      )}
    </>
  );
}
