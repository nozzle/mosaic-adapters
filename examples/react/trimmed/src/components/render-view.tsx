import * as React from 'react';
import { useMemo } from 'react';
import {
  HttpArrowConnector,
  MosaicConnectorProvider,
  MosaicFilterProvider,
  SelectionRegistryProvider,
  useConnectorStatus,
  useMosaicCoordinator,
} from '@nozzleio/react-mosaic';
import { TableStyleSwitcher } from './render-table';
import type { ConnectorMode } from '@nozzleio/react-mosaic';
import { Button } from '@/components/ui/button';
import { AthletesView } from '@/components/views/athletes';
import { AthletesViewSimple } from '@/components/views/athletes-simple';
import { NycTaxiView } from '@/components/views/nyc-taxi';
import { NozzlePaaView } from '@/components/views/nozzle-paa';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';
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

/**
 * Main application layout that sets up the Mosaic Provider hierarchy.
 *
 * It configures the MosaicConnectorProvider for direct remote auth
 * (Bearer token + optional tenant ID) without a local proxy.
 */
export function RenderView() {
  // Read Vite-exposed env vars (must be prefixed with VITE_).
  const REMOTE_URL =
    import.meta.env.VITE_REMOTE_DB_URL || 'http://localhost:3000';
  const API_TOKEN = import.meta.env.VITE_API_TOKEN;
  const TENANT_ID = import.meta.env.VITE_TENANT_ID;

  // Memoize the factory separately — no `mode` in deps, stable reference
  const remoteConnectorFactory = useMemo(
    () => () =>
      new HttpArrowConnector({
        url: REMOTE_URL,
        headers: {
          ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
          ...(TENANT_ID ? { 'X-Tenant-Id': TENANT_ID } : {}),
        },
      }),
    [REMOTE_URL, API_TOKEN, TENANT_ID],
  );

  return (
    <MosaicConnectorProvider
      initialMode="wasm"
      remoteConnectorFactory={remoteConnectorFactory}
    >
      <RenderViewWithProviders remoteUrl={REMOTE_URL} />
    </MosaicConnectorProvider>
  );
}

/**
 * Inner component that keys the SelectionRegistry and FilterProvider by connection ID.
 * This ensures all Selections and filter state are fresh when the connector changes (e.g. database swap).
 */
function RenderViewWithProviders({ remoteUrl }: { remoteUrl: string }) {
  const { connectionId } = useConnectorStatus();

  return (
    <SelectionRegistryProvider key={`registry-${connectionId}`}>
      <MosaicFilterProvider key={`filter-${connectionId}`}>
        <RenderViewContent remoteUrl={remoteUrl} />
      </MosaicFilterProvider>
    </SelectionRegistryProvider>
  );
}

function RenderViewContent({ remoteUrl }: { remoteUrl: string }) {
  const [view, setView] = useURLSearchParam('dashboard', 'athletes', {
    reloadOnChange: true,
  });

  const { mode, status, error } = useMosaicCoordinator();

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
      <ViewContent
        view={view ?? ''}
        mode={mode}
        status={status}
        error={error}
        remoteUrl={remoteUrl}
      />
    </>
  );
}

function ViewContent({
  view,
  mode,
  status,
  error,
  remoteUrl,
}: {
  view: string;
  mode: ConnectorMode;
  status: 'connecting' | 'connected' | 'error';
  error: Error | null;
  remoteUrl: string;
}) {
  if (!view || !views.has(view)) {
    return (
      <div>
        <p>
          Invalid view: &quot;{view}&quot;. Please select a valid dashboard.
        </p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="h-64 flex flex-col gap-4 items-center justify-center text-red-500">
        <div className="font-bold text-lg">Connection Failed</div>
        <p className="text-sm max-w-md text-center bg-red-50 p-2 rounded border border-red-100">
          {error?.message || 'Unknown error'}
        </p>
        {mode === 'remote' && (
          <p className="text-xs text-slate-500">
            Verify the DuckDB server is running at <code>{remoteUrl}</code> and
            your <code>VITE_API_TOKEN</code> is valid.
          </p>
        )}
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-slate-200 rounded hover:bg-slate-300 text-slate-800 text-sm font-medium"
        >
          Reload Page
        </button>
      </div>
    );
  }

  if (status === 'connecting') {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400 italic">
        Connecting to {mode === 'remote' ? 'Remote Server' : 'WASM'}...
      </div>
    );
  }

  // status === 'connected'
  return <RenderLayout key={`${view}-${mode}`} view={views.get(view)!} />;
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
