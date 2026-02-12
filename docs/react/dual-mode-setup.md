# Dual-Mode Setup (WASM + Remote)

This guide covers running Mosaic in dual-mode: switching between local WASM execution (DuckDB in browser) and remote HTTP execution (external server).

## When You Need This

Use dual-mode when:

- Your dataset is too large for browser memory
- You need server-side auth or data access controls
- You want to compare WASM vs server performance
- Your production environment uses a remote DuckDB/MotherDuck server

## Quick Start

### 1. Wrap Your App with MosaicConnectorProvider

Replace the basic `MosaicContext.Provider` with `MosaicConnectorProvider`:

```tsx
import {
  MosaicConnectorProvider,
  HttpArrowConnector,
} from '@nozzleio/react-mosaic';

function App() {
  return (
    <MosaicConnectorProvider
      initialMode="wasm"
      remoteConnectorFactory={() =>
        new HttpArrowConnector({
          url: 'http://localhost:3001/query',
        })
      }
    >
      <MyDashboard />
    </MosaicConnectorProvider>
  );
}
```

### 2. Add a Mode Toggle

```tsx
import { useMosaicCoordinator } from '@nozzleio/react-mosaic';

function ConnectorToggle() {
  const { mode, setMode, status } = useMosaicCoordinator();

  return (
    <div>
      <button
        onClick={() => setMode('wasm')}
        disabled={status === 'connecting'}
      >
        WASM {mode === 'wasm' && '✓'}
      </button>
      <button
        onClick={() => setMode('remote')}
        disabled={status === 'connecting'}
      >
        Remote {mode === 'remote' && '✓'}
      </button>
      <span>{status}</span>
    </div>
  );
}
```

### 3. Handle Connection States

The provider exposes connection status. Guard your views:

```tsx
import { useMosaicCoordinator } from '@nozzleio/react-mosaic';

function Dashboard() {
  const { status, error, mode } = useMosaicCoordinator();

  if (status === 'connecting') {
    return <div>Connecting to {mode}...</div>;
  }

  if (status === 'error') {
    return <div>Connection failed: {error?.message}</div>;
  }

  return <MyTable />;
}
```

## MosaicConnectorProvider Props

| Prop                     | Type                 | Default  | Description                                     |
| ------------------------ | -------------------- | -------- | ----------------------------------------------- |
| `initialMode`            | `'wasm' \| 'remote'` | `'wasm'` | Starting execution mode                         |
| `remoteConnectorFactory` | `() => Connector`    | —        | Factory for remote connector (called on switch) |
| `wasmOptions`            | `object \| null`     | `{}`     | Options for wasmConnector. `null` = defer init  |
| `debug`                  | `boolean`            | `false`  | Enable verbose coordinator logging              |

## HttpArrowConnector

Generic HTTP connector that sends JSON requests and receives Arrow IPC responses.

```tsx
import { HttpArrowConnector } from '@nozzleio/react-mosaic';

const connector = new HttpArrowConnector({
  url: 'https://api.example.com/query',
  headers: {
    Authorization: 'Bearer token',
    'X-Tenant-Id': 'my-tenant',
  },
});
```

### Options

| Option    | Type                     | Description                              |
| --------- | ------------------------ | ---------------------------------------- |
| `url`     | `string`                 | Full endpoint URL                        |
| `headers` | `Record<string, string>` | Headers for every request (auth, tenant) |
| `logger`  | `{ log, error }`         | Optional logger for debugging            |

### Request Format

The connector sends:

```json
{ "sql": "SELECT * FROM table", "type": "arrow" }
```

Your server should return binary Arrow IPC format.

## Hooks

### useMosaicCoordinator

Full access to coordinator and connection state:

```tsx
const {
  coordinator, // Coordinator instance (null during transition)
  mode, // 'wasm' | 'remote'
  setMode, // Switch modes
  status, // 'connecting' | 'connected' | 'error'
  error, // Error object if status === 'error'
  connectionId, // Changes on each successful connection
  isMosaicInitialized, // true when status === 'connected' && coordinator exists
} = useMosaicCoordinator();
```

### useConnectorStatus

Lighter hook for just status info (no coordinator):

```tsx
const { mode, setMode, status, error, connectionId } = useConnectorStatus();
```

### useRequireMode

Conditional rendering based on mode:

```tsx
import { useRequireMode } from '@nozzleio/react-mosaic';

function RemoteOnlyFeature() {
  const isRemote = useRequireMode('remote');

  if (!isRemote) {
    return <div>This feature requires remote mode</div>;
  }

  return <AdvancedAnalytics />;
}
```

## The `enabled` Option

When switching modes, queries can fail with "Cleared" errors if fired during transition. Use `enabled` to suppress queries until ready:

```tsx
const [isReady, setIsReady] = useState(false);

// In your data loading effect
useEffect(() => {
  async function init() {
    await coordinator.exec([...]);
    setIsReady(true);
  }
  init();
}, [coordinator, mode]);

// Pass enabled to hooks
const { tableOptions } = useMosaicReactTable({
  table: 'mydata',
  columns,
  enabled: isReady,  // Suppresses queries until true
});

const { bins } = useMosaicHistogram({
  table: 'mydata',
  column: 'value',
  step: 10,
  filterBy: $context,
  enabled: isReady,
});
```

## Dual Data Sources

Different modes may need different data paths:

```tsx
const DATA_SOURCES = {
  wasm: 'https://cdn.example.com/data.parquet', // Public URL for browser
  remote: '/data/data.parquet', // Server filesystem path
};

function MyView() {
  const { mode } = useConnectorStatus();

  useEffect(() => {
    const fileURL = DATA_SOURCES[mode];
    coordinator.exec([
      `CREATE OR REPLACE TABLE mydata AS SELECT * FROM '${fileURL}'`,
    ]);
  }, [mode]);
}
```

## Topology Hooks and Mode Switching

Selections created at module level persist across mode switches, causing stale state. Create selections inside hooks instead:

```tsx
// BAD: Module-level selections persist across mode switches
const $query = vg.Selection.intersect();

// GOOD: Hook-level selections recreate on remount
function useMyTopology() {
  const $query = useMosaicSelection('intersect');
  const $filter = useMosaicSelection('intersect');

  useRegisterSelections([$query, $filter]);

  return { $query, $filter };
}
```

When mode changes, the provider keys child components by `connectionId`, forcing remount and fresh selections.

## Provider Hierarchy

The recommended provider structure:

```tsx
<MosaicConnectorProvider
  initialMode="wasm"
  remoteConnectorFactory={remoteFactory}
>
  {/* These re-key on connection changes */}
  <SelectionRegistryProvider key={connectionId}>
    <MosaicFilterProvider key={connectionId}>
      <App />
    </MosaicFilterProvider>
  </SelectionRegistryProvider>
</MosaicConnectorProvider>
```

Access `connectionId` via `useConnectorStatus()` to key providers:

```tsx
function ProvidersWithKey({ children }) {
  const { connectionId } = useConnectorStatus();

  return (
    <SelectionRegistryProvider key={`registry-${connectionId}`}>
      <MosaicFilterProvider key={`filter-${connectionId}`}>
        {children}
      </MosaicFilterProvider>
    </SelectionRegistryProvider>
  );
}
```

## Local Development Proxy

For remote mode, you may need a proxy to handle CORS and auth headers:

```js
// proxy-server.js
import { createServer } from 'node:http';

const server = createServer(async (req, res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  // Forward to remote
  const upstream = await fetch(REMOTE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Access-Client-Id': process.env.CF_CLIENT_ID,
    },
    body: await readBody(req),
  });

  // Return Arrow response
  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.end(buffer);
});

server.listen(3001);
```

See `examples/react/trimmed/proxy-server.js` for a complete implementation.

## Error Handling

Handle connection failures gracefully:

```tsx
function DashboardWithErrors() {
  const { status, error, mode } = useMosaicCoordinator();

  if (status === 'error') {
    return (
      <div className="error-panel">
        <h3>Connection Failed</h3>
        <p>{error?.message}</p>
        {mode === 'remote' && (
          <p>
            Ensure the proxy server is running:{' '}
            <code>node proxy-server.js</code>
          </p>
        )}
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  // ...
}
```

## Complete Example

See `examples/react/trimmed/src/components/render-view.tsx` for a full dual-mode setup including:

- Provider hierarchy with connection keying
- Error state handling
- Mode toggle UI
- Data source switching

## Next Steps

- [Simple Usage](./simple-usage.md) – Basic single-mode setup
- [Complex Setup](./complex-setup.md) – Multi-table topologies
- [Inputs](./inputs.md) – Filter inputs and facet menus
