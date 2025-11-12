import * as React from 'react';
import * as vg from '@uwdata/vgplot';
import { Button } from '@/components/ui/button';
import { AthletesView } from '@/components/views/athletes';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';

const wasmConnector = vg.wasmConnector({ log: false });
vg.coordinator().databaseConnector(wasmConnector);

const views = new Map([
  [
    'athletes',
    {
      title: 'Athletes Dashboard',
      Component: AthletesView,
    },
  ],
  [
    'other',
    {
      title: 'Other View',
      Component: () => <div>Other view content goes here.</div>,
    },
  ],
]);

type ViewMap = typeof views;
type ViewConfig = ViewMap extends Map<infer _K, infer V> ? V : never;

export function RenderView() {
  const [view, setView] = useURLSearchParam('dashboard', 'athletes', {
    reloadOnChange: true,
  });

  return (
    <>
      <div className="mb-4 flex gap-2">
        {Array.from(views.entries()).map(([id, { title }]) => (
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
      {view && views.has(view) ? (
        <RenderLayout view={views.get(view)!} />
      ) : (
        <div>
          <p>Invalid view: "{view}". Please select a valid dashboard.</p>
        </div>
      )}
    </>
  );
}

function RenderLayout({ view: { title, Component } }: { view: ViewConfig }) {
  return (
    <>
      <h2 className="text-xl mb-4 font-medium">{title}</h2>
      <hr className="my-4" />
      <Component />
    </>
  );
}
