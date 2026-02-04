import * as React from 'react';
import { useMemo, useState } from 'react';
import {
  HttpArrowConnector,
  MosaicConnectorProvider,
  MosaicFilterProvider,
  SelectionRegistryProvider,
  useConnectorStatus,
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
 * It configures the MosaicConnectorProvider with secrets and endpoints injected
 * from the environment (e.g. Cloudflare Access Headers).
 */
export function RenderView() {
  const [mode, setMode] = useState<ConnectorMode>('wasm');

  // Load secrets from Vite environment variables (or defaults for local dev)
  const REMOTE_URL =
    import.meta.env.VITE_REMOTE_DB_URL || 'http://localhost:3001/query';
  const CF_CLIENT_ID = import.meta.env.VITE_CF_CLIENT_ID;
  const CF_CLIENT_SECRET = import.meta.env.VITE_CF_CLIENT_SECRET;
  const TENANT_ID = import.meta.env.VITE_TENANT_ID;

  // Memoize the configuration to prevent re-creation on every render
  const connectorConfig = useMemo(
    () => ({
      mode,
      remoteConnectorFactory: () =>
        new HttpArrowConnector({
          url: REMOTE_URL,
          headers: {
            // Cloudflare Tunnel Authentication Headers
            // The library doesn't know these exist; it just spreads them into fetch()
            ...(CF_CLIENT_ID ? { 'CF-Access-Client-Id': CF_CLIENT_ID } : {}),
            ...(CF_CLIENT_SECRET
              ? { 'CF-Access-Client-Secret': CF_CLIENT_SECRET }
              : {}),

            // App-Specific Multi-Tenant Header
            ...(TENANT_ID ? { 'X-Tenant-Id': TENANT_ID } : {}),
          },
          logger: console, // Pass console to debug SQL queries
        }),
    }),
    [mode, REMOTE_URL, CF_CLIENT_ID, CF_CLIENT_SECRET, TENANT_ID],
  );

  return (
    // Updated: The Provider now handles the mode switch internally via derived state.
    // We no longer need `key={mode}` to force a remount.
    <MosaicConnectorProvider config={connectorConfig}>
      <RenderViewWithProviders mode={mode} setMode={setMode} />
    </MosaicConnectorProvider>
  );
}

/**
 * Inner component that keys the SelectionRegistry and FilterProvider by connection ID.
 * This ensures all Selections and filter state are fresh when the connector changes (e.g. database swap).
 */
function RenderViewWithProviders({
  mode,
  setMode,
}: {
  mode: ConnectorMode;
  setMode: (m: ConnectorMode) => void;
}) {
  const { connectionId } = useConnectorStatus();

  return (
    // Key the providers by connectionId to ensure fresh Selection and Filter state
    // when switching between WASM and Remote connectors.
    <SelectionRegistryProvider key={`registry-${connectionId}`}>
      <MosaicFilterProvider key={`filter-${connectionId}`}>
        <RenderViewContent mode={mode} setMode={setMode} />
      </MosaicFilterProvider>
    </SelectionRegistryProvider>
  );
}

function RenderViewContent({
  mode,
  setMode,
}: {
  mode: ConnectorMode;
  setMode: (m: ConnectorMode) => void;
}) {
  const [view, setView] = useURLSearchParam('dashboard', 'athletes', {
    reloadOnChange: true,
  });

  const { status, error } = useConnectorStatus();

  const renderViewContent = () => {
    if (!view || !views.has(view)) {
      return (
        <div>
          <p>Invalid view: "{view}". Please select a valid dashboard.</p>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="h-64 flex flex-col gap-4 items-center justify-center text-red-500">
          <div className="font-bold text-lg">Connection Failed</div>
          <p className="text-sm max-w-md text-center bg-red-50 p-2 rounded border border-red-100">
            {error || 'Unknown error'}
          </p>
          {mode === 'remote' && (
            <p className="text-xs text-slate-500">
              Make sure the proxy server is running:
              <code>node proxy-server.js</code>
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
  };

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

        <ConnectorToggle currentMode={mode} onToggle={setMode} />
      </div>
      {renderViewContent()}
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
