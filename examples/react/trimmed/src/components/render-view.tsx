import * as React from 'react';
import { SelectionRegistryProvider } from '@nozzleio/react-mosaic';
import { TableStyleSwitcher } from './render-table';
import { Button } from '@/components/ui/button';
import { AthletesView } from '@/components/views/athletes';
import { AthletesViewSimple } from '@/components/views/athletes-simple';
import { NycTaxiView } from '@/components/views/nyc-taxi';
import { NozzlePaaView } from '@/components/views/nozzle-paa';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';
import { ConnectorProvider, useConnector } from '@/context/ConnectorContext';
import { ConnectorToggle } from '@/components/connector-toggle';
import { GlobalResetButton } from '@/components/global-reset-button';

const views = new Map([
  [
    'athletes',
    {
      title: 'Athletes Dashboard',
      Component: AthletesView,
    },
  ],
  [
    'athletes-simple',
    {
      title: 'Athletes (No Helper)',
      Component: AthletesViewSimple,
    },
  ],
  [
    'nyc-taxi',
    {
      title: 'NYC Taxi Dashboard',
      Component: NycTaxiView,
    },
  ],
  [
    'nozzle-paa',
    {
      title: 'Nozzle PAA Report',
      Component: NozzlePaaView,
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
  return (
    <ConnectorProvider>
      <SelectionRegistryProvider>
        <RenderViewContent />
      </SelectionRegistryProvider>
    </ConnectorProvider>
  );
}

function RenderViewContent() {
  const [view, setView] = useURLSearchParam('dashboard', 'athletes', {
    reloadOnChange: true,
  });

  const { mode, status } = useConnector();

  return (
    <>
      <div className="flex justify-between items-start mb-4">
        <div className="grid gap-2">
          <div className="flex border bg-neutral-100 rounded-lg px-1.5 py-1 gap-2 items-center flex-wrap">
            {Array.from(views.entries()).map(([id, { title }]) => (
              <Button
                key={`${id}-button`}
                size="sm"
                variant={view === id ? 'outline' : 'ghost'}
                onClick={() => setView(id)}
              >
                {title}
              </Button>
            ))}
            <div className="h-4 w-px bg-slate-300 mx-1" />
            <GlobalResetButton />
          </div>
          <TableStyleSwitcher />
        </div>

        <ConnectorToggle />
      </div>
      {view && views.has(view) ? (
        // Only render the layout if we are fully connected.
        // This prevents the "Uncaught (in promise) Cleared" error by ensuring
        // the component is unmounted while the coordinator is being cleared/swapped.
        status === 'connected' ? (
          <RenderLayout key={`${view}-${mode}`} view={views.get(view)!} />
        ) : (
          <div className="h-64 flex items-center justify-center text-slate-400 italic">
            Connecting to {mode === 'remote' ? 'Remote Server' : 'WASM'}...
          </div>
        )
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
