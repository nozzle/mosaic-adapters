/**
 * Collapsible footer surfacing the SQL a data client last executed — read from
 * the public `lastQuery` field every client store carries. Presentational; used
 * by the summary and detail tables.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';

/** The slice of a data-client store this footer reads. */
interface SqlStore {
  subscribe: (listener: () => void) => { unsubscribe: () => void };
  state: { lastQuery: string | null };
}

export function WidgetSqlDetails(props: {
  store: SqlStore;
}): ReactElement | null {
  const { store } = props;
  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = store.subscribe(onChange);
      return () => {
        subscription.unsubscribe();
      };
    },
    [store],
  );
  const sql = useSyncExternalStore(
    subscribe,
    () => store.state.lastQuery,
    () => store.state.lastQuery,
  );

  if (!sql) {
    return null;
  }

  return (
    <details
      data-testid="widget-sql"
      className="shrink-0 border-t border-line bg-panel-header px-3 py-1.5 text-[11px] text-muted"
    >
      <summary className="cursor-pointer font-medium tracking-wide uppercase select-none">
        SQL
      </summary>
      <pre className="mt-1.5 max-h-44 overflow-y-auto rounded-gf border border-line bg-editor p-2 text-[10px] leading-4 break-all whitespace-pre-wrap text-editor-ink">
        {sql}
      </pre>
    </details>
  );
}
