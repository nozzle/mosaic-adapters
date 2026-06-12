/**
 * Collapsible footer that surfaces the SQL last executed by a Mosaic table
 * client, read from the client store's `_lastQuery` debug field.
 *
 * NOTE: `_lastQuery` is an `@internal` / `@experimental` debug affordance of
 * `@nozzleio/mosaic-tanstack-table-core` — useful for demos and debugging,
 * but not a supported API to build product features on.
 */
import * as React from 'react';

interface SqlDebugClient {
  store: {
    subscribe: (onChange: () => void) => { unsubscribe: () => void };
    state: { _lastQuery: string | undefined };
  };
}

export function WidgetSqlDetails({ client }: { client: SqlDebugClient }) {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const subscription = client.store.subscribe(onChange);
      return () => {
        subscription.unsubscribe();
      };
    },
    [client.store],
  );
  const sql = React.useSyncExternalStore(
    subscribe,
    () => client.store.state._lastQuery,
    () => client.store.state._lastQuery,
  );

  if (!sql) {
    return null;
  }

  return (
    <details
      data-testid="widget-sql"
      className="border-t bg-slate-50/60 px-3 py-1.5 text-[11px] text-slate-500"
    >
      <summary className="cursor-pointer select-none font-semibold uppercase tracking-wide">
        SQL
      </summary>
      <pre className="mt-1.5 max-h-44 overflow-y-auto rounded border border-slate-200 bg-white p-2 whitespace-pre-wrap break-all text-[10px] leading-4 text-slate-600">
        {sql}
      </pre>
    </details>
  );
}
