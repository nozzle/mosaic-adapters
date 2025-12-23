/**
 * Main dashboard container. Manages the lifecycle of different analytical views
 * and implements a hard-reset mechanism via React keys.
 */

import * as React from 'react';
import { useState } from 'react';
import { TableStyleSwitcher } from './render-table';
import { Button } from '@/components/ui/button';
import { AthletesView } from '@/components/views/athletes';
import { NycTaxiView } from '@/components/views/nyc-taxi';
import { NozzlePaaView } from '@/components/views/nozzle-paa';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';
import { ConnectorProvider, useConnector } from '@/context/ConnectorContext';
import { ConnectorToggle } from '@/components/connector-toggle';

const views = new Map([
  [
    'athletes',
    {
      title: 'Athletes Dashboard',
      Component: AthletesView,
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
]);

export function RenderView() {
  return (
    <ConnectorProvider>
      <RenderViewContent />
    </ConnectorProvider>
  );
}

function RenderViewContent() {
  const [view, setView] = useURLSearchParam('dashboard', 'athletes', {
    reloadOnChange: true,
  });

  const { mode, status } = useConnector();

  // High-level refresh key. Changing this destroys and reconstructs the dashboard state.
  const [refreshKey, setRefreshKey] = useState(0);
  const handleReset = () => setRefreshKey((prev) => prev + 1);

  const activeView = views.get(view || 'athletes');

  return (
    <>
      <div className="flex justify-between items-start mb-4">
        <div className="grid gap-2">
          <div className="flex border bg-neutral-100 rounded-lg px-1.5 py-1">
            {Array.from(views.entries()).map(([id, { title }]) => (
              <Button
                key={`${id}-button`}
                size="sm"
                variant={view === id ? 'outline' : 'ghost'}
                onClick={() => {
                  setView(id);
                  setRefreshKey(0); // Reset key when switching dashboards
                }}
              >
                {title}
              </Button>
            ))}
          </div>
          <TableStyleSwitcher />
        </div>

        <ConnectorToggle />
      </div>

      {activeView && status === 'connected' ? (
        // Key increment forces unmount of visuals and ViewModels, clearing all zombie clauses.
        <div key={`${view}-${mode}-${refreshKey}`}>
          <h2 className="text-xl mb-4 font-medium">{activeView.title}</h2>
          <hr className="my-4" />
          <activeView.Component onResetRequest={handleReset} />
        </div>
      ) : (
        <div className="h-64 flex items-center justify-center text-slate-400 italic">
          {status === 'connected' ? 'Invalid View' : `Connecting to ${mode}...`}
        </div>
      )}
    </>
  );
}
